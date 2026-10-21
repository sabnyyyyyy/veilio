/**
 * VEILIO Solana Auction Client & Instruction Interface
 * 
 * Implements client-side PDA derivation, Anchor instruction encoding,
 * domain-separated sealed commitment calculation, and account deserialization
 * for the on-chain Solana Devnet Veilio Auction program.
 */

import { createHash } from 'node:crypto';
import {
  encodeBase58,
  decodeBase58,
  findProgramDerivedAddress,
  getAnchorDiscriminator,
  findProgramDataPda,
  decodePubkey32,
  SYSTEM_PROGRAM_ID,
  type SolanaAccountMeta,
  type SolanaCompiledInstruction,
} from './registry.js';

export const AUCTION_SEED = Buffer.from('auction');
export const BID_COMMITMENT_SEED = Buffer.from('bid_commitment');
export const COMMITMENT_DOMAIN_TAG = Buffer.from('VEILIO_AUCTION_COMMITMENT_V1');
/** Global platform config PDA seed: [b"auction_config"] (AuctionConfig account). */
export const AUCTION_CONFIG_SEED = Buffer.from('auction_config');
export const AUCTION_FEE_CONFIG_SEED = Buffer.from('auction_fee_config');
export const AUCTION_FEE_CONFIG_ACCOUNT_SIZE = 73;
export const AUCTION_PLATFORM_FEE_BPS = 700;
/** 8 (discriminator) + 32 admin + 32 reviewer + 1 bump */
export const AUCTION_CONFIG_ACCOUNT_SIZE = 73;

export const DEFAULT_SOLANA_AUCTION_PROGRAM_ID =
  '5Tw1iJGN1hhyRzepbD5eLoaRoZTEiKcqrh2HoZYhYEta';

export const MAX_ITEM_NAME_LEN = 64;
export const MAX_DESC_LEN = 128;
export const MAX_IMAGE_URI_LEN = 200;
export const MAX_REVIEW_REASON_LEN = 100;

export enum SolanaAuctionState {
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

export function getSolanaAuctionProgramId(): string {
  return DEFAULT_SOLANA_AUCTION_PROGRAM_ID;
}

/**
 * Derives the deterministic PDA for an Auction on Solana.
 * Seeds: [b"auction", auction_id: u64 LE]
 */
export function findAuctionPda(
  auctionId: bigint | number,
  programId: string = getSolanaAuctionProgramId()
): { pda: string; bump: number } {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(auctionId), 0);
  return findProgramDerivedAddress([AUCTION_SEED, idBuf], programId);
}

/**
 * Derives the global AuctionConfig PDA: [b"auction_config"]. Holds the platform refund reviewer
 * that the upgraded program uses for create_auction / review_refund.
 */
export function findAuctionConfigPda(
  programId: string = getSolanaAuctionProgramId()
): { pda: string; bump: number } {
  return findProgramDerivedAddress([AUCTION_CONFIG_SEED], programId);
}

export function findAuctionFeeConfigPda(
  programId: string = getSolanaAuctionProgramId()
): { pda: string; bump: number } {
  return findProgramDerivedAddress([AUCTION_FEE_CONFIG_SEED], programId);
}

export interface DecodedAuctionFeeConfig {
  admin: string;
  feeRecipient: string;
  bump: number;
}

export function decodeAuctionFeeConfigAccount(data: Buffer | Uint8Array): DecodedAuctionFeeConfig {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < AUCTION_FEE_CONFIG_ACCOUNT_SIZE) throw new Error(`Buffer too short for AuctionFeeConfig: ${buf.length} bytes`);
  if (!buf.subarray(0, 8).equals(getAnchorDiscriminator('account', 'AuctionFeeConfig'))) throw new Error('Invalid account discriminator: not an AuctionFeeConfig');
  return { admin: encodeBase58(buf.subarray(8, 40)), feeRecipient: encodeBase58(buf.subarray(40, 72)), bump: buf.readUInt8(72) };
}

