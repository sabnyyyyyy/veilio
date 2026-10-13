use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("5Vj4y8BT74PDe5VwLuDp9agTR5ak4vtZdwxnBfRW3R8s");

pub const ESCROW_SEED: &[u8] = b"service_escrow";
pub const VAULT_SEED: &[u8] = b"service_vault";
pub const MAX_DELIVERABLE_REF_LEN: usize = 200;
pub const MAX_FEE_BPS: u16 = 500; // 5% maximum platform fee
/// Global platform configuration PDA: [b"escrow_config"].
pub const CONFIG_SEED: &[u8] = b"escrow_config";

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum ServiceEscrowStatus {
    #[default]
    None = 0,       // Uninitialized
    Funded = 1,     // Buyer deposited funds, work in progress
    Delivered = 2,  // Seller submitted deliverables, awaiting buyer review
    Released = 3,   // Buyer approved, payment released to seller
    Refunded = 4,   // Cancelled / refunded to buyer
    Disputed = 5,   // Escalated dispute, awaiting reviewer resolution
}

#[program]
pub mod veilio_service_escrow {
    use super::*;

    /// One-time creation of the global config PDA. Only the program's upgrade authority may call it,
    /// which prevents anyone from front-running initialization with their own reviewer.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        reviewer: Pubkey,
        fee_recipient: Pubkey,
        fee_basis_points: u16,
    ) -> Result<()> {
        validate_config(reviewer, fee_recipient, fee_basis_points)?;
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.reviewer = reviewer;
        config.fee_recipient = fee_recipient;
        config.fee_basis_points = fee_basis_points;
        config.bump = ctx.bumps.config;
        emit!(ConfigUpdatedEvent {
            admin: config.admin,
            reviewer,
            fee_recipient,
            fee_basis_points,
        });
        Ok(())
    }

    /// Admin rotates the platform reviewer / fee recipient / fee rate, or hands over admin.
    /// Fee changes only affect orders deposited afterwards (each order snapshots its fee).
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        reviewer: Pubkey,
        fee_recipient: Pubkey,
        fee_basis_points: u16,
        new_admin: Pubkey,
    ) -> Result<()> {
        validate_config(reviewer, fee_recipient, fee_basis_points)?;
        require!(new_admin != Pubkey::default(), EscrowError::InvalidConfig);
        let config = &mut ctx.accounts.config;
        config.admin = new_admin;
        config.reviewer = reviewer;
        config.fee_recipient = fee_recipient;
        config.fee_basis_points = fee_basis_points;
        emit!(ConfigUpdatedEvent {
            admin: new_admin,
            reviewer,
            fee_recipient,
            fee_basis_points,
        });
        Ok(())
    }

    /// Deposits native SOL into escrow for a negotiated service order.
    ///
    /// `_reviewer` and `_fee_recipient` are DEPRECATED and ignored: they are kept only so the
    /// instruction data layout stays compatible with existing clients. The reviewer, fee
    /// recipient and fee rate always come from the global `config` PDA (snapshotted into the
    /// order), so a buyer can no longer appoint themselves as reviewer.
    pub fn deposit(
        ctx: Context<DepositOrder>,
        order_id: [u8; 32],
        seller: Pubkey,
        _reviewer: Pubkey,
        _fee_recipient: Pubkey,
        amount: u64,
        deadline: i64,
    ) -> Result<()> {
        require!(order_id != [0u8; 32], EscrowError::InvalidOrderId);
        require!(seller != Pubkey::default(), EscrowError::InvalidSellerAddress);
        require!(seller != ctx.accounts.buyer.key(), EscrowError::BuyerCannotBeSeller);
        require!(amount > 0, EscrowError::ZeroDepositAmount);

        let config = &ctx.accounts.config;
        require!(
            config.reviewer != ctx.accounts.buyer.key() && config.reviewer != seller,
            EscrowError::ReviewerNotIndependent
        );
        require!(config.fee_basis_points <= MAX_FEE_BPS, EscrowError::FeeTooHigh);

        let clock = Clock::get()?;
        require!(deadline > clock.unix_timestamp, EscrowError::DeadlineMustBeInFuture);

        // Transfer lamports from buyer to vault PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        let escrow = &mut ctx.accounts.escrow_order;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = seller;
        escrow.reviewer = config.reviewer;
        escrow.fee_recipient = config.fee_recipient;
        escrow.order_id = order_id;
        escrow.amount = amount;
        escrow.fee_basis_points = config.fee_basis_points; // snapshot, capped by MAX_FEE_BPS
        escrow.deadline = deadline;
        escrow.status = ServiceEscrowStatus::Funded;
        escrow.created_at = clock.unix_timestamp;
        escrow.settled_at = 0;
        escrow.deliverable_reference = String::new();
        escrow.bump = ctx.bumps.escrow_order;
        escrow.vault_bump = ctx.bumps.vault;

        emit!(OrderFundedEvent {
            order_id,
            buyer: ctx.accounts.buyer.key(),
            seller,
            amount,
            deadline,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Seller submits delivery reference or cryptographic work proof.
    pub fn submit_delivery(
        ctx: Context<SubmitDelivery>,
        deliverable_reference: String,
    ) -> Result<()> {
        require!(!deliverable_reference.is_empty(), EscrowError::EmptyDeliverableReference);
        require!(
            deliverable_reference.len() <= MAX_DELIVERABLE_REF_LEN,
            EscrowError::DeliverableReferenceTooLong
        );

        let clock = Clock::get()?;
        let escrow = &mut ctx.accounts.escrow_order;

        require!(
            escrow.status == ServiceEscrowStatus::Funded || escrow.status == ServiceEscrowStatus::Delivered,
            EscrowError::OrderNotFunded
        );
        require!(clock.unix_timestamp <= escrow.deadline, EscrowError::DeliveryDeadlinePassed);

        escrow.deliverable_reference = deliverable_reference.clone();
        escrow.status = ServiceEscrowStatus::Delivered;

        emit!(DeliverySubmittedEvent {
            order_id: escrow.order_id,
            seller: ctx.accounts.seller.key(),
            deliverable_reference,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Releases escrowed funds to seller after buyer approves deliverables.
    pub fn release_funds(ctx: Context<ReleaseFunds>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_order;
        require!(
            escrow.status == ServiceEscrowStatus::Funded || escrow.status == ServiceEscrowStatus::Delivered,
            EscrowError::OrderNotFunded
        );

        let total_amount = escrow.amount;
        require!(total_amount > 0, EscrowError::OrderAmountZero);

        // Platform fee: rate snapshotted at deposit (<= MAX_FEE_BPS)
        let fee_amount = total_amount
            .checked_mul(escrow.fee_basis_points as u64)
            .ok_or(EscrowError::MathOverflow)?
            .checked_div(10000)
            .ok_or(EscrowError::MathOverflow)?;
        let seller_amount = total_amount
            .checked_sub(fee_amount)
            .ok_or(EscrowError::MathOverflow)?;

        // Transfer funds from vault PDA using seeds via CPI
        let order_id = escrow.order_id;
        let vault_bump = escrow.vault_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, order_id.as_ref(), &[vault_bump]]];

        // 1. Fee payout (if > 0)
        if fee_amount > 0 {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.fee_recipient.to_account_info(),
                },
                signer_seeds,
            );
            system_program::transfer(cpi_ctx, fee_amount)?;
        }

        // 2. Seller payout
        if seller_amount > 0 {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
                signer_seeds,
            );
            system_program::transfer(cpi_ctx, seller_amount)?;
        }

        let clock = Clock::get()?;
        escrow.amount = 0;
        escrow.status = ServiceEscrowStatus::Released;
        escrow.settled_at = clock.unix_timestamp;

        emit!(OrderReleasedEvent {
            order_id,
            buyer: ctx.accounts.buyer.key(),
            seller: ctx.accounts.seller.key(),
            seller_amount,
            fee_amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Cancels order and returns 100% funds to buyer fee-free.
    /// Callable by seller anytime, or by buyer if deadline passed without delivery.
    pub fn cancel_or_refund(ctx: Context<CancelOrRefund>, reason: String) -> Result<()> {
        let clock = Clock::get()?;
        let escrow = &mut ctx.accounts.escrow_order;

        require!(
            escrow.status == ServiceEscrowStatus::Funded || escrow.status == ServiceEscrowStatus::Delivered,
            EscrowError::OrderNotFunded
        );

        let caller = ctx.accounts.caller.key();
        let is_seller = caller == escrow.seller;
        let is_buyer_timeout = caller == escrow.buyer
            && escrow.status == ServiceEscrowStatus::Funded
            && clock.unix_timestamp > escrow.deadline;

        require!(
            is_seller || is_buyer_timeout,
            EscrowError::UnauthorizedRefund
        );

        let refund_amount = escrow.amount;
        require!(refund_amount > 0, EscrowError::OrderAmountZero);

        // Transfer 100% refund from vault back to buyer via CPI
        let order_id = escrow.order_id;
        let vault_bump = escrow.vault_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, order_id.as_ref(), &[vault_bump]]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.buyer.to_account_info(),
            },
            signer_seeds,
        );
        system_program::transfer(cpi_ctx, refund_amount)?;

        let order_id = escrow.order_id;
        escrow.amount = 0;
        escrow.status = ServiceEscrowStatus::Refunded;
        escrow.settled_at = clock.unix_timestamp;

        emit!(OrderRefundedEvent {
            order_id,
            buyer: escrow.buyer,
            refund_amount,
            reason,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Flags an order as disputed, awaiting designated reviewer resolution.
    pub fn dispute(ctx: Context<DisputeOrder>, reason: String) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_order;
        require!(
            escrow.status == ServiceEscrowStatus::Funded || escrow.status == ServiceEscrowStatus::Delivered,
            EscrowError::CannotDisputeInCurrentState
        );

        let caller = ctx.accounts.caller.key();
        require!(
            caller == escrow.buyer || caller == escrow.seller,
            EscrowError::UnauthorizedDisputeInitiator
        );

        let clock = Clock::get()?;
        escrow.status = ServiceEscrowStatus::Disputed;

        emit!(OrderDisputedEvent {
            order_id: escrow.order_id,
            opened_by: caller,
            reason,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Reviewer resolves a dispute, splitting escrow funds between buyer and seller.
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        split_to_buyer_percent: u8,
    ) -> Result<()> {
        require!(split_to_buyer_percent <= 100, EscrowError::InvalidSplitPercentage);

        let escrow = &mut ctx.accounts.escrow_order;
        require!(escrow.status == ServiceEscrowStatus::Disputed, EscrowError::OrderNotInDispute);

        let total_amount = escrow.amount;
        require!(total_amount > 0, EscrowError::OrderAmountZero);

        let buyer_share = total_amount
            .checked_mul(split_to_buyer_percent as u64)
            .ok_or(EscrowError::MathOverflow)?
            .checked_div(100)
            .ok_or(EscrowError::MathOverflow)?;
        let seller_share = total_amount
            .checked_sub(buyer_share)
            .ok_or(EscrowError::MathOverflow)?;

        // Fee applies only to the seller payout share
        let fee_amount = seller_share
            .checked_mul(escrow.fee_basis_points as u64)
            .ok_or(EscrowError::MathOverflow)?
            .checked_div(10000)
            .ok_or(EscrowError::MathOverflow)?;
        let net_seller_share = seller_share
            .checked_sub(fee_amount)
            .ok_or(EscrowError::MathOverflow)?;

        let order_id = escrow.order_id;
        let vault_bump = escrow.vault_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[VAULT_SEED, order_id.as_ref(), &[vault_bump]]];

        if buyer_share > 0 {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer.to_account_info(),
                },
                signer_seeds,
            );
            system_program::transfer(cpi_ctx, buyer_share)?;
        }

        if fee_amount > 0 {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.fee_recipient.to_account_info(),
                },
                signer_seeds,
            );
            system_program::transfer(cpi_ctx, fee_amount)?;
        }

        if net_seller_share > 0 {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
                signer_seeds,
            );
            system_program::transfer(cpi_ctx, net_seller_share)?;
        }

        let clock = Clock::get()?;
        let order_id = escrow.order_id;
        escrow.amount = 0;
        escrow.status = if split_to_buyer_percent == 100 {
            ServiceEscrowStatus::Refunded
        } else {
            ServiceEscrowStatus::Released
        };
        escrow.settled_at = clock.unix_timestamp;

        emit!(DisputeResolvedEvent {
            order_id,
            buyer_share,
            seller_share: net_seller_share,
            fee_amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

fn validate_config(reviewer: Pubkey, fee_recipient: Pubkey, fee_basis_points: u16) -> Result<()> {
    require!(reviewer != Pubkey::default(), EscrowError::InvalidConfig);
    require!(fee_recipient != Pubkey::default(), EscrowError::InvalidFeeRecipient);
    require!(fee_basis_points <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
    Ok(())
}

// ============================================================================
// Instruction Account Contexts
// ============================================================================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = EscrowConfig::ACCOUNT_SIZE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, EscrowConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ EscrowError::UnauthorizedAdmin)]
    pub program: Program<'info, crate::program::VeilioServiceEscrow>,

    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ EscrowError::UnauthorizedAdmin)]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ EscrowError::UnauthorizedAdmin
    )]
    pub config: Account<'info, EscrowConfig>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 32])]
