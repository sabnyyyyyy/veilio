/**
 * VEILIO Solana Service Registry Client & Program Interface
 * 
 * Provides client-side PDA derivation, Anchor instruction encoding,
 * account deserialization, and validation for the on-chain Solana Devnet
 * Veilio Service Registry program.
 */

import crypto from 'crypto';
import { ed25519 } from '@noble/curves/ed25519';

// Canonical Program Seeds & Limits
export const SERVICE_SEED = Buffer.from('service');
export const MAX_METADATA_URI_LEN = 200;
export const SERVICE_RECORD_ACCOUNT_SIZE = 326;

// Default Devnet Program ID (can be overridden via NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID)
export const DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID =
  '6CMoJyQmBobLTk4M9ZoygMShRB6A6i77e6viq2Lew2KY';

// Solana System Program ID
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

// Bitcoin / Solana Base58 Alphabet
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) {
  BASE58_MAP[ALPHABET[i]] = i;
}

/**
 * Encodes a buffer/Uint8Array to Base58 string.
 */
export function encodeBase58(source: Uint8Array | Buffer): string {
  if (source.length === 0) return '';
  let leadingZeroes = 0;
  while (leadingZeroes < source.length && source[leadingZeroes] === 0) leadingZeroes++;

  let value = 0n;
  for (const byte of source) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    const digit = Number(value % 58n);
    encoded = ALPHABET[digit] + encoded;
    value /= 58n;
  }
  return '1'.repeat(leadingZeroes) + encoded;
}

/**
 * Decodes a Base58 string to Uint8Array.
 */