export function createInitializeAuctionFeeConfigInstruction(params: {
  programId?: string;
  admin: string;
  feeRecipient: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const { pda: feeConfigPda } = findAuctionFeeConfigPda(programId);
  return {
    programId,
    accounts: [
      { pubkey: feeConfigPda, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: findAuctionConfigPda(programId).pda, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([getAnchorDiscriminator('global', 'initialize_fee_config'), nonDefaultPubkey(params.feeRecipient, 'fee recipient')]),
  };
}

export function createUpdateAuctionFeeConfigInstruction(params: {
  programId?: string;
  admin: string;
  feeRecipient: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  return {
    programId,
    accounts: [
      { pubkey: findAuctionFeeConfigPda(programId).pda, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([getAnchorDiscriminator('global', 'update_fee_config'), nonDefaultPubkey(params.feeRecipient, 'fee recipient')]),
  };
}

export interface DecodedAuctionConfig {
  admin: string;
  reviewer: string;
  bump: number;
}

/** Decodes the AuctionConfig account (admin, reviewer, bump). */
export function decodeAuctionConfigAccount(data: Buffer | Uint8Array): DecodedAuctionConfig {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < AUCTION_CONFIG_ACCOUNT_SIZE) {
    throw new Error(`Buffer too short for AuctionConfig: ${buf.length} bytes`);
  }
  if (!buf.subarray(0, 8).equals(getAnchorDiscriminator('account', 'AuctionConfig'))) {
    throw new Error('Invalid account discriminator: not an AuctionConfig');
  }
  const admin = encodeBase58(buf.subarray(8, 40));
  const reviewer = encodeBase58(buf.subarray(40, 72));
  const bump = buf.readUInt8(72);
  return { admin, reviewer, bump };
}

function nonDefaultPubkey(value: string, label: string): Buffer {
  const bytes = decodePubkey32(value, label);
  if (bytes.every((b) => b === 0)) throw new Error(`${label} cannot be the default (all-zero) public key`);
  return bytes;
}

/**
 * Builds `initialize_config(reviewer)`. Only the program's upgrade authority (`admin`) can call it, once.
 * accounts: [config (mut, pda), admin (signer, mut), program, program_data, system_program]
 */
export function createInitializeAuctionConfigInstruction(params: {
  programId?: string;
  admin: string;
  reviewer: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const reviewerBytes = nonDefaultPubkey(params.reviewer, 'reviewer');
  const { pda: configPda } = findAuctionConfigPda(programId);
  const { pda: programDataPda } = findProgramDataPda(programId);
  return {
    programId,
    accounts: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: true },
      { pubkey: programId, isSigner: false, isWritable: false },
      { pubkey: programDataPda, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([getAnchorDiscriminator('global', 'initialize_config'), reviewerBytes]),
  };
}

/**
 * Builds `update_config(reviewer, new_admin)`. Signed by the current config admin; `newAdmin`
 * defaults to `admin` (no hand-over).
 * accounts: [config (mut, pda), admin (signer)]
 */
export function createUpdateAuctionConfigInstruction(params: {
  programId?: string;
  admin: string;
  reviewer: string;
  newAdmin?: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const reviewerBytes = nonDefaultPubkey(params.reviewer, 'reviewer');
  const newAdminBytes = nonDefaultPubkey(params.newAdmin || params.admin, 'new admin');
  const { pda: configPda } = findAuctionConfigPda(programId);
  return {
    programId,
    accounts: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: params.admin, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([getAnchorDiscriminator('global', 'update_config'), reviewerBytes, newAdminBytes]),
  };
}

/**
 * Derives the deterministic PDA for a Bidder's Commitment on Solana.
 * Seeds: [b"bid_commitment", auction_pubkey, bidder_pubkey]
 */
export function findBidCommitmentPda(
  auctionPubkey: string,
  bidderPubkey: string,
  programId: string = getSolanaAuctionProgramId()
): { pda: string; bump: number } {
  const auctionBytes = Buffer.from(decodeBase58(auctionPubkey));
  const bidderBytes = Buffer.from(decodeBase58(bidderPubkey));
  return findProgramDerivedAddress([BID_COMMITMENT_SEED, auctionBytes, bidderBytes], programId);
}

/**
 * Computes domain-separated sealed bid commitment:
 * SHA-256(b"VEILIO_AUCTION_COMMITMENT_V1" || auction_key || bidder_key || max_bid_le || salt)
 */
export function computeSealedBidCommitment(params: {
  auctionPubkey: string;
  bidderPubkey: string;
  maxBidLamports: bigint | number;
  salt: Uint8Array | Buffer;
}): Buffer {
  const auctionBytes = Buffer.from(decodeBase58(params.auctionPubkey));
  const bidderBytes = Buffer.from(decodeBase58(params.bidderPubkey));
  const saltBuf = Buffer.isBuffer(params.salt) ? params.salt : Buffer.from(params.salt);

  if (saltBuf.length !== 32) {
    throw new Error(`Salt must be exactly 32 bytes (received ${saltBuf.length})`);
  }

  const maxBidBuf = Buffer.alloc(8);
  maxBidBuf.writeBigUInt64LE(BigInt(params.maxBidLamports), 0);

  return createHash('sha256')
    .update(COMMITMENT_DOMAIN_TAG)
    .update(auctionBytes)
    .update(bidderBytes)
    .update(maxBidBuf)
    .update(saltBuf)
    .digest();
}

export interface DecodedAuctionState {
  seller: string;
  reviewer: string;
  auctionId: bigint;
  itemName: string;
  description: string;
  imageUri: string;
  startingPrice: bigint;
  commitEndTime: number;
  revealEndTime: number;
  inspectionDuration: number;
  inspectionEndTime: number;
  refundRequestedAt: number;
  state: SolanaAuctionState;
  highestBidder: string;
  highestBid: bigint;
  bidderCount: number;
  revealedCount: number;
  evidenceHash: string;
  reviewReason: string;
  bump: number;
}

export interface DecodedBidCommitment {
  auction: string;
  bidder: string;
  commitment: string;
  deposit: bigint;
  maxBid: bigint;
  revealed: boolean;
  bump: number;
}

/**
 * Builds `create_auction` instruction.
 * accounts: [auction (mut, pda), seller (signer, mut), reviewer, system_program, config]
 *
 * The upgraded program ignores the `reviewer` account (kept for layout compatibility) and uses
 * the platform reviewer from the trailing read-only `config` PDA. The pre-upgrade program
 * stores `reviewer` and ignores `config` as an Anchor remaining account.
 */
export function createCreateAuctionInstruction(params: {
  programId?: string;
  seller: string;
  reviewer: string;
  auctionId: bigint | number;
  itemName: string;
  description: string;
  imageUri: string;
  startingPriceLamports: bigint | number;
  commitDurationSeconds: number;
  revealDurationSeconds: number;
  inspectionDurationSeconds: number;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();

  if (params.commitDurationSeconds < 60) {
    throw new Error('Commit duration must be at least 60 seconds');
  }
  if (params.revealDurationSeconds < 60) {
    throw new Error('Reveal duration must be at least 60 seconds');
  }
  if (params.inspectionDurationSeconds < 3600) {
    throw new Error('Inspection duration must be at least 3600 seconds (1 hour)');
  }
  if (BigInt(params.startingPriceLamports) <= 0n) {
    throw new Error('Starting price must be positive');
  }

  const nameBuf = Buffer.from(params.itemName, 'utf8');
  if (nameBuf.length > MAX_ITEM_NAME_LEN) {
    throw new Error(`Item name exceeds max length (${MAX_ITEM_NAME_LEN} bytes)`);
  }
  const descBuf = Buffer.from(params.description, 'utf8');
  if (descBuf.length > MAX_DESC_LEN) {
    throw new Error(`Description exceeds max length (${MAX_DESC_LEN} bytes)`);
  }
  const uriBuf = Buffer.from(params.imageUri, 'utf8');
  if (uriBuf.length > MAX_IMAGE_URI_LEN) {
    throw new Error(`Image URI exceeds max length (${MAX_IMAGE_URI_LEN} bytes)`);
  }

  const { pda } = findAuctionPda(params.auctionId, programId);
  const discriminator = getAnchorDiscriminator('global', 'create_auction');

  // Serialization layout:
  // [8 disc] + [8 auction_id] + [4+nameLen] + [4+descLen] + [4+uriLen] + [8 startingPrice] + [8 commitDur] + [8 revealDur] + [8 inspDur]
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(params.auctionId), 0);

  const priceBuf = Buffer.alloc(8);
  priceBuf.writeBigUInt64LE(BigInt(params.startingPriceLamports), 0);

  const commitBuf = Buffer.alloc(8);
  commitBuf.writeBigInt64LE(BigInt(params.commitDurationSeconds), 0);

  const revealBuf = Buffer.alloc(8);
  revealBuf.writeBigInt64LE(BigInt(params.revealDurationSeconds), 0);

  const inspBuf = Buffer.alloc(8);
  inspBuf.writeBigInt64LE(BigInt(params.inspectionDurationSeconds), 0);

  const nameLen = Buffer.alloc(4);
  nameLen.writeUInt32LE(nameBuf.length, 0);

  const descLen = Buffer.alloc(4);
  descLen.writeUInt32LE(descBuf.length, 0);

  const uriLen = Buffer.alloc(4);
  uriLen.writeUInt32LE(uriBuf.length, 0);

  const data = Buffer.concat([
    discriminator,
    idBuf,
    nameLen,
    nameBuf,
    descLen,
    descBuf,
    uriLen,
    uriBuf,
    priceBuf,
    commitBuf,
    revealBuf,
    inspBuf,
  ]);

  return {
    programId,
    accounts: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: params.seller, isSigner: true, isWritable: true },
      { pubkey: params.reviewer, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: findAuctionConfigPda(programId).pda, isSigner: false, isWritable: false },
    ],
    data,
  };
}

/**
 * Builds `commit_bid` instruction.
 */
export function createCommitBidInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
  bidder: string;
  commitment: Buffer | Uint8Array;
  depositLamports: bigint | number;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const commitBuf = Buffer.isBuffer(params.commitment) ? params.commitment : Buffer.from(params.commitment);

  if (commitBuf.length !== 32) {
    throw new Error(`Commitment must be exactly 32 bytes (received ${commitBuf.length})`);
  }
  if (commitBuf.every((b) => b === 0)) {
    throw new Error('Commitment cannot be zero');
  }

  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);
  const { pda: bidCommitmentPda } = findBidCommitmentPda(auctionPda, params.bidder, programId);

  const discriminator = getAnchorDiscriminator('global', 'commit_bid');
  const depositBuf = Buffer.alloc(8);
  depositBuf.writeBigUInt64LE(BigInt(params.depositLamports), 0);

  const data = Buffer.concat([discriminator, commitBuf, depositBuf]);

  return {
    programId,
    accounts: [
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: bidCommitmentPda, isSigner: false, isWritable: true },
      { pubkey: params.bidder, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  };
}

/**
 * Builds `reveal_bid` instruction.
 */
export function createRevealBidInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
  bidder: string;
  maxBidLamports: bigint | number;
  salt: Buffer | Uint8Array;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const saltBuf = Buffer.isBuffer(params.salt) ? params.salt : Buffer.from(params.salt);

  if (saltBuf.length !== 32) {
    throw new Error(`Salt must be exactly 32 bytes (received ${saltBuf.length})`);
  }

  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);
  const { pda: bidCommitmentPda } = findBidCommitmentPda(auctionPda, params.bidder, programId);

  const discriminator = getAnchorDiscriminator('global', 'reveal_bid');
  const maxBidBuf = Buffer.alloc(8);
  maxBidBuf.writeBigUInt64LE(BigInt(params.maxBidLamports), 0);

  const data = Buffer.concat([discriminator, maxBidBuf, saltBuf]);

  return {
    programId,
    accounts: [
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: bidCommitmentPda, isSigner: false, isWritable: true },
      // Writable: reveal_bid refunds any over-deposit to the bidder.
      { pubkey: params.bidder, isSigner: true, isWritable: true },
    ],
    data,
  };
}

/**
 * Builds `settle_auction` instruction.
 */
export function createSettleAuctionInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);

  const discriminator = getAnchorDiscriminator('global', 'settle_auction');

  return {
    programId,
    accounts: [{ pubkey: auctionPda, isSigner: false, isWritable: true }],
    data: discriminator,
  };
}