pub struct DepositOrder<'info> {
    #[account(
        init,
        payer = buyer,
        space = EscrowOrder::ACCOUNT_SIZE,
        seeds = [ESCROW_SEED, order_id.as_ref()],
        bump
    )]
    pub escrow_order: Account<'info, EscrowOrder>,

    /// CHECK: Vault PDA holding escrow lamports
    #[account(
        mut,
        seeds = [VAULT_SEED, order_id.as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// Global platform config (appended last so existing account ordering is unchanged).
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, EscrowConfig>,
}

#[derive(Accounts)]
pub struct SubmitDelivery<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_order.order_id.as_ref()],
        bump = escrow_order.bump,
        has_one = seller @ EscrowError::UnauthorizedSeller
    )]
    pub escrow_order: Account<'info, EscrowOrder>,

    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReleaseFunds<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_order.order_id.as_ref()],
        bump = escrow_order.bump,
        has_one = buyer @ EscrowError::UnauthorizedBuyer,
        has_one = seller @ EscrowError::InvalidSellerAddress,
        has_one = fee_recipient @ EscrowError::InvalidFeeRecipient
    )]
    pub escrow_order: Account<'info, EscrowOrder>,

    /// CHECK: Vault PDA holding escrow lamports
    #[account(
        mut,
        seeds = [VAULT_SEED, escrow_order.order_id.as_ref()],
        bump = escrow_order.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    pub buyer: Signer<'info>,

    /// CHECK: Seller account receiving payout
    #[account(mut)]
    pub seller: AccountInfo<'info>,

    /// CHECK: Fee recipient snapshotted in the order (has_one); receives the platform fee
    #[account(mut)]
    pub fee_recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrRefund<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_order.order_id.as_ref()],
        bump = escrow_order.bump,
        has_one = buyer @ EscrowError::UnauthorizedBuyer
    )]
    pub escrow_order: Account<'info, EscrowOrder>,

    /// CHECK: Vault PDA holding escrow lamports
    #[account(
        mut,
        seeds = [VAULT_SEED, escrow_order.order_id.as_ref()],
        bump = escrow_order.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    pub caller: Signer<'info>,

    /// CHECK: Buyer account receiving 100% fee-free refund
    #[account(mut)]
    pub buyer: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DisputeOrder<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_order.order_id.as_ref()],
        bump = escrow_order.bump
    )]
    pub escrow_order: Account<'info, EscrowOrder>,

    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_order.order_id.as_ref()],
        bump = escrow_order.bump,
        has_one = buyer @ EscrowError::InvalidBuyerAddress,
        has_one = seller @ EscrowError::InvalidSellerAddress,
        has_one = fee_recipient @ EscrowError::InvalidFeeRecipient
    )]
    pub escrow_order: Account<'info, EscrowOrder>,

    /// CHECK: Vault PDA holding escrow lamports
    #[account(
        mut,
        seeds = [VAULT_SEED, escrow_order.order_id.as_ref()],
        bump = escrow_order.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    /// Must be the CURRENT platform reviewer from `config` (not a buyer-chosen address).
    #[account(address = config.reviewer @ EscrowError::UnauthorizedReviewer)]
    pub reviewer: Signer<'info>,

    /// CHECK: Buyer receiving share
    #[account(mut)]
    pub buyer: AccountInfo<'info>,

    /// CHECK: Seller receiving share
    #[account(mut)]
    pub seller: AccountInfo<'info>,

    /// CHECK: Fee recipient receiving platform fee
    #[account(mut)]
    pub fee_recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    /// Global platform config (appended last so existing account ordering is unchanged).
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, EscrowConfig>,
}

