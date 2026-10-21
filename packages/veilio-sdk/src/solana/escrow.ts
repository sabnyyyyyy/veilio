/**
 * VEILIO Solana Services Escrow Client & Program Interface
 *
 * Implements client-side PDA derivation, Anchor instruction serialization,
 * account deserialization, fee calculations, and transaction verification
 * for the dedicated Solana Devnet VeilServiceEscrow program.
 */

import { createHash } from 'node:crypto';
import {
  encodeBase58,
  decodeBase58,
  findProgramDerivedAddress,
  getAnchorDiscriminator,
  normalizeBytes32,
  findProgramDataPda,
  decodePubkey32,
  SYSTEM_PROGRAM_ID,
  type SolanaCompiledInstruction,
} from './registry.js';

// Canonical Seeds & Limits
export const ESCROW_SEED = Buffer.from('service_escrow');
export const VAULT_SEED = Buffer.from('service_vault');
export const MAX_DELIVERABLE_REF_LEN = 200;
export const MAX_FEE_BPS = 850; // 8.5%
/** Global platform config PDA seed: [b"escrow_config"] (EscrowConfig account). */
export const ESCROW_CONFIG_SEED = Buffer.from('escrow_config');
/** 8 (discriminator) + 32 admin + 32 reviewer + 32 fee_recipient + 2 fee_basis_points + 1 bump */
export const ESCROW_CONFIG_ACCOUNT_SIZE = 107;

// Default Program ID (can be overridden via NEXT_PUBLIC_SOLANA_SERVICE_ESCROW_PROGRAM_ID)
export const DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID =
  '5Vj4y8BT74PDe5VwLuDp9agTR5ak4vtZdwxnBfRW3R8s';

export type SolanaServiceEscrowStatus =
  | 'None'       // 0
  | 'Funded'     // 1
  | 'Delivered'  // 2
  | 'Released'   // 3
  | 'Refunded'   // 4
  | 'Disputed';  // 5

export const SOLANA_SERVICE_ESCROW_STATUS_MAP: Record<number, SolanaServiceEscrowStatus> = {
  0: 'None',
  1: 'Funded',
  2: 'Delivered',
  3: 'Released',
  4: 'Refunded',
  5: 'Disputed',
};

export interface DecodedSolanaEscrowOrder {
  buyer: string;
  seller: string;
  reviewer: string;
  feeRecipient: string;
  orderIdHex: string;
  orderIdBytes: Uint8Array;
  amountLamports: bigint;
  amountSol: string;
  feeBasisPoints: number;
  deadline: number;
  status: SolanaServiceEscrowStatus;
  createdAt: number;
  settledAt: number;
  deliverableReference: string;
  bump: number;
  vaultBump: number;
}

/**
 * Derives the EscrowOrder account PDA: [b"service_escrow", order_id]
 */
export function findEscrowOrderPda(
  orderId: string | Uint8Array,
  programId: string = DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID
): { pda: string; bump: number } {
  const orderIdBytes = normalizeBytes32(orderId);
  return findProgramDerivedAddress([ESCROW_SEED, orderIdBytes], programId);
}

/**
 * Derives the Vault account PDA holding SOL lamports: [b"service_vault", order_id]
 */
export function findVaultPda(
  orderId: string | Uint8Array,
  programId: string = DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID
): { pda: string; bump: number } {
  const orderIdBytes = normalizeBytes32(orderId);
  return findProgramDerivedAddress([VAULT_SEED, orderIdBytes], programId);
}

/**
 * Derives the global EscrowConfig PDA: [b"escrow_config"]. Holds the platform reviewer, fee
 * recipient and fee rate that the upgraded program snapshots into every new order.
 */
export function findEscrowConfigPda(
  programId: string = DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID
): { pda: string; bump: number } {
  return findProgramDerivedAddress([ESCROW_CONFIG_SEED], programId);
}

export interface DecodedSolanaEscrowConfig {
  admin: string;
  reviewer: string;
  feeRecipient: string;
  feeBasisPoints: number;
  bump: number;
}