/**
 * Builds `accept_dataset` instruction.
 */
export function createAcceptDatasetInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
  seller: string;
  winner: string;
  feeRecipient: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);
  const { pda: bidCommitmentPda } = findBidCommitmentPda(auctionPda, params.winner, programId);

  const discriminator = getAnchorDiscriminator('global', 'accept_dataset');

  return {
    programId,
    accounts: [
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: bidCommitmentPda, isSigner: false, isWritable: true },
      { pubkey: params.seller, isSigner: false, isWritable: true },
      { pubkey: params.winner, isSigner: true, isWritable: true },
      { pubkey: findAuctionFeeConfigPda(programId).pda, isSigner: false, isWritable: false },
      { pubkey: params.feeRecipient, isSigner: false, isWritable: true },
    ],
    data: discriminator,
  };
}

/**
 * Builds `review_refund(approve)`.
 * accounts: [auction (mut), bid_commitment (mut), seller (mut), reviewer (signer), winner (mut), config]
 * The trailing read-only `config` PDA lets the upgraded program authorize the CURRENT platform
 * reviewer; the pre-upgrade program ignores it as an Anchor remaining account.
 */
export function createReviewRefundInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
  seller: string;
  reviewer: string;
  winner: string;
  approve: boolean;
  feeRecipient: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);
  const { pda: bidCommitmentPda } = findBidCommitmentPda(auctionPda, params.winner, programId);
  return {
    programId,
    accounts: [
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: bidCommitmentPda, isSigner: false, isWritable: true },
      { pubkey: params.seller, isSigner: false, isWritable: true },
      { pubkey: params.reviewer, isSigner: true, isWritable: false },
      { pubkey: params.winner, isSigner: false, isWritable: true },
      { pubkey: findAuctionConfigPda(programId).pda, isSigner: false, isWritable: false },
      { pubkey: findAuctionFeeConfigPda(programId).pda, isSigner: false, isWritable: false },
      { pubkey: params.feeRecipient, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      getAnchorDiscriminator('global', 'review_refund'),
      Buffer.from([params.approve ? 1 : 0]),
    ]),
  };
}

export function createFinalizeInspectionTimeoutInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
  seller: string;
  winner: string;
  caller: string;
  feeRecipient: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);
  const { pda: bidCommitmentPda } = findBidCommitmentPda(auctionPda, params.winner, programId);
  return {
    programId,
    accounts: [
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: bidCommitmentPda, isSigner: false, isWritable: true },
      { pubkey: params.seller, isSigner: false, isWritable: true },
      { pubkey: params.winner, isSigner: false, isWritable: true },
      { pubkey: params.caller, isSigner: true, isWritable: false },
      { pubkey: findAuctionFeeConfigPda(programId).pda, isSigner: false, isWritable: false },
      { pubkey: params.feeRecipient, isSigner: false, isWritable: true },
    ],
    data: getAnchorDiscriminator('global', 'finalize_inspection_timeout'),
  };
}

export function createFinalizeRefundTimeoutInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
  winner: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);
  const { pda: bidCommitmentPda } = findBidCommitmentPda(auctionPda, params.winner, programId);
  return {
    programId,
    accounts: [
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: bidCommitmentPda, isSigner: false, isWritable: true },
      { pubkey: params.winner, isSigner: true, isWritable: true },
    ],
    data: getAnchorDiscriminator('global', 'finalize_refund_timeout'),
  };
}