// ============================================================================
// State Account Definition
// ============================================================================

#[account]
pub struct EscrowOrder {
    pub buyer: Pubkey,                   // 32
    pub seller: Pubkey,                  // 32
    pub reviewer: Pubkey,                // 32
    pub fee_recipient: Pubkey,           // 32
    pub order_id: [u8; 32],              // 32
    pub amount: u64,                     // 8
    pub fee_basis_points: u16,           // 2
    pub deadline: i64,                   // 8
    pub status: ServiceEscrowStatus,     // 1
    pub created_at: i64,                 // 8
    pub settled_at: i64,                 // 8
    pub deliverable_reference: String,   // 4 + MAX_DELIVERABLE_REF_LEN (200) = 204
    pub bump: u8,                        // 1
    pub vault_bump: u8,                  // 1
}

impl EscrowOrder {
    // 8 (discriminator) + 32*5 + 8 + 2 + 8 + 1 + 8 + 8 + 204 + 1 + 1 = 443
    pub const ACCOUNT_SIZE: usize = 8 + 32 * 5 + 8 + 2 + 8 + 1 + 8 + 8 + (4 + MAX_DELIVERABLE_REF_LEN) + 1 + 1;
}

#[account]
pub struct EscrowConfig {
    pub admin: Pubkey,          // 32
    pub reviewer: Pubkey,       // 32
    pub fee_recipient: Pubkey,  // 32
    pub fee_basis_points: u16,  // 2
    pub bump: u8,               // 1
}

