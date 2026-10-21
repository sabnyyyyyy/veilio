use anchor_lang::prelude::*;

const REFUND_REVIEW_TIMEOUT_SECONDS: i64 = 7 * 24 * 60 * 60;
use anchor_lang::system_program::{self, Transfer};
use anchor_lang::solana_program::hash::hashv;

// Devnet program ID; keep synchronized with Anchor.toml and the deploy keypair.
declare_id!("5Tw1iJGN1hhyRzepbD5eLoaRoZTEiKcqrh2HoZYhYEta");

pub const AUCTION_SEED: &[u8] = b"auction";
pub const BID_COMMITMENT_SEED: &[u8] = b"bid_commitment";
/// Global platform config PDA: [b"auction_config"]. Holds the platform dispute reviewer.
pub const CONFIG_SEED: &[u8] = b"auction_config";
pub const AUCTION_FEE_CONFIG_SEED: &[u8] = b"auction_fee_config";
pub const PLATFORM_FEE_BPS: u64 = 700;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const COMMITMENT_DOMAIN_TAG: &[u8] = b"VEILIO_AUCTION_COMMITMENT_V1";

pub const MAX_ITEM_NAME_LEN: usize = 64;
pub const MAX_DESC_LEN: usize = 128;
pub const MAX_IMAGE_URI_LEN: usize = 200;
pub const MAX_REVIEW_REASON_LEN: usize = 100;

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum AuctionState {
    #[default]
    Created = 0,
    Bidding = 1,
    Revealing = 2,
    Inspection = 3,
    RefundRequested = 4,
    UnderReview = 5,
    Completed = 6,
    Refunded = 7,
    Cancelled = 8,
}

#[program]
pub mod veilio_auction {
    use super::*;

    /// One-time creation of the global config PDA, restricted to the program upgrade authority.
    pub fn initialize_config(ctx: Context<InitializeConfig>, reviewer: Pubkey) -> Result<()> {
        require!(reviewer != Pubkey::default(), AuctionError::InvalidConfig);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.reviewer = reviewer;
        config.bump = ctx.bumps.config;
        emit!(ConfigUpdatedEvent { admin: config.admin, reviewer });
        Ok(())
    }

    /// Admin rotates the platform reviewer and/or hands over admin rights.
    pub fn update_config(ctx: Context<UpdateConfig>, reviewer: Pubkey, new_admin: Pubkey) -> Result<()> {
        require!(reviewer != Pubkey::default(), AuctionError::InvalidConfig);
        require!(new_admin != Pubkey::default(), AuctionError::InvalidConfig);
        let config = &mut ctx.accounts.config;
        config.admin = new_admin;
        config.reviewer = reviewer;
        emit!(ConfigUpdatedEvent { admin: new_admin, reviewer });
        Ok(())
    }

    /// Initializes the treasury used for future successful auction settlements.
    pub fn initialize_fee_config(ctx: Context<InitializeFeeConfig>, fee_recipient: Pubkey) -> Result<()> {
        require!(fee_recipient != Pubkey::default(), AuctionError::InvalidConfig);
        let fee_config = &mut ctx.accounts.fee_config;
        fee_config.admin = ctx.accounts.admin.key();
        fee_config.fee_recipient = fee_recipient;
        fee_config.bump = ctx.bumps.fee_config;
        emit!(AuctionFeeConfigUpdatedEvent { admin: fee_config.admin, fee_recipient });
        Ok(())
    }

    /// Rotates the auction treasury. Only future settlement transactions use the new recipient.
    pub fn update_fee_config(ctx: Context<UpdateFeeConfig>, fee_recipient: Pubkey) -> Result<()> {
        require!(fee_recipient != Pubkey::default(), AuctionError::InvalidConfig);
        let fee_config = &mut ctx.accounts.fee_config;
        fee_config.fee_recipient = fee_recipient;
        emit!(AuctionFeeConfigUpdatedEvent { admin: fee_config.admin, fee_recipient });
        Ok(())
    }