/** Decodes the EscrowConfig account (admin, reviewer, fee_recipient, fee_basis_points u16, bump). */
export function decodeEscrowConfigAccount(buffer: Uint8Array | Buffer): DecodedSolanaEscrowConfig {
  const buf = Buffer.from(buffer);
  if (buf.length < ESCROW_CONFIG_ACCOUNT_SIZE) {
    throw new Error(`Truncated EscrowConfig buffer length: ${buf.length}`);
  }
  if (!buf.subarray(0, 8).equals(getAnchorDiscriminator('account', 'EscrowConfig'))) {
    throw new Error('Invalid account discriminator for EscrowConfig');
  }
  let offset = 8;
  const admin = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;
  const reviewer = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;
  const feeRecipient = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;
  const feeBasisPoints = buf.readUInt16LE(offset);
  offset += 2;
  const bump = buf.readUInt8(offset);
  return { admin, reviewer, feeRecipient, feeBasisPoints, bump };
}

function validateEscrowConfigParams(params: {
  reviewer: string;
  feeRecipient: string;
  feeBasisPoints: number;
}): { reviewerBytes: Buffer; feeRecipientBytes: Buffer; feeBuf: Buffer } {
  const reviewerBytes = decodePubkey32(params.reviewer, 'reviewer');
  const feeRecipientBytes = decodePubkey32(params.feeRecipient, 'fee recipient');
  if (reviewerBytes.every((b) => b === 0)) throw new Error('Reviewer cannot be the default (all-zero) public key');
  if (feeRecipientBytes.every((b) => b === 0)) throw new Error('Fee recipient cannot be the default (all-zero) public key');
  if (!Number.isInteger(params.feeBasisPoints) || params.feeBasisPoints < 0 || params.feeBasisPoints > MAX_FEE_BPS) {
    throw new Error(`Fee basis points must be an integer between 0 and ${MAX_FEE_BPS}`);
  }
  const feeBuf = Buffer.alloc(2);
  feeBuf.writeUInt16LE(params.feeBasisPoints);
  return { reviewerBytes, feeRecipientBytes, feeBuf };
}

/**
 * Encodes initialize_config(reviewer, fee_recipient, fee_basis_points). Only the program's
 * upgrade authority (`admin`) can call it, once.
 * accounts: [config (mut, pda), admin (signer, mut), program, program_data, system_program]
 */