export function createClaimRefundInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
  bidder: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);
  const { pda: bidCommitmentPda } = findBidCommitmentPda(auctionPda, params.bidder, programId);
  return {
    programId,
    accounts: [
      { pubkey: auctionPda, isSigner: false, isWritable: false },
      { pubkey: bidCommitmentPda, isSigner: false, isWritable: true },
      { pubkey: params.bidder, isSigner: true, isWritable: true },
    ],
    data: getAnchorDiscriminator('global', 'claim_refund'),
  };
}

/**
 * Builds `request_refund` instruction.
 */
export function createRequestRefundInstruction(params: {
  programId?: string;
  auctionId: bigint | number;
  winner: string;
  evidenceHash: Buffer | Uint8Array;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaAuctionProgramId();
  const hashBuf = Buffer.isBuffer(params.evidenceHash) ? params.evidenceHash : Buffer.from(params.evidenceHash);

  if (hashBuf.length !== 32) {
    throw new Error(`Evidence hash must be exactly 32 bytes (received ${hashBuf.length})`);
  }
  if (hashBuf.every((b) => b === 0)) {
    throw new Error('Evidence hash cannot be zero');
  }

  const { pda: auctionPda } = findAuctionPda(params.auctionId, programId);
  const discriminator = getAnchorDiscriminator('global', 'request_refund');

  const data = Buffer.concat([discriminator, hashBuf]);

  return {
    programId,
    accounts: [
      { pubkey: auctionPda, isSigner: false, isWritable: true },
      { pubkey: params.winner, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/**
 * Decodes an Anchor `AuctionStateAccount` buffer.
 */
export function decodeAuctionStateAccount(data: Buffer | Uint8Array): DecodedAuctionState {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const expectedDisc = getAnchorDiscriminator('account', 'AuctionStateAccount');

  if (!buf.subarray(0, 8).equals(expectedDisc)) {
    throw new Error('Invalid account discriminator: not an AuctionStateAccount');
  }
  if (buf.length < 8 + 32 + 32 + 8 + 4 + 4 + 4 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 32 + 8 + 4 + 4 + 32 + 4 + 1) {
    throw new Error(`Buffer too short for AuctionStateAccount: ${buf.length} bytes`);
  }

  let offset = 8;
  const seller = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const reviewer = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const auctionId = buf.readBigUInt64LE(offset);
  offset += 8;

  const nameLen = buf.readUInt32LE(offset);
  offset += 4;
  const itemName = buf.subarray(offset, offset + nameLen).toString('utf8');
  offset += nameLen;

  const descLen = buf.readUInt32LE(offset);
  offset += 4;
  const description = buf.subarray(offset, offset + descLen).toString('utf8');
  offset += descLen;

  const uriLen = buf.readUInt32LE(offset);
  offset += 4;
  const imageUri = buf.subarray(offset, offset + uriLen).toString('utf8');
  offset += uriLen;

  const startingPrice = buf.readBigUInt64LE(offset);
  offset += 8;

  const commitEndTime = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const revealEndTime = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const inspectionDuration = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const inspectionEndTime = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const refundRequestedAt = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const state = buf.readUInt8(offset) as SolanaAuctionState;
  offset += 1;

  const highestBidder = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const highestBid = buf.readBigUInt64LE(offset);
  offset += 8;

  const bidderCount = buf.readUInt32LE(offset);
  offset += 4;

  const revealedCount = buf.readUInt32LE(offset);
  offset += 4;

  const evidenceHash = '0x' + buf.subarray(offset, offset + 32).toString('hex');
  offset += 32;

  const reasonLen = buf.readUInt32LE(offset);
  offset += 4;
  const reviewReason = buf.subarray(offset, offset + reasonLen).toString('utf8');
  offset += reasonLen;

  const bump = buf.readUInt8(offset);

  return {
    seller,
    reviewer,
    auctionId,
    itemName,
    description,
    imageUri,
    startingPrice,
    commitEndTime,
    revealEndTime,
    inspectionDuration,
    inspectionEndTime,
    refundRequestedAt,
    state,
    highestBidder,
    highestBid,
    bidderCount,
    revealedCount,
    evidenceHash,
    reviewReason,
    bump,
  };
}

/**
 * Decodes an Anchor `BidCommitmentAccount` buffer.
 */
export function decodeBidCommitmentAccount(data: Buffer | Uint8Array): DecodedBidCommitment {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const expectedDisc = getAnchorDiscriminator('account', 'BidCommitmentAccount');

  if (buf.length < 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1) {
    throw new Error(`Buffer too short for BidCommitmentAccount: ${buf.length} bytes`);
  }
  if (!buf.subarray(0, 8).equals(expectedDisc)) {
    throw new Error('Invalid account discriminator: not a BidCommitmentAccount');
  }

  let offset = 8;
  const auction = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const bidder = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const commitment = '0x' + buf.subarray(offset, offset + 32).toString('hex');
  offset += 32;

  const deposit = buf.readBigUInt64LE(offset);
  offset += 8;

  const maxBid = buf.readBigUInt64LE(offset);
  offset += 8;

  const revealed = buf.readUInt8(offset) !== 0;
  offset += 1;

  const bump = buf.readUInt8(offset);

  return {
    auction,
    bidder,
    commitment,
    deposit,
    maxBid,
    revealed,
    bump,
  };
}