    /// Initializes a new sealed-bid auction container.
    ///
    /// The `reviewer` account is DEPRECATED and ignored (kept so the account list stays
    /// compatible); the dispute reviewer is always the platform reviewer from `config`, so a
    /// seller can no longer appoint a second wallet of their own.
    pub fn create_auction(
        ctx: Context<CreateAuction>,
        auction_id: u64,
        item_name: String,
        description: String,
        image_uri: String,
        starting_price: u64,
        commit_duration: i64,
        reveal_duration: i64,
        inspection_duration: i64,
    ) -> Result<()> {
        require!(commit_duration >= 60, AuctionError::CommitDurationTooShort);
        require!(reveal_duration >= 60, AuctionError::RevealDurationTooShort);
        require!(inspection_duration >= 3600, AuctionError::InspectionDurationTooShort);
        require!(starting_price > 0, AuctionError::StartingPriceMustBePositive);
        require!(item_name.len() <= MAX_ITEM_NAME_LEN, AuctionError::StringTooLong);
        require!(description.len() <= MAX_DESC_LEN, AuctionError::StringTooLong);
        require!(image_uri.len() <= MAX_IMAGE_URI_LEN, AuctionError::StringTooLong);

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        let auction = &mut ctx.accounts.auction;
        auction.seller = ctx.accounts.seller.key();
        // Informational snapshot; `review_refund` authorizes against the CURRENT config reviewer.
        auction.reviewer = ctx.accounts.config.reviewer;
        auction.auction_id = auction_id;
        auction.item_name = item_name.clone();
        auction.description = description;
        auction.image_uri = image_uri;
        auction.starting_price = starting_price;
        auction.commit_end_time = now.checked_add(commit_duration).ok_or(AuctionError::MathOverflow)?;
        auction.reveal_end_time = auction.commit_end_time.checked_add(reveal_duration).ok_or(AuctionError::MathOverflow)?;
        auction.inspection_duration = inspection_duration;
        auction.inspection_end_time = 0;
        auction.refund_requested_at = 0;
        require!(ctx.accounts.config.reviewer != ctx.accounts.seller.key(), AuctionError::ReviewerMustBeIndependent);
        auction.state = AuctionState::Bidding;
        auction.highest_bidder = Pubkey::default();
        auction.highest_bid = 0;
        auction.bidder_count = 0;
        auction.revealed_count = 0;
        auction.evidence_hash = [0u8; 32];
        auction.review_reason = String::new();
        auction.bump = ctx.bumps.auction;

        emit!(AuctionCreatedEvent {
            auction_id,
            seller: ctx.accounts.seller.key(),
            item_name,
            starting_price,
            commit_end_time: auction.commit_end_time,
            reveal_end_time: auction.reveal_end_time,
            inspection_duration,
        });

        Ok(())
    }