export function createInitializeEscrowConfigInstruction(params: {
  programId?: string;
  admin: string;
  reviewer: string;
  feeRecipient: string;
  feeBasisPoints: number;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const { reviewerBytes, feeRecipientBytes, feeBuf } = validateEscrowConfigParams(params);
  const { pda: configPda } = findEscrowConfigPda(programId);
  const { pda: programDataPda } = findProgramDataPda(programId);

  const data = Buffer.concat([
    getAnchorDiscriminator('global', 'initialize_config'),
    reviewerBytes,
    feeRecipientBytes,
    feeBuf,
  ]);
  const keys = [
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: params.admin, isSigner: true, isWritable: true },
    { pubkey: programId, isSigner: false, isWritable: false },
    { pubkey: programDataPda, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return { programId, accounts: keys, keys, data };
}

/**
 * Encodes update_config(reviewer, fee_recipient, fee_basis_points, new_admin). Signed by the
 * current config admin; `newAdmin` defaults to `admin` (no hand-over).
 * accounts: [config (mut, pda), admin (signer)]
 */
export function createUpdateEscrowConfigInstruction(params: {
  programId?: string;
  admin: string;
  reviewer: string;
  feeRecipient: string;
  feeBasisPoints: number;
  newAdmin?: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const { reviewerBytes, feeRecipientBytes, feeBuf } = validateEscrowConfigParams(params);
  const newAdminBytes = decodePubkey32(params.newAdmin || params.admin, 'new admin');
  if (newAdminBytes.every((b) => b === 0)) throw new Error('New admin cannot be the default (all-zero) public key');
  const { pda: configPda } = findEscrowConfigPda(programId);

  const data = Buffer.concat([
    getAnchorDiscriminator('global', 'update_config'),
    reviewerBytes,
    feeRecipientBytes,
    feeBuf,
    newAdminBytes,
  ]);
  const keys = [
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: params.admin, isSigner: true, isWritable: false },
  ];
  return { programId, accounts: keys, keys, data };
}

/**
 * Encodes the deposit instruction:
 * accounts: [escrow_order (mut, pda), vault (mut, pda), buyer (signer, mut), system_program, config]
 *
 * The trailing read-only `config` PDA is required by the upgraded program (which takes the
 * reviewer / fee recipient / fee rate from it and ignores the `reviewer` / `feeRecipient`
 * args). The pre-upgrade program ignores it as an Anchor remaining account.
 */
export function createDepositServiceOrderInstruction(params: {
  programId?: string;
  buyer: string;
  seller: string;
  reviewer: string;
  feeRecipient: string;
  orderId: string | Uint8Array;
  amountLamports: bigint | number;
  deadline: number;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const orderIdBytes = normalizeBytes32(params.orderId);
  const { pda: escrowOrderPda } = findEscrowOrderPda(orderIdBytes, programId);
  const { pda: vaultPda } = findVaultPda(orderIdBytes, programId);

  const amount = BigInt(params.amountLamports);
  if (amount <= 0n) throw new Error('Deposit amount must be greater than zero');
  if (params.seller === params.buyer) throw new Error('Buyer cannot be seller');

  const discriminator = getAnchorDiscriminator('global', 'deposit');

  const sellerBytes = Buffer.from(decodeBase58(params.seller));
  const reviewerBytes = Buffer.from(decodeBase58(params.reviewer));
  const feeRecipientBytes = Buffer.from(decodeBase58(params.feeRecipient));

  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);

  const deadlineBuf = Buffer.alloc(8);
  deadlineBuf.writeBigInt64LE(BigInt(params.deadline));

  const data = Buffer.concat([
    discriminator,
    orderIdBytes,
    sellerBytes,
    reviewerBytes,
    feeRecipientBytes,
    amountBuf,
    deadlineBuf,
  ]);

  const keys = [
    { pubkey: escrowOrderPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: params.buyer, isSigner: true, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: findEscrowConfigPda(programId).pda, isSigner: false, isWritable: false },
  ];

  return {
    programId,
    accounts: keys,
    keys,
    data: Buffer.from(data),
  };
}

/**
 * Encodes the submit_delivery instruction:
 * accounts: [escrow_order (mut), seller (signer)]
 */
export function createSubmitDeliveryInstruction(params: {
  programId?: string;
  seller: string;
  orderId: string | Uint8Array;
  deliverableReference: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const orderIdBytes = normalizeBytes32(params.orderId);
  const { pda: escrowOrderPda } = findEscrowOrderPda(orderIdBytes, programId);

  const refStr = params.deliverableReference.trim();
  if (!refStr) throw new Error('Deliverable reference cannot be empty');
  const refBuf = Buffer.from(refStr, 'utf8');
  if (refBuf.length > MAX_DELIVERABLE_REF_LEN) {
    throw new Error(`Deliverable reference exceeds ${MAX_DELIVERABLE_REF_LEN} bytes`);
  }

  const discriminator = getAnchorDiscriminator('global', 'submit_delivery');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(refBuf.length);

  const data = Buffer.concat([discriminator, lenBuf, refBuf]);
  const keys = [
    { pubkey: escrowOrderPda, isSigner: false, isWritable: true },
    { pubkey: params.seller, isSigner: true, isWritable: false },
  ];

  return {
    programId,
    accounts: keys,
    keys,
    data: Buffer.from(data),
  };
}

/**
 * Encodes the release_funds instruction:
 * accounts: [escrow_order (mut), vault (mut), buyer (signer), seller (mut), fee_recipient (mut)]
 */
export function createReleaseFundsInstruction(params: {
  programId?: string;
  buyer: string;
  seller: string;
  feeRecipient: string;
  orderId: string | Uint8Array;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const orderIdBytes = normalizeBytes32(params.orderId);
  const { pda: escrowOrderPda } = findEscrowOrderPda(orderIdBytes, programId);
  const { pda: vaultPda } = findVaultPda(orderIdBytes, programId);

  const discriminator = getAnchorDiscriminator('global', 'release_funds');
  const keys = [
    { pubkey: escrowOrderPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: params.buyer, isSigner: true, isWritable: false },
    { pubkey: params.seller, isSigner: false, isWritable: true },
    { pubkey: params.feeRecipient, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return {
    programId,
    accounts: keys,
    keys,
    data: Buffer.from(discriminator),
  };
}

/**
 * Encodes the partial_refund instruction (seller returns part of the escrow, order stays active):
 * accounts: [escrow_order (mut), vault (mut), seller (signer), buyer (mut), system_program]
 * args: refund_amount u64, reason string
 */
export function createPartialRefundInstruction(params: {
  programId?: string;
  seller: string;
  buyer: string;
  orderId: string | Uint8Array;
  refundLamports: bigint | number;
  reason: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const orderIdBytes = normalizeBytes32(params.orderId);
  const { pda: escrowOrderPda } = findEscrowOrderPda(orderIdBytes, programId);
  const { pda: vaultPda } = findVaultPda(orderIdBytes, programId);

  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(params.refundLamports));
  const reasonBuf = Buffer.from(params.reason.trim() || 'Price reduced', 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(reasonBuf.length);

  const data = Buffer.concat([getAnchorDiscriminator('global', 'partial_refund'), amountBuf, lenBuf, reasonBuf]);
  const keys = [
    { pubkey: escrowOrderPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: params.seller, isSigner: true, isWritable: false },
    { pubkey: params.buyer, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return {
    programId,
    accounts: keys,
    keys,
    data: Buffer.from(data),
  };
}

/**
 * Encodes the cancel_or_refund instruction:
 * accounts: [escrow_order (mut), vault (mut), caller (signer), buyer (mut), system_program]
 */
export function createCancelOrRefundInstruction(params: {
  programId?: string;
  caller: string;
  buyer: string;
  orderId: string | Uint8Array;
  reason: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const orderIdBytes = normalizeBytes32(params.orderId);
  const { pda: escrowOrderPda } = findEscrowOrderPda(orderIdBytes, programId);
  const { pda: vaultPda } = findVaultPda(orderIdBytes, programId);

  const discriminator = getAnchorDiscriminator('global', 'cancel_or_refund');
  const reasonBuf = Buffer.from(params.reason.trim() || 'Order cancelled', 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(reasonBuf.length);

  const data = Buffer.concat([discriminator, lenBuf, reasonBuf]);
  const keys = [
    { pubkey: escrowOrderPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: params.caller, isSigner: true, isWritable: false },
    { pubkey: params.buyer, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return {
    programId,
    accounts: keys,
    keys,
    data: Buffer.from(data),
  };
}

/**
 * Encodes the dispute instruction:
 * accounts: [escrow_order (mut), caller (signer)]
 */
export function createDisputeOrderInstruction(params: {
  programId?: string;
  caller: string;
  orderId: string | Uint8Array;
  reason: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const orderIdBytes = normalizeBytes32(params.orderId);
  const { pda: escrowOrderPda } = findEscrowOrderPda(orderIdBytes, programId);

  const discriminator = getAnchorDiscriminator('global', 'dispute');
  const reasonBuf = Buffer.from(params.reason.trim() || 'Dispute opened', 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(reasonBuf.length);

  const data = Buffer.concat([discriminator, lenBuf, reasonBuf]);
  const keys = [
    { pubkey: escrowOrderPda, isSigner: false, isWritable: true },
    { pubkey: params.caller, isSigner: true, isWritable: false },
  ];

  return {
    programId,
    accounts: keys,
    keys,
    data: Buffer.from(data),
  };
}

/**
 * Encodes the resolve_dispute instruction:
 * accounts: [escrow_order (mut), vault (mut), reviewer (signer), buyer (mut), seller (mut),
 *            fee_recipient (mut), system_program, config]
 * The trailing read-only `config` PDA lets the upgraded program authorize the CURRENT platform
 * reviewer; the pre-upgrade program ignores it as an Anchor remaining account.
 */
export function createResolveDisputeInstruction(params: {
  programId?: string;
  reviewer: string;
  buyer: string;
  seller: string;
  feeRecipient: string;
  orderId: string | Uint8Array;
  splitToBuyerPercent: number;
}): SolanaCompiledInstruction {
  const programId = params.programId || DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const orderIdBytes = normalizeBytes32(params.orderId);
  const { pda: escrowOrderPda } = findEscrowOrderPda(orderIdBytes, programId);
  const { pda: vaultPda } = findVaultPda(orderIdBytes, programId);

  if (params.splitToBuyerPercent < 0 || params.splitToBuyerPercent > 100) {
    throw new Error('Split percentage must be between 0 and 100');
  }

  const discriminator = getAnchorDiscriminator('global', 'resolve_dispute');
  const splitBuf = Buffer.from([params.splitToBuyerPercent]);

  const data = Buffer.concat([discriminator, splitBuf]);
  const keys = [
    { pubkey: escrowOrderPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: params.reviewer, isSigner: true, isWritable: false },
    { pubkey: params.buyer, isSigner: false, isWritable: true },
    { pubkey: params.seller, isSigner: false, isWritable: true },
    { pubkey: params.feeRecipient, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: findEscrowConfigPda(programId).pda, isSigner: false, isWritable: false },
  ];

  return {
    programId,
    accounts: keys,
    keys,
    data: Buffer.from(data),
  };
}

/**
 * Decodes serialized EscrowOrder account buffer.
 */
export function decodeEscrowOrderAccount(buffer: Uint8Array | Buffer): DecodedSolanaEscrowOrder {
  const buf = Buffer.from(buffer);
  const expectedDiscriminator = getAnchorDiscriminator('account', 'EscrowOrder');

  if (buf.length < 8 + 32 * 4 + 32 + 8 + 2 + 8 + 1 + 8 + 8 + 4 + 1 + 1) {
    throw new Error(`Truncated account buffer length: ${buf.length}`);
  }

  const accountDiscriminator = buf.subarray(0, 8);
  if (!accountDiscriminator.equals(expectedDiscriminator)) {
    throw new Error('Invalid account discriminator for EscrowOrder');
  }

  let offset = 8;

  const buyer = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const seller = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const reviewer = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const feeRecipient = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const orderIdBytes = new Uint8Array(buf.subarray(offset, offset + 32));
  const orderIdHex = '0x' + Buffer.from(orderIdBytes).toString('hex');
  offset += 32;

  const amountLamports = buf.readBigUInt64LE(offset);
  offset += 8;

  const feeBasisPoints = buf.readUInt16LE(offset);
  offset += 2;

  const deadline = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const statusNum = buf.readUInt8(offset);
  const status = SOLANA_SERVICE_ESCROW_STATUS_MAP[statusNum] || 'None';
  offset += 1;

  const createdAt = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const settledAt = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const strLen = buf.readUInt32LE(offset);
  offset += 4;
  const deliverableReference = buf.subarray(offset, offset + strLen).toString('utf8');
  offset += strLen;

  const bump = buf.readUInt8(offset);
  offset += 1;

  const vaultBump = buf.readUInt8(offset);

  const solDecimals = 9;
  const amountSol = (Number(amountLamports) / 10 ** solDecimals).toFixed(4);

  return {
    buyer,
    seller,
    reviewer,
    feeRecipient,
    orderIdHex,
    orderIdBytes,
    amountLamports,
    amountSol,
    feeBasisPoints,
    deadline,
    status,
    createdAt,
    settledAt,
    deliverableReference,
    bump,
    vaultBump,
  };
}

/**
 * Calculates exact platform fee and payouts for Solana lamports.
 * Strict parity with EVM: 850 bps (8.5%) platform fee deducted from seller gross award.
 * Buyer refunds are 100% fee-free.
 */
export function calculateSolanaServicePayouts(
  totalLamports: bigint | number,
  splitToBuyerPercent: number = 0,
  feeBps: number = 850
): {
  buyerRefundLamports: bigint;
  sellerGrossLamports: bigint;
  platformFeeLamports: bigint;
  sellerNetPayoutLamports: bigint;
} {
  const total = BigInt(totalLamports);
  const buyerPercent = BigInt(Math.min(Math.max(splitToBuyerPercent, 0), 100));

  const buyerRefundLamports = (total * buyerPercent) / 100n;
  const sellerGrossLamports = total - buyerRefundLamports;

  // Platform fee applies only to seller gross
  const platformFeeLamports = (sellerGrossLamports * BigInt(feeBps)) / 10000n;
  const sellerNetPayoutLamports = sellerGrossLamports - platformFeeLamports;

  return {
    buyerRefundLamports,
    sellerGrossLamports,
    platformFeeLamports,
    sellerNetPayoutLamports,
  };
}

/**
 * Lossless conversion of lamports to a high-precision SOL string without floating-point errors.
 */
export function formatLamportsToSol(lamports: bigint | number): string {
  const value = BigInt(lamports);
  const negative = value < 0n;
  const absVal = negative ? -value : value;
  const intPart = absVal / 1_000_000_000n;
  const rem = absVal % 1_000_000_000n;
  if (rem === 0n) {
    return (negative ? '-' : '') + intPart.toString();
  }
  const frac = rem.toString().padStart(9, '0').replace(/0+$/, '');
  return (negative ? '-' : '') + `${intPart}.${frac}`;
}

/**
 * Lossless conversion of SOL string to lamports bigint without floating-point inaccuracies.
 */
export function parseSolToLamports(sol: string): bigint {
  const trimmed = sol.trim();
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid SOL amount string: "${sol}"`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intStr, fracStr = ''] = unsigned.split('.');
  if (fracStr.length > 9) {
    throw new Error(`SOL amount has more than 9 decimal places: "${sol}"`);
  }
  const paddedFrac = fracStr.padEnd(9, '0');
  const lamports = BigInt(intStr) * 1_000_000_000n + BigInt(paddedFrac);
  return negative ? -lamports : lamports;
}

