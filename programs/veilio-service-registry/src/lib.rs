use anchor_lang::prelude::*;

declare_id!("6CMoJyQmBobLTk4M9ZoygMShRB6A6i77e6viq2Lew2KY");

pub const SERVICE_SEED: &[u8] = b"service";
pub const MAX_METADATA_URI_LEN: usize = 200;

#[program]
pub mod veilio_service_registry {
    use super::*;

    /// Registers a new seller service listing on Solana.
    /// Derives a deterministic PDA: [b"service", service_id]
    pub fn register_service(
        ctx: Context<RegisterService>,
        service_id: [u8; 32],
        metadata_hash: [u8; 32],
        metadata_uri: String,
    ) -> Result<()> {
        require!(service_id != [0u8; 32], ServiceRegistryError::InvalidServiceId);
        require!(metadata_hash != [0u8; 32], ServiceRegistryError::InvalidMetadataHash);
        require!(!metadata_uri.is_empty(), ServiceRegistryError::EmptyMetadataUri);
        require!(
            metadata_uri.len() <= MAX_METADATA_URI_LEN,
            ServiceRegistryError::MetadataUriTooLong
        );

        let clock = Clock::get()?;
        let service_record = &mut ctx.accounts.service_record;

        service_record.seller = ctx.accounts.seller.key();
        service_record.service_id = service_id;
        service_record.metadata_hash = metadata_hash;
        service_record.metadata_uri = metadata_uri.clone();
        service_record.active = true;
        service_record.registered_at = clock.unix_timestamp;
        service_record.updated_at = clock.unix_timestamp;
        service_record.bump = ctx.bumps.service_record;

        emit!(ServiceRegisteredEvent {
            service_id,
            seller: ctx.accounts.seller.key(),
            metadata_hash,
            metadata_uri,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Updates the metadata hash and URI for an existing service listing.
    /// Strictly authorized to the registered seller via has_one = seller.
    pub fn update_service_metadata(
        ctx: Context<UpdateServiceMetadata>,
        new_metadata_hash: [u8; 32],
        new_metadata_uri: String,
    ) -> Result<()> {
        require!(new_metadata_hash != [0u8; 32], ServiceRegistryError::InvalidMetadataHash);
        require!(!new_metadata_uri.is_empty(), ServiceRegistryError::EmptyMetadataUri);
        require!(
            new_metadata_uri.len() <= MAX_METADATA_URI_LEN,
            ServiceRegistryError::MetadataUriTooLong
        );

        let clock = Clock::get()?;
        let service_record = &mut ctx.accounts.service_record;

        service_record.metadata_hash = new_metadata_hash;
        service_record.metadata_uri = new_metadata_uri.clone();
        service_record.updated_at = clock.unix_timestamp;

        emit!(ServiceMetadataUpdatedEvent {
            service_id: service_record.service_id,
            seller: ctx.accounts.seller.key(),
            new_metadata_hash,
            new_metadata_uri,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Activates or deactivates a service listing.
    /// Strictly authorized to the registered seller via has_one = seller.
    pub fn set_service_status(
        ctx: Context<SetServiceStatus>,
        active: bool,
    ) -> Result<()> {
        let service_record = &mut ctx.accounts.service_record;
        require!(
            service_record.active != active,
            ServiceRegistryError::StatusAlreadySet
        );

        let clock = Clock::get()?;
        service_record.active = active;
        service_record.updated_at = clock.unix_timestamp;

        emit!(ServiceStatusChangedEvent {
            service_id: service_record.service_id,
            seller: ctx.accounts.seller.key(),
            active,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(service_id: [u8; 32])]
pub struct RegisterService<'info> {
    #[account(
        init,
        payer = seller,
        space = ServiceRecord::ACCOUNT_SIZE,
        seeds = [SERVICE_SEED, seller.key().as_ref(), service_id.as_ref()],
        bump
    )]
    pub service_record: Account<'info, ServiceRecord>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateServiceMetadata<'info> {
    #[account(
        mut,
        seeds = [SERVICE_SEED, seller.key().as_ref(), service_record.service_id.as_ref()],
        bump = service_record.bump,
        has_one = seller @ ServiceRegistryError::UnauthorizedSeller
    )]
    pub service_record: Account<'info, ServiceRecord>,

    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetServiceStatus<'info> {
    #[account(
        mut,
        seeds = [SERVICE_SEED, seller.key().as_ref(), service_record.service_id.as_ref()],
        bump = service_record.bump,
        has_one = seller @ ServiceRegistryError::UnauthorizedSeller
    )]
    pub service_record: Account<'info, ServiceRecord>,

    pub seller: Signer<'info>,
}

#[account]
pub struct ServiceRecord {
    pub seller: Pubkey,          // 32
    pub service_id: [u8; 32],    // 32
    pub metadata_hash: [u8; 32], // 32
    pub metadata_uri: String,    // 4 + MAX_METADATA_URI_LEN (200) = 204
    pub active: bool,            // 1
    pub registered_at: i64,      // 8
    pub updated_at: i64,        // 8
    pub bump: u8,                // 1
}

impl ServiceRecord {
    // 8 (discriminator) + 32 + 32 + 32 + (4 + 200) + 1 + 8 + 8 + 1 = 326
    pub const ACCOUNT_SIZE: usize = 8 + 32 + 32 + 32 + (4 + MAX_METADATA_URI_LEN) + 1 + 8 + 8 + 1;
}

#[event]
pub struct ServiceRegisteredEvent {
    pub service_id: [u8; 32],
    pub seller: Pubkey,
    pub metadata_hash: [u8; 32],
    pub metadata_uri: String,
    pub timestamp: i64,
}

#[event]
pub struct ServiceMetadataUpdatedEvent {
    pub service_id: [u8; 32],
    pub seller: Pubkey,
    pub new_metadata_hash: [u8; 32],
    pub new_metadata_uri: String,
    pub timestamp: i64,
}

#[event]
pub struct ServiceStatusChangedEvent {
    pub service_id: [u8; 32],
    pub seller: Pubkey,
    pub active: bool,
    pub timestamp: i64,
}

#[error_code]
pub enum ServiceRegistryError {
    #[msg("Invalid service ID (cannot be zero)")]
    InvalidServiceId,
    #[msg("Invalid metadata hash (cannot be zero)")]
    InvalidMetadataHash,
    #[msg("Metadata URI cannot be empty")]
    EmptyMetadataUri,
    #[msg("Metadata URI exceeds maximum length (200 bytes)")]
    MetadataUriTooLong,
    #[msg("Only the registered seller can update or modify this service")]
    UnauthorizedSeller,
    #[msg("Status is already set to the requested value")]
    StatusAlreadySet,
}