    /// Submits a sealed commitment and locks deposit in a dedicated BidCommitment PDA.
    pub fn commit_bid(
        ctx: Context<CommitBid>,
        commitment: [u8; 32],
        deposit_amount: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let auction = &mut ctx.accounts.auction;

        require!(auction.state == AuctionState::Bidding, AuctionError::BiddingPhaseEnded);
        require!(clock.unix_timestamp < auction.commit_end_time, AuctionError::BiddingPhaseEnded);
        require!(ctx.accounts.bidder.key() != auction.seller, AuctionError::SellerCannotBid);
        require!(deposit_amount >= auction.starting_price, AuctionError::DepositBelowStartingPrice);
        require!(commitment != [0u8; 32], AuctionError::InvalidCommitment);

        // The bidder's SOL is held in its program-owned commitment PDA. The
        // PDA was rent-funded by Anchor's `init` before this instruction runs.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.bidder.to_account_info(),
                    to: ctx.accounts.bid_commitment.to_account_info(),
                },
            ),
            deposit_amount,
        )?;

        let bid_commit = &mut ctx.accounts.bid_commitment;
        bid_commit.auction = auction.key();
        bid_commit.bidder = ctx.accounts.bidder.key();
        bid_commit.commitment = commitment;
        bid_commit.deposit = deposit_amount;
        bid_commit.max_bid = 0;
        bid_commit.revealed = false;
        bid_commit.bump = ctx.bumps.bid_commitment;

        auction.bidder_count = auction.bidder_count.checked_add(1).ok_or(AuctionError::MathOverflow)?;

        emit!(BidCommittedEvent {
            auction: auction.key(),
            bidder: ctx.accounts.bidder.key(),
            commitment,
            deposit: deposit_amount,
        });

        Ok(())
    }

    /// Reveals a sealed bid and updates highest bid tracking.
    pub fn reveal_bid(
        ctx: Context<RevealBid>,
        max_bid: u64,
        salt: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let auction = &mut ctx.accounts.auction;

        require!(now >= auction.commit_end_time, AuctionError::CommitPhaseStillActive);
        require!(now < auction.reveal_end_time, AuctionError::RevealPhaseEnded);
        require!(
            auction.state == AuctionState::Bidding || auction.state == AuctionState::Revealing,
            AuctionError::AuctionAlreadySettled
        );

        let (commitment, deposit) = {
            let bid_commit = &ctx.accounts.bid_commitment;
            require!(!bid_commit.revealed, AuctionError::BidAlreadyRevealed);
            (bid_commit.commitment, bid_commit.deposit)
        };

        // Domain-separated cryptographic hash verification:
        // sha256(COMMITMENT_DOMAIN_TAG || auction_key || bidder_key || max_bid_le || salt)
        let computed_hash = hashv(&[
            COMMITMENT_DOMAIN_TAG,
            auction.key().as_ref(),
            ctx.accounts.bidder.key().as_ref(),
            &max_bid.to_le_bytes(),
            &salt,
        ]);

        require!(computed_hash.to_bytes() == commitment, AuctionError::InvalidCommitmentSecret);
        require!(deposit >= max_bid, AuctionError::DepositLessThanMaxBid);
        require!(max_bid >= auction.starting_price, AuctionError::BidBelowStartingPrice);

        // Truncate active locked deposit to max_bid (over-deposit refund recorded)
        let excess_deposit = deposit.checked_sub(max_bid).ok_or(AuctionError::MathOverflow)?;
        if excess_deposit > 0 {
            transfer_program_lamports(
                &ctx.accounts.bid_commitment.to_account_info(),
                &ctx.accounts.bidder.to_account_info(),
                excess_deposit,
            )?;
        }

        let bid_commit = &mut ctx.accounts.bid_commitment;
        bid_commit.revealed = true;
        bid_commit.max_bid = max_bid;
        bid_commit.deposit = max_bid;

        auction.state = AuctionState::Revealing;
        auction.revealed_count = auction.revealed_count.checked_add(1).ok_or(AuctionError::MathOverflow)?;

        let is_highest = max_bid > auction.highest_bid;
        if is_highest {
            auction.highest_bid = max_bid;
            auction.highest_bidder = ctx.accounts.bidder.key();
        }

        emit!(BidRevealedEvent {
            auction: auction.key(),
            bidder: ctx.accounts.bidder.key(),
            max_bid,
            is_highest,
            excess_refunded: excess_deposit,
        });

        Ok(())
    }

    /// Concludes the reveal window and transitions auction to Inspection (if winner) or Completed (if no winner).
    pub fn settle_auction(ctx: Context<SettleAuction>) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let auction = &mut ctx.accounts.auction;

        require!(now >= auction.reveal_end_time, AuctionError::RevealPhaseNotFinished);
        require!(
            auction.state == AuctionState::Bidding || auction.state == AuctionState::Revealing,
            AuctionError::AuctionAlreadySettled
        );

        if auction.highest_bidder == Pubkey::default() {
            // No winner: Complete immediately
            auction.state = AuctionState::Completed;
            emit!(AuctionCompletedEvent {
                auction: auction.key(),
                seller: auction.seller,
                seller_amount: 0,
                platform_fee: 0,
                winner: Pubkey::default(),
            });
            return Ok(());
        }

        auction.state = AuctionState::Inspection;
        auction.inspection_end_time = now.checked_add(auction.inspection_duration).ok_or(AuctionError::MathOverflow)?;

        emit!(AuctionSettledToInspectionEvent {
            auction: auction.key(),
            winner: auction.highest_bidder,
            winning_price: auction.highest_bid,
            inspection_end_time: auction.inspection_end_time,
        });

        Ok(())
    }

    /// Winner accepts the dataset during the inspection window.
    pub fn accept_dataset(ctx: Context<WinnerSettlement>) -> Result<()> {
        let clock = Clock::get()?;
        let auction = &mut ctx.accounts.auction;
        require!(auction.state == AuctionState::Inspection, AuctionError::NotInInspectionPhase);
        require!(clock.unix_timestamp <= auction.inspection_end_time, AuctionError::InspectionPeriodEnded);
        require!(ctx.accounts.winner.key() == auction.highest_bidder, AuctionError::UnauthorizedWinner);
        require!(ctx.accounts.bid_commitment.revealed, AuctionError::WinnerBidNotRevealed);
        require!(ctx.accounts.bid_commitment.max_bid == auction.highest_bid, AuctionError::WinnerBidMismatch);

        auction.state = AuctionState::Completed;

        let winning_price = auction.highest_bid;
        let platform_fee = calculate_platform_fee(winning_price)?;
        let seller_amount = winning_price.checked_sub(platform_fee).ok_or(AuctionError::MathOverflow)?;
        transfer_program_lamports(
            &ctx.accounts.bid_commitment.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            seller_amount,
        )?;
        transfer_program_lamports(
            &ctx.accounts.bid_commitment.to_account_info(),
            &ctx.accounts.fee_recipient.to_account_info(),
            platform_fee,
        )?;

        emit!(DatasetAcceptedEvent {
            auction: auction.key(),
            winner: ctx.accounts.winner.key(),
        });

        emit!(AuctionCompletedEvent {
            auction: auction.key(),
            seller: auction.seller,
            seller_amount,
            platform_fee,
            winner: ctx.accounts.winner.key(),
        });

        Ok(())
    }

    /// Winner disputes dataset during inspection and requests a refund.
    pub fn request_refund(
        ctx: Context<RequestRefund>,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let auction = &mut ctx.accounts.auction;

        require!(auction.state == AuctionState::Inspection, AuctionError::NotInInspectionPhase);
        require!(now <= auction.inspection_end_time, AuctionError::InspectionPeriodEnded);
        require!(ctx.accounts.winner.key() == auction.highest_bidder, AuctionError::UnauthorizedWinner);
        require!(evidence_hash != [0u8; 32], AuctionError::InvalidEvidenceHash);

        auction.state = AuctionState::RefundRequested;
        auction.refund_requested_at = now;
        auction.evidence_hash = evidence_hash;

        emit!(RefundRequestedEvent {
            auction: auction.key(),
            winner: ctx.accounts.winner.key(),
            evidence_hash,
        });

        Ok(())
    }

    /// The platform reviewer (from `config`) resolves a requested refund. Approval returns
    /// the winner's escrow; rejection pays the seller. Unrevealed and losing
    /// bidder escrow is claimed independently via `claim_refund`.
    pub fn review_refund(ctx: Context<ReviewRefund>, approve: bool) -> Result<()> {
        let auction = &mut ctx.accounts.auction;
        require!(auction.state == AuctionState::RefundRequested, AuctionError::NoRefundRequested);
        require!(ctx.accounts.reviewer.key() == ctx.accounts.config.reviewer, AuctionError::UnauthorizedReviewer);
        require!(ctx.accounts.winner.key() == auction.highest_bidder, AuctionError::UnauthorizedWinner);
        require!(ctx.accounts.bid_commitment.revealed, AuctionError::WinnerBidNotRevealed);
        require!(ctx.accounts.bid_commitment.max_bid == auction.highest_bid, AuctionError::WinnerBidMismatch);

        if approve {
            auction.state = AuctionState::Refunded;
            emit!(RefundResolvedEvent {
                auction: auction.key(),
                winner: ctx.accounts.winner.key(),
                approved: true,
            });
        } else {
            let platform_fee = calculate_platform_fee(auction.highest_bid)?;
            let seller_amount = auction.highest_bid.checked_sub(platform_fee).ok_or(AuctionError::MathOverflow)?;
            transfer_program_lamports(
                &ctx.accounts.bid_commitment.to_account_info(),
                &ctx.accounts.seller.to_account_info(),
                seller_amount,
            )?;
            transfer_program_lamports(
                &ctx.accounts.bid_commitment.to_account_info(),
                &ctx.accounts.fee_recipient.to_account_info(),
                platform_fee,
            )?;
            auction.state = AuctionState::Completed;
            emit!(AuctionCompletedEvent {
                auction: auction.key(),
                seller: auction.seller,
                seller_amount,
                platform_fee,
                winner: ctx.accounts.winner.key(),
            });
            emit!(RefundResolvedEvent {
                auction: auction.key(),
                winner: ctx.accounts.winner.key(),
                approved: false,
            });
        }

        Ok(())
    }

    /// If the configured reviewer does not decide within seven days, the
    /// winner can recover the escrow instead of having funds locked forever.
    pub fn finalize_refund_timeout(ctx: Context<FinalizeRefundTimeout>) -> Result<()> {
        let auction = &mut ctx.accounts.auction;
        require!(auction.state == AuctionState::RefundRequested, AuctionError::NoRefundRequested);
        require!(auction.highest_bidder == ctx.accounts.winner.key(), AuctionError::UnauthorizedWinner);
        let deadline = auction.refund_requested_at
            .checked_add(REFUND_REVIEW_TIMEOUT_SECONDS)
            .ok_or(AuctionError::MathOverflow)?;
        require!(Clock::get()?.unix_timestamp >= deadline, AuctionError::RefundReviewStillActive);
        auction.state = AuctionState::Refunded;
        emit!(RefundResolvedEvent {
            auction: auction.key(),
            winner: ctx.accounts.winner.key(),
            approved: true,
        });
        Ok(())
    }

    /// If no refund was requested, anyone can finalize after inspection and
    /// pay the seller. This prevents a winner from locking escrow forever.
    pub fn finalize_inspection_timeout(ctx: Context<FinalizeInspectionTimeout>) -> Result<()> {
        let clock = Clock::get()?;
        let auction = &mut ctx.accounts.auction;
        require!(auction.state == AuctionState::Inspection, AuctionError::NotInInspectionPhase);
        require!(clock.unix_timestamp > auction.inspection_end_time, AuctionError::InspectionPeriodStillActive);
        require!(ctx.accounts.winner.key() == auction.highest_bidder, AuctionError::UnauthorizedWinner);
        require!(ctx.accounts.bid_commitment.revealed, AuctionError::WinnerBidNotRevealed);
        require!(ctx.accounts.bid_commitment.max_bid == auction.highest_bid, AuctionError::WinnerBidMismatch);

        let platform_fee = calculate_platform_fee(auction.highest_bid)?;
        let seller_amount = auction.highest_bid.checked_sub(platform_fee).ok_or(AuctionError::MathOverflow)?;
        transfer_program_lamports(
            &ctx.accounts.bid_commitment.to_account_info(),
            &ctx.accounts.seller.to_account_info(),
            seller_amount,
        )?;
        transfer_program_lamports(
            &ctx.accounts.bid_commitment.to_account_info(),
            &ctx.accounts.fee_recipient.to_account_info(),
            platform_fee,
        )?;
        auction.state = AuctionState::Completed;
        emit!(AuctionCompletedEvent {
            auction: auction.key(),
            seller: auction.seller,
            seller_amount,
            platform_fee,
            winner: ctx.accounts.winner.key(),
        });
        Ok(())
    }

    /// Allows each non-winning bidder, including non-revealers, to recover
    /// their full SOL deposit after the reveal window and auction settlement.
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        let bid_commitment = &ctx.accounts.bid_commitment;
        let now = Clock::get()?.unix_timestamp;
        require!(now >= auction.reveal_end_time, AuctionError::RevealPhaseNotFinished);
        require!(
            auction.state == AuctionState::Inspection
                || auction.state == AuctionState::RefundRequested
                || auction.state == AuctionState::Completed
                || auction.state == AuctionState::Refunded,
            AuctionError::AuctionNotSettled
        );
        require!(
            bid_commitment.bidder != auction.highest_bidder || auction.state == AuctionState::Refunded,
            AuctionError::WinnerFundsLocked
        );
        Ok(())
    }
}