export function decodeBase58(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  let leadingZeroes = 0;
  while (leadingZeroes < str.length && str[leadingZeroes] === '1') leadingZeroes++;

  let value = 0n;
  for (const character of str) {
    const digit = BASE58_MAP[character];
    if (digit === undefined) throw new Error(`Invalid Base58 character: ${character}`);
    value = value * 58n + BigInt(digit);
  }

  const decoded: number[] = [];
  while (value > 0n) {
    decoded.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  return Uint8Array.from([...new Array(leadingZeroes).fill(0), ...decoded]);
}

/** Solana-compatible PDA derivation: retry bumps until SHA-256 output is off the Ed25519 curve. */
export function findProgramDerivedAddress(
  seeds: readonly (Uint8Array | Buffer)[],
  programId: string,
): { pda: string; bump: number } {
  const programIdBytes = Buffer.from(decodeBase58(programId));
  if (programIdBytes.length !== 32) throw new Error('Program ID must decode to 32 bytes');
  if (seeds.some((seed) => seed.length > 32)) throw new Error('Each PDA seed must be at most 32 bytes');

  const marker = Buffer.from('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const hash = crypto
      .createHash('sha256')
      .update(Buffer.concat([...seeds.map((seed) => Buffer.from(seed)), Buffer.from([bump]), programIdBytes, marker]))
      .digest();
    try {
      ed25519.ExtendedPoint.fromHex(hash);
    } catch {
      return { pda: encodeBase58(hash), bump };
    }
  }

  throw new Error('Unable to find a valid off-curve program-derived address');
}

/**
 * Computes Anchor 8-byte instruction or account discriminator using SHA-256.
 */
export function getAnchorDiscriminator(namespace: 'global' | 'account', name: string): Buffer {
  const preimage = `${namespace}:${name}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.subarray(0, 8);
}

/**
 * Validates 32-byte hash or ID (hex string or Uint8Array).
 */
export function normalizeBytes32(input: string | Uint8Array): Buffer {
  if (typeof input === 'string') {
    const cleanHex = input.startsWith('0x') ? input.slice(2) : input;
    if (cleanHex.length !== 64) {
      throw new Error(`Expected 32 bytes (64 hex characters), received ${cleanHex.length}`);
    }
    const buf = Buffer.from(cleanHex, 'hex');
    if (buf.length !== 32) {
      throw new Error(`Expected exactly 32 bytes, received ${buf.length}`);
    }
    return buf;
  }
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    if (input.length !== 32) {
      throw new Error(`Expected exactly 32 bytes, received ${input.length}`);
    }
    return Buffer.from(input);
  }
  throw new Error('Input must be a 32-byte hex string or Uint8Array');
}

/**
 * Derives the deterministic PDA for a seller-owned service record on Solana.
 * Formula: sha256([SERVICE_SEED, seller, service_id, bump, program_id, "ProgramDerivedAddress"])
 */
export function findServiceRecordPda(
  serviceId: string | Uint8Array,
  seller: string,
  programId: string = getSolanaServiceRegistryProgramId()
): { pda: string; bump: number } {
  const sellerBytes = Buffer.from(decodeBase58(seller));
  if (sellerBytes.length !== 32) throw new Error('Seller must decode to a 32-byte Solana public key');
  return findProgramDerivedAddress([SERVICE_SEED, sellerBytes, normalizeBytes32(serviceId)], programId);
}

/**
 * Retrieves the configured Solana Service Registry program ID.
 */
export function getSolanaServiceRegistryProgramId(): string {
  const programId = process.env.NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID;
  if (!programId) {
    throw new Error('Solana service registry is not enabled: set NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID after deploying and verifying the program.');
  }
  return programId;
}

/** BPF upgradeable loader; owns every upgradeable program's ProgramData account. */
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = 'BPFLoaderUpgradeab1e11111111111111111111111';

/**
 * Derives an upgradeable program's ProgramData account: PDA([program_id]) under the BPF
 * upgradeable loader. `initialize_config` checks its `upgrade_authority_address`.
 */
export function findProgramDataPda(programId: string): { pda: string; bump: number } {
  const programIdBytes = Buffer.from(decodeBase58(programId));
  if (programIdBytes.length !== 32) throw new Error('Program ID must decode to 32 bytes');
  return findProgramDerivedAddress([programIdBytes], BPF_LOADER_UPGRADEABLE_PROGRAM_ID);
}

/** Decodes a base58 public key and rejects anything that is not exactly 32 bytes. */
export function decodePubkey32(value: string, label = 'public key'): Buffer {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(value);
  } catch {
    throw new Error(`Invalid ${label}: not base58`);
  }
  if (bytes.length !== 32) throw new Error(`Invalid ${label}: must decode to 32 bytes`);
  return Buffer.from(bytes);
}

export interface SolanaAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface SolanaCompiledInstruction {
  programId: string;
  accounts: SolanaAccountMeta[];
  keys?: SolanaAccountMeta[];
  data: Buffer;
}

export interface ServiceRecordState {
  seller: string;
  serviceId: string;
  metadataHash: string;
  metadataUri: string;
  active: boolean;
  registeredAt: number;
  updatedAt: number;
  bump: number;
}

/**
 * Builds the Solana instruction for `register_service`.
 */
export function createRegisterServiceInstruction(params: {
  programId?: string;
  seller: string;
  serviceId: string | Uint8Array;
  metadataHash: string | Uint8Array;
  metadataUri: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaServiceRegistryProgramId();
  const serviceIdBuf = normalizeBytes32(params.serviceId);
  const metadataHashBuf = normalizeBytes32(params.metadataHash);

  // Input validation
  if (serviceIdBuf.every((b) => b === 0)) {
    throw new Error('Invalid service ID: cannot be zero');
  }
  if (metadataHashBuf.every((b) => b === 0)) {
    throw new Error('Invalid metadata hash: cannot be zero');
  }
  if (!params.metadataUri || params.metadataUri.trim().length === 0) {
    throw new Error('Metadata URI required');
  }
  const uriBytes = Buffer.from(params.metadataUri, 'utf8');
  if (uriBytes.length > MAX_METADATA_URI_LEN) {
    throw new Error(`Metadata URI exceeds maximum length (${MAX_METADATA_URI_LEN} bytes)`);
  }

  const { pda } = findServiceRecordPda(serviceIdBuf, params.seller, programId);

  // Anchor instruction layout:
  // [8 bytes discriminator] + [32 bytes service_id] + [32 bytes metadata_hash] + [4 bytes URI len (LE)] + [URI bytes]
  const discriminator = getAnchorDiscriminator('global', 'register_service');
  const uriLenBuf = Buffer.alloc(4);
  uriLenBuf.writeUInt32LE(uriBytes.length, 0);

  const data = Buffer.concat([
    discriminator,
    serviceIdBuf,
    metadataHashBuf,
    uriLenBuf,
    uriBytes,
  ]);

  return {
    programId,
    accounts: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: params.seller, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  };
}

/**
 * Builds the Solana instruction for `update_service_metadata`.
 */
export function createUpdateServiceMetadataInstruction(params: {
  programId?: string;
  seller: string;
  serviceId: string | Uint8Array;
  newMetadataHash: string | Uint8Array;
  newMetadataUri: string;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaServiceRegistryProgramId();
  const serviceIdBuf = normalizeBytes32(params.serviceId);
  const metadataHashBuf = normalizeBytes32(params.newMetadataHash);

  if (metadataHashBuf.every((b) => b === 0)) {
    throw new Error('Invalid metadata hash: cannot be zero');
  }
  if (!params.newMetadataUri || params.newMetadataUri.trim().length === 0) {
    throw new Error('Metadata URI required');
  }
  const uriBytes = Buffer.from(params.newMetadataUri, 'utf8');
  if (uriBytes.length > MAX_METADATA_URI_LEN) {
    throw new Error(`Metadata URI exceeds maximum length (${MAX_METADATA_URI_LEN} bytes)`);
  }

  const { pda } = findServiceRecordPda(serviceIdBuf, params.seller, programId);

  const discriminator = getAnchorDiscriminator('global', 'update_service_metadata');
  const uriLenBuf = Buffer.alloc(4);
  uriLenBuf.writeUInt32LE(uriBytes.length, 0);

  const data = Buffer.concat([
    discriminator,
    metadataHashBuf,
    uriLenBuf,
    uriBytes,
  ]);

  return {
    programId,
    accounts: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: params.seller, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/**
 * Builds the Solana instruction for `set_service_status`.
 */
export function createSetServiceStatusInstruction(params: {
  programId?: string;
  seller: string;
  serviceId: string | Uint8Array;
  active: boolean;
}): SolanaCompiledInstruction {
  const programId = params.programId || getSolanaServiceRegistryProgramId();
  const serviceIdBuf = normalizeBytes32(params.serviceId);
  const { pda } = findServiceRecordPda(serviceIdBuf, params.seller, programId);

  const discriminator = getAnchorDiscriminator('global', 'set_service_status');
  const activeBuf = Buffer.from([params.active ? 1 : 0]);

  const data = Buffer.concat([discriminator, activeBuf]);

  return {
    programId,
    accounts: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: params.seller, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/**
 * Decodes an Anchor `ServiceRecord` account buffer from Solana Devnet RPC.
 */
export function decodeServiceRecordAccount(data: Buffer | Uint8Array): ServiceRecordState {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 8 + 32 + 32 + 32 + 4 + 1 + 8 + 8 + 1) {
    throw new Error(`Account data buffer too short: ${buf.length} bytes`);
  }

  const expectedDiscriminator = getAnchorDiscriminator('account', 'ServiceRecord');
  if (!buf.subarray(0, 8).equals(expectedDiscriminator)) {
    throw new Error('Invalid account discriminator: not a ServiceRecord account');
  }

  let offset = 8;
  const seller = encodeBase58(buf.subarray(offset, offset + 32));
  offset += 32;

  const serviceId = '0x' + buf.subarray(offset, offset + 32).toString('hex');
  offset += 32;

  const metadataHash = '0x' + buf.subarray(offset, offset + 32).toString('hex');
  offset += 32;

  const uriLen = buf.readUInt32LE(offset);
  offset += 4;

  if (offset + uriLen > buf.length) {
    throw new Error(`Corrupted account data: URI length ${uriLen} exceeds buffer remaining`);
  }

  const metadataUri = buf.subarray(offset, offset + uriLen).toString('utf8');
  offset += uriLen;

  const active = buf.readUInt8(offset) !== 0;
  offset += 1;

  // read i64 LE
  const registeredAt = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const updatedAt = Number(buf.readBigInt64LE(offset));
  offset += 8;

  const bump = buf.readUInt8(offset);

  return {
    seller,
    serviceId,
    metadataHash,
    metadataUri,
    active,
    registeredAt,
    updatedAt,
    bump,
  };
}