impl EscrowConfig {
    // 8 (discriminator) + 32 * 3 + 2 + 1 = 107
    pub const ACCOUNT_SIZE: usize = 8 + 32 * 3 + 2 + 1;
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct ConfigUpdatedEvent {
    pub admin: Pubkey,
    pub reviewer: Pubkey,
    pub fee_recipient: Pubkey,
    pub fee_basis_points: u16,
}

#[event]
pub struct OrderFundedEvent {
    pub order_id: [u8; 32],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub deadline: i64,
    pub timestamp: i64,
}

#[event]
pub struct DeliverySubmittedEvent {
    pub order_id: [u8; 32],
    pub seller: Pubkey,
    pub deliverable_reference: String,
    pub timestamp: i64,
}

#[event]
pub struct OrderReleasedEvent {
    pub order_id: [u8; 32],
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub seller_amount: u64,
    pub fee_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct OrderRefundedEvent {
    pub order_id: [u8; 32],
    pub buyer: Pubkey,
    pub refund_amount: u64,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct OrderDisputedEvent {
    pub order_id: [u8; 32],
    pub opened_by: Pubkey,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct DisputeResolvedEvent {
    pub order_id: [u8; 32],
    pub buyer_share: u64,
    pub seller_share: u64,
    pub fee_amount: u64,
    pub timestamp: i64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum EscrowError {
    #[msg("Invalid order ID (cannot be zero)")]
    InvalidOrderId,
    #[msg("Invalid seller address")]
    InvalidSellerAddress,
    #[msg("Invalid buyer address")]
    InvalidBuyerAddress,
    #[msg("Invalid fee recipient address")]
    InvalidFeeRecipient,
    #[msg("Buyer cannot be the seller")]
    BuyerCannotBeSeller,
    #[msg("Deposit amount must be greater than zero")]
    ZeroDepositAmount,
    #[msg("Deadline must be in the future")]
    DeadlineMustBeInFuture,
    #[msg("Order is not in funded status")]
    OrderNotFunded,
    #[msg("Order amount is zero")]
    OrderAmountZero,
    #[msg("Deliverable reference cannot be empty")]
    EmptyDeliverableReference,
    #[msg("Deliverable reference exceeds maximum length (200 bytes)")]
    DeliverableReferenceTooLong,
    #[msg("Delivery deadline has passed")]
    DeliveryDeadlinePassed,
    #[msg("Only the registered seller can submit deliverables")]
    UnauthorizedSeller,
    #[msg("Only the designated buyer can release funds")]
    UnauthorizedBuyer,
    #[msg("Only designated reviewer can resolve disputes")]
    UnauthorizedReviewer,
    #[msg("Unauthorized refund: buyer timeout only allowed before delivery")]
    UnauthorizedRefund,
    #[msg("Order cannot be disputed in this state")]
    CannotDisputeInCurrentState,
    #[msg("Only buyer or seller can dispute this order")]
    UnauthorizedDisputeInitiator,
    #[msg("Order is not in disputed state")]
    OrderNotInDispute,
    #[msg("Split percentage must be between 0 and 100")]
    InvalidSplitPercentage,
    #[msg("Math overflow during fee or share calculation")]
    MathOverflow,
    #[msg("Only the config admin / program upgrade authority can do this")]
    UnauthorizedAdmin,
    #[msg("Invalid platform configuration")]
    InvalidConfig,
    #[msg("Platform fee exceeds the 5% maximum")]
    FeeTooHigh,
    #[msg("The platform reviewer cannot be the buyer or seller of this order")]
    ReviewerNotIndependent,
}