fn transfer_program_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    require!(from.owner == &crate::ID, AuctionError::InvalidEscrowOwner);
    require!(from.is_writable && to.is_writable, AuctionError::EscrowAccountNotWritable);
    require!(from.key != to.key, AuctionError::InvalidEscrowDestination);

    let from_balance = from.lamports();
    let to_balance = to.lamports();
    let new_from_balance = from_balance.checked_sub(amount).ok_or(AuctionError::InsufficientEscrow)?;
    let new_to_balance = to_balance.checked_add(amount).ok_or(AuctionError::MathOverflow)?;

    **from.try_borrow_mut_lamports()? = new_from_balance;
    **to.try_borrow_mut_lamports()? = new_to_balance;
    Ok(())
}

fn calculate_platform_fee(winning_price: u64) -> Result<u64> {
    Ok(winning_price
        .checked_mul(PLATFORM_FEE_BPS)
        .ok_or(AuctionError::MathOverflow)
        .map(|amount| amount / BPS_DENOMINATOR)?)
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = AuctionConfig::ACCOUNT_SIZE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, AuctionConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: The address is fixed to this program and ProgramData is validated below.
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,

    #[account(
        seeds = [program.key().as_ref()],
        bump,
        seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(admin.key()) @ AuctionError::UnauthorizedAdmin
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeFeeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = AuctionFeeConfig::ACCOUNT_SIZE,
        seeds = [AUCTION_FEE_CONFIG_SEED],
        bump
    )]
    pub fee_config: Account<'info, AuctionFeeConfig>,

    #[account(mut, address = config.admin @ AuctionError::UnauthorizedAdmin)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, AuctionConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFeeConfig<'info> {
    #[account(mut, seeds = [AUCTION_FEE_CONFIG_SEED], bump = fee_config.bump)]
    pub fee_config: Account<'info, AuctionFeeConfig>,

    #[account(address = fee_config.admin @ AuctionError::UnauthorizedAdmin)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ AuctionError::UnauthorizedAdmin
    )]
    pub config: Account<'info, AuctionConfig>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct CreateAuction<'info> {
    #[account(
        init,
        payer = seller,
        space = AuctionStateAccount::ACCOUNT_SIZE,
        seeds = [AUCTION_SEED, &auction_id.to_le_bytes()],
        bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: DEPRECATED and ignored; the reviewer comes from `config`. Kept for account-list compatibility.
    pub reviewer: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// Global platform config (appended last so existing account ordering is unchanged).
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, AuctionConfig>,
}

#[derive(Accounts)]
pub struct CommitBid<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    #[account(
        init,
        payer = bidder,
        space = BidCommitmentAccount::ACCOUNT_SIZE,
        seeds = [BID_COMMITMENT_SEED, auction.key().as_ref(), bidder.key().as_ref()],
        bump
    )]
    pub bid_commitment: Account<'info, BidCommitmentAccount>,

    #[account(mut)]
    pub bidder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealBid<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    #[account(
        mut,
        seeds = [BID_COMMITMENT_SEED, auction.key().as_ref(), bidder.key().as_ref()],
        bump = bid_commitment.bump,
        has_one = auction,
        has_one = bidder
    )]
    pub bid_commitment: Account<'info, BidCommitmentAccount>,

    // Receives the excess-deposit refund, so it must be writable.
    #[account(mut)]
    pub bidder: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleAuction<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,
}

#[derive(Accounts)]
pub struct WinnerSettlement<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    #[account(
        mut,
        close = winner,
        seeds = [BID_COMMITMENT_SEED, auction.key().as_ref(), winner.key().as_ref()],
        bump = bid_commitment.bump,
        has_one = auction,
        constraint = bid_commitment.bidder == winner.key()
    )]
    pub bid_commitment: Account<'info, BidCommitmentAccount>,

    /// CHECK: Must be the stored seller; receives the winning SOL payment.
    #[account(mut, address = auction.seller)]
    pub seller: UncheckedAccount<'info>,

    // `bid_commitment` closes to the winner, so the winner must be writable
    // to receive the PDA's rent reserve after settlement.
    #[account(mut)]
    pub winner: Signer<'info>,

    #[account(seeds = [AUCTION_FEE_CONFIG_SEED], bump = fee_config.bump)]
    pub fee_config: Account<'info, AuctionFeeConfig>,

    /// CHECK: Must be the configured platform treasury.
    #[account(mut, address = fee_config.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeInspectionTimeout<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    #[account(
        mut,
        close = winner,
        seeds = [BID_COMMITMENT_SEED, auction.key().as_ref(), winner.key().as_ref()],
        bump = bid_commitment.bump,
        has_one = auction,
        constraint = bid_commitment.bidder == winner.key(),
        constraint = bid_commitment.revealed
    )]
    pub bid_commitment: Account<'info, BidCommitmentAccount>,

    /// CHECK: Must match the seller recorded in the auction.
    #[account(mut, address = auction.seller)]
    pub seller: UncheckedAccount<'info>,

    /// CHECK: Must be the recorded winner; receives the commitment account's rent reserve.
    #[account(mut)]
    pub winner: SystemAccount<'info>,

    /// Any signer may trigger settlement after inspection expires.
    pub caller: Signer<'info>,

    #[account(seeds = [AUCTION_FEE_CONFIG_SEED], bump = fee_config.bump)]
    pub fee_config: Account<'info, AuctionFeeConfig>,

    /// CHECK: Must be the configured platform treasury.
    #[account(mut, address = fee_config.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ReviewRefund<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    #[account(
        mut,
        close = winner,
        seeds = [BID_COMMITMENT_SEED, auction.key().as_ref(), winner.key().as_ref()],
        bump = bid_commitment.bump,
        has_one = auction,
        constraint = bid_commitment.bidder == winner.key()
    )]
    pub bid_commitment: Account<'info, BidCommitmentAccount>,

    /// CHECK: Must be the stored seller; receives funds only when refund is rejected.
    #[account(mut, address = auction.seller)]
    pub seller: UncheckedAccount<'info>,

    /// Must be the CURRENT platform reviewer from `config`.
    #[account(address = config.reviewer @ AuctionError::UnauthorizedReviewer)]
    pub reviewer: Signer<'info>,

    #[account(mut)]
    pub winner: SystemAccount<'info>,

    /// Global platform config (appended last so existing account ordering is unchanged).
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, AuctionConfig>,

    #[account(seeds = [AUCTION_FEE_CONFIG_SEED], bump = fee_config.bump)]
    pub fee_config: Account<'info, AuctionFeeConfig>,

    /// CHECK: Must be the configured platform treasury.
    #[account(mut, address = fee_config.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeRefundTimeout<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    #[account(
        mut,
        close = winner,
        seeds = [BID_COMMITMENT_SEED, auction.key().as_ref(), winner.key().as_ref()],
        bump = bid_commitment.bump,
        has_one = auction,
        constraint = bid_commitment.bidder == winner.key(),
        constraint = bid_commitment.revealed
    )]
    pub bid_commitment: Account<'info, BidCommitmentAccount>,

    #[account(mut)]
    pub winner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RequestRefund<'info> {
    #[account(
        mut,
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    pub winner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(
        seeds = [AUCTION_SEED, &auction.auction_id.to_le_bytes()],
        bump = auction.bump
    )]
    pub auction: Account<'info, AuctionStateAccount>,

    #[account(
        mut,
        close = bidder,
        seeds = [BID_COMMITMENT_SEED, auction.key().as_ref(), bidder.key().as_ref()],
        bump = bid_commitment.bump,
        has_one = auction,
        has_one = bidder
    )]
    pub bid_commitment: Account<'info, BidCommitmentAccount>,

    #[account(mut)]
    pub bidder: Signer<'info>,
}

#[account]
pub struct AuctionStateAccount {
    pub seller: Pubkey,          // 32
    pub reviewer: Pubkey,       // 32
    pub auction_id: u64,         // 8
    pub item_name: String,       // 4 + 64 = 68
    pub description: String,     // 4 + 128 = 132
    pub image_uri: String,       // 4 + 200 = 204
    pub starting_price: u64,     // 8
    pub commit_end_time: i64,    // 8
    pub reveal_end_time: i64,    // 8
    pub inspection_duration: i64,// 8
    pub inspection_end_time: i64,// 8
    pub refund_requested_at: i64,// 8
    pub state: AuctionState,     // 1
    pub highest_bidder: Pubkey,  // 32
    pub highest_bid: u64,        // 8
    pub bidder_count: u32,       // 4
    pub revealed_count: u32,     // 4
    pub evidence_hash: [u8; 32], // 32
    pub review_reason: String,   // 4 + 100 = 104
    pub bump: u8,                // 1
}

impl AuctionStateAccount {
    // discriminator + fixed account fields + maximum serialized strings
    pub const ACCOUNT_SIZE: usize = 718;
}

#[account]
pub struct AuctionConfig {
    pub admin: Pubkey,    // 32
    pub reviewer: Pubkey, // 32
    pub bump: u8,         // 1
}

#[account]
pub struct AuctionFeeConfig {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub bump: u8,
}

impl AuctionFeeConfig {
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 1;
}

impl AuctionConfig {
    // 8 (disc) + 32 + 32 + 1 = 73
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 1;
}

#[event]
pub struct ConfigUpdatedEvent {
    pub admin: Pubkey,
    pub reviewer: Pubkey,
}

#[event]
pub struct AuctionFeeConfigUpdatedEvent {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
}

#[account]
pub struct BidCommitmentAccount {
    pub auction: Pubkey,         // 32
    pub bidder: Pubkey,          // 32
    pub commitment: [u8; 32],    // 32
    pub deposit: u64,            // 8
    pub max_bid: u64,            // 8
    pub revealed: bool,          // 1
    pub bump: u8,                // 1
}

impl BidCommitmentAccount {
    // 8 (disc) + 32 + 32 + 32 + 8 + 8 + 1 + 1 = 122
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1;
}

#[event]
pub struct AuctionCreatedEvent {
    pub auction_id: u64,
    pub seller: Pubkey,
    pub item_name: String,
    pub starting_price: u64,
    pub commit_end_time: i64,
    pub reveal_end_time: i64,
    pub inspection_duration: i64,
}

#[event]
pub struct BidCommittedEvent {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub commitment: [u8; 32],
    pub deposit: u64,
}

#[event]
pub struct BidRevealedEvent {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub max_bid: u64,
    pub is_highest: bool,
    pub excess_refunded: u64,
}

#[event]
pub struct AuctionSettledToInspectionEvent {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub winning_price: u64,
    pub inspection_end_time: i64,
}

#[event]
pub struct DatasetAcceptedEvent {
    pub auction: Pubkey,
    pub winner: Pubkey,
}

#[event]
pub struct RefundRequestedEvent {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub evidence_hash: [u8; 32],
}

#[event]
pub struct RefundResolvedEvent {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub approved: bool,
}

#[event]
pub struct AuctionCompletedEvent {
    pub auction: Pubkey,
    pub seller: Pubkey,
    pub seller_amount: u64,
    pub platform_fee: u64,
    pub winner: Pubkey,
}

#[error_code]
pub enum AuctionError {
    #[msg("Only the configured auction admin can manage configuration")]
    UnauthorizedAdmin,
    #[msg("Commit duration must be at least 60 seconds")]
    CommitDurationTooShort,
    #[msg("Reveal duration must be at least 60 seconds")]
    RevealDurationTooShort,
    #[msg("Inspection duration must be at least 3600 seconds (1 hour)")]
    InspectionDurationTooShort,
    #[msg("Starting price must be positive")]
    StartingPriceMustBePositive,
    #[msg("String field exceeds maximum allowed length")]
    StringTooLong,
    #[msg("Bidding phase has ended")]
    BiddingPhaseEnded,
    #[msg("Seller cannot bid on own auction")]
    SellerCannotBid,
    #[msg("Deposit amount is below the starting reserve price")]
    DepositBelowStartingPrice,
    #[msg("Invalid commitment hash: cannot be zero")]
    InvalidCommitment,
    #[msg("Commit phase is still active; reveals forbidden")]
    CommitPhaseStillActive,
    #[msg("Reveal phase has ended")]
    RevealPhaseEnded,
    #[msg("Bid has already been revealed")]
    BidAlreadyRevealed,
    #[msg("Invalid bid parameters or secret: commitment mismatch")]
    InvalidCommitmentSecret,
    #[msg("Deposit is less than declared max bid")]
    DepositLessThanMaxBid,
    #[msg("Bid is below starting price")]
    BidBelowStartingPrice,
    #[msg("Reveal phase is not finished yet")]
    RevealPhaseNotFinished,
    #[msg("Auction is already settled")]
    AuctionAlreadySettled,
    #[msg("Auction is not in the inspection phase")]
    NotInInspectionPhase,
    #[msg("Only the winning highest bidder can perform this action")]
    UnauthorizedWinner,
    #[msg("Inspection period has ended; refund request forbidden")]
    InspectionPeriodEnded,
    #[msg("Invalid evidence hash for refund request")]
    InvalidEvidenceHash,
    #[msg("Arithmetic overflow or underflow")]
    MathOverflow,
    #[msg("Bid escrow is not owned by this program")]
    InvalidEscrowOwner,
    #[msg("Escrow source and destination must be writable")]
    EscrowAccountNotWritable,
    #[msg("Escrow source and destination cannot be the same account")]
    InvalidEscrowDestination,
    #[msg("Escrow does not contain enough lamports")]
    InsufficientEscrow,
    #[msg("The winner's funds are still locked pending inspection or review")]
    WinnerFundsLocked,
    #[msg("The auction has not been settled")]
    AuctionNotSettled,
    #[msg("This auction has no pending refund request")]
    NoRefundRequested,
    #[msg("Only the configured auction reviewer can resolve a refund")]
    UnauthorizedReviewer,
    #[msg("The winning bid record is missing or was not revealed")]
    WinnerBidNotRevealed,
    #[msg("The winning bid escrow does not match the settled auction amount")]
    WinnerBidMismatch,
    #[msg("The inspection period is still active")]
    InspectionPeriodStillActive,
    #[msg("The reviewer still has time to resolve the refund request")]
    RefundReviewStillActive,
    #[msg("The dispute reviewer must be different from the seller")]
    ReviewerMustBeIndependent,
    #[msg("Invalid platform configuration")]
    InvalidConfig,
}
