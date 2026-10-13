import crypto from 'crypto';
import { isAddress, verifyMessage } from 'viem';
import { decodeBase58, encodeBase58 } from '../cross-chain/solanaServiceRegistry';
import { getAllServices, type ServiceListing } from './servicesDb';
import {
  getIdentityPersistenceStore,
  identityStorageConfigurationError,
  _setIdentityStoreForTesting,
} from './identityPersistence';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export { identityStorageConfigurationError, _setIdentityStoreForTesting };

export interface LinkedWalletRecord {
  address: string; // Lowercase hex for EVM, Base58 for Solana
  chainFamily: 'evm' | 'solana';
  networkId: string; // e.g. 'bnb:97', 'solana:devnet'
  linkedAt: number;
  verifiedAt: number;
  isPrimary: boolean;
  status: 'active' | 'unlinked';
  proofType: 'eip191' | 'ed25519';
}

export interface VeilioIdentityProfile {
  id: string; // e.g. "usr_..."
  primaryWallet: string;
  createdAt: number;
  updatedAt: number;
  linkedWallets: LinkedWalletRecord[];
}

export interface WalletLinkChallenge {
  challengeId: string;
  intendedIdentityId: string;
  chainFamily: 'evm' | 'solana';
  networkId: string;
  walletAddress: string;
  nonce: string;
  domain: string;
  uri: string;
  issuedAt: number;
  expiresAt: number;
  purpose: 'link_wallet';
  message: string;
}

export interface UnifiedActivityItem {
  id: string; // Unique deterministic composite ID
  identityId: string;
  walletAddress: string;
  chainFamily: 'evm' | 'solana';
  networkId: string;
  activityType:
    | 'auction_created'
    | 'bid_committed'
    | 'bid_revealed'
    | 'auction_settled'
    | 'dataset_accepted'
    | 'refund_requested'
    | 'service_registered'
    | 'service_updated'
    | 'order_funded'
    | 'delivery_submitted'
    | 'order_released'
    | 'order_refunded'
    | 'order_disputed';
  title: string;
  description: string;
  txHashOrSignature?: string;
  contractOrProgram?: string;
  blockOrSlot?: number | bigint;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'finalized' | 'failed';
  metadata?: Record<string, unknown>;
}

export interface UnlinkAuthPayload {
  signerAddress: string;
  signature: string;
  timestamp: number;
  nonce: string;
  chainFamily: 'evm' | 'solana';
}

export interface ProfileInitAuthPayload {
  signerAddress: string;
  signature: string;
  timestamp: number;
  nonce: string;
  chainFamily: 'evm' | 'solana';
}

export function normalizeWalletAddress(address: string, chainFamily: 'evm' | 'solana'): string {
  if (chainFamily === 'evm') {
    return address.trim().toLowerCase();
  }
  return address.trim();
}

export function verifySolanaSignature(
  publicKeyBase58: string,
  message: string | Uint8Array,
  signature: string | Uint8Array
): boolean {
  try {
    const rawPub = Buffer.from(decodeBase58(publicKeyBase58));
    if (rawPub.length !== 32) return false;

    const rawSig =
      typeof signature === 'string'
        ? Buffer.from(decodeBase58(signature))
        : Buffer.from(signature);
    if (rawSig.length !== 64) return false;

    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawPub]);
    const keyObject = crypto.createPublicKey({
      key: spkiDer,
      format: 'der',
      type: 'spki',
    });

    const msgBuf =
      typeof message === 'string' ? Buffer.from(message, 'utf8') : Buffer.from(message);
    return crypto.verify(null, msgBuf, keyObject, rawSig);
  } catch {
    return false;
  }
}

export async function _resetIdentitiesDbForTesting(): Promise<void> {
  const store = getIdentityPersistenceStore();
  await store.resetForTesting();
}

/**
 * Creates a server-generated, short-lived challenge for linking a wallet to an identity.
 */
export async function createWalletLinkChallenge(params: {
  identityId: string;
  chainFamily: 'evm' | 'solana';
  networkId?: string;
  walletAddress: string;
  domain?: string;
  uri?: string;
}): Promise<WalletLinkChallenge> {
  const store = getIdentityPersistenceStore();
  const normalizedWallet = normalizeWalletAddress(params.walletAddress, params.chainFamily);

  // Address format validation upfront
  if (params.chainFamily === 'evm') {
    if (!isAddress(normalizedWallet)) {
      throw new Error('Invalid EVM wallet address format');
    }
  } else {
    let pubBytes: Uint8Array;
    try {
      pubBytes = decodeBase58(normalizedWallet);
    } catch {
      throw new Error('Invalid Solana Base58 public key format');
    }
    if (pubBytes.length !== 32) {
      throw new Error('Solana public key must be exactly 32 bytes');
    }
  }

  // 1. Target identity profile existence verification upfront
  const targetProfile = await store.getProfile(params.identityId);
  if (!targetProfile) {
    throw new Error(`Veilio identity ${params.identityId} not found`);
  }

  // 2. Prevent issuing challenge if wallet is already bound to another active identity
  const existingOwner = await store.getProfileByWallet(normalizedWallet, params.chainFamily);
  if (existingOwner && existingOwner.id !== params.identityId) {
    const isStillActive = existingOwner.linkedWallets.some(
      (w) =>
        (params.chainFamily === 'evm'
          ? w.address.toLowerCase() === normalizedWallet.toLowerCase()
          : w.address === normalizedWallet) &&
        w.chainFamily === params.chainFamily &&
        w.status === 'active'
    );
    if (isStillActive) {
      throw new Error(`Wallet ${normalizedWallet} is already linked to another Veilio identity (${existingOwner.id})`);
    }
  }

  const challengeId = `chal_${crypto.randomBytes(16).toString('hex')}`;
  const nonce = crypto.randomBytes(12).toString('hex');
  const domain = params.domain || 'veilio.network';
  const uri = params.uri || `https://${domain}`;
  const networkId = params.networkId || (params.chainFamily === 'evm' ? 'bnb:97' : 'solana:devnet');

  const issuedAt = Date.now();
  const expiresAt = issuedAt + 5 * 60 * 1000; // 5 minutes TTL

  let message: string;
  if (params.chainFamily === 'evm') {
    const issuedIso = new Date(issuedAt).toISOString();
    const expiresIso = new Date(expiresAt).toISOString();
    const evmChainId = networkId === 'base:84532' ? 84532 : networkId === 'bnb:56' ? 56 : 97;
    message = [
      `${domain} wants you to sign in with your Ethereum account:`,
      normalizedWallet,
      '',
      `Link wallet to Veilio identity ${params.identityId}`,
      '',
      `URI: ${uri}`,
      'Version: 1',
      `Chain ID: ${evmChainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedIso}`,
      `Expiration Time: ${expiresIso}`,
    ].join('\n');
  } else {
    const issuedIso = new Date(issuedAt).toISOString();
    const expiresIso = new Date(expiresAt).toISOString();
    message = [
      '[VEILIO_SOLANA_LINK_CHALLENGE]',
      `Domain: ${domain}`,
      `URI: ${uri}`,
      `Target Identity: ${params.identityId}`,
      `Network: ${networkId}`,
      `Wallet: ${normalizedWallet}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedIso}`,
      `Expiration Time: ${expiresIso}`,
    ].join('\n');
  }

  const challenge: WalletLinkChallenge = {
    challengeId,
    intendedIdentityId: params.identityId,
    chainFamily: params.chainFamily,
    networkId,
    walletAddress: normalizedWallet,
    nonce,
    domain,
    uri,
    issuedAt,
    expiresAt,
    purpose: 'link_wallet',
    message,
  };

  await store.saveChallenge(challenge);
  return challenge;
}

/**
 * Atomically consumes and validates a wallet-link challenge.
 * Single-use: the challenge is deleted immediately upon retrieval to prevent replay attacks.
 */
export async function consumeWalletLinkChallenge(
  challengeId: string,
  submittedWallet: string,
  signature: string
): Promise<{ valid: boolean; identityId?: string; challenge?: WalletLinkChallenge; error?: string }> {
  const store = getIdentityPersistenceStore();

  // 1. Atomic retrieval & deletion
  const challenge = await store.consumeChallenge(challengeId);
  if (!challenge) {
    return {
      valid: false,
      error: 'Challenge not found, already consumed, or expired',
    };
  }

  // 2. Expiration check
  const now = Date.now();
  if (now > challenge.expiresAt) {
    return {
      valid: false,
      error: 'Challenge has expired. Please request a fresh challenge.',
    };
  }

  // 3. Replay nonce check
  const fresh = await store.consumeNonce('challenge', challenge.walletAddress, challenge.nonce, 600);
  if (!fresh) {
    return {
      valid: false,
      error: 'Replay detected: challenge nonce has already been consumed',
    };
  }

  // 4. Wallet address match
  const normalizedSubmitted = normalizeWalletAddress(submittedWallet, challenge.chainFamily);
  if (normalizedSubmitted !== challenge.walletAddress) {
    return {
      valid: false,
      error: `Wallet address mismatch: challenge issued to ${challenge.walletAddress}, submitted ${normalizedSubmitted}`,
    };
  }

  // 5. Cryptographic signature verification
  try {
    if (challenge.chainFamily === 'evm') {
      if (!isAddress(normalizedSubmitted)) {
        return { valid: false, error: 'Invalid EVM address' };
      }
      const isValid = await verifyMessage({
        address: normalizedSubmitted as `0x${string}`,
        message: challenge.message,
        signature: signature as `0x${string}`,
      });
      if (!isValid) {
        return { valid: false, error: 'Invalid EVM cryptographic signature' };
      }
    } else {
      const isValid = verifySolanaSignature(normalizedSubmitted, challenge.message, signature);
      if (!isValid) {
        return { valid: false, error: 'Invalid Solana Ed25519 cryptographic signature' };
      }
    }
  } catch (err: any) {
    return {
      valid: false,
      error: `Signature verification failed: ${err?.message || 'Invalid signature'}`,
    };
  }

  return {
    valid: true,
    identityId: challenge.intendedIdentityId,
    challenge,
  };
}

/**
 * Gets or creates a Veilio identity profile anchored by a primary wallet.
 */
export async function getOrCreateIdentityForWallet(
  walletAddress: string,
  chainFamily: 'evm' | 'solana',
  networkId?: string
): Promise<VeilioIdentityProfile> {
  const store = getIdentityPersistenceStore();
  return store.createProfileForWallet({ walletAddress, chainFamily, networkId });
}

export async function getIdentityProfile(identityId: string): Promise<VeilioIdentityProfile | null> {
  const store = getIdentityPersistenceStore();
  return store.getProfile(identityId);
}

export async function getIdentityByWallet(
  walletAddress: string,
  chainFamily: 'evm' | 'solana'
): Promise<VeilioIdentityProfile | null> {
  const store = getIdentityPersistenceStore();
  return store.getProfileByWallet(walletAddress, chainFamily);
}

/**
 * Links a newly verified wallet to an existing Veilio identity profile.
 */
export async function linkWalletToIdentity(
  identityId: string,
  walletRecord: {
    address: string;
    chainFamily: 'evm' | 'solana';
    networkId: string;
    proofType: 'eip191' | 'ed25519';
  }
): Promise<VeilioIdentityProfile> {
  const store = getIdentityPersistenceStore();
  return store.linkWallet({
    identityId,
    walletRecord: {
      ...walletRecord,
      linkedAt: Date.now(),
      verifiedAt: Date.now(),
      status: 'active',
      isPrimary: false,
    },
  });
}

/**
 * Recursively scrubs confidential sealed-bid preimages, secrets, and raw bid amounts.
 * Protects against alternate field names and casing variations (e.g. Salt, MAX_BID, cleartextSecret).
 */
export function sanitizeBidMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sensitiveNormalizedKeys = new Set([
    'salt',
    'secret',
    'cleartextsecret',
    'preimage',
    'maxbid',
    'maxbidlamports',
    'bidamount',
    'rawbid',
  ]);

  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const norm = key.toLowerCase().replace(/[-_]/g, '');
    if (sensitiveNormalizedKeys.has(norm)) {
      continue; // scrub sensitive field
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = sanitizeBidMetadata(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      clean[key] = value.map((v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? sanitizeBidMetadata(v as Record<string, unknown>)
          : v
      );
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

/**
 * Constructs canonical message for profile initialization authorization.
 */
export function createProfileInitMessage(input: {
  walletAddress: string;
  chainFamily: 'evm' | 'solana';
  timestamp: number;
  nonce: string;
}): string {
  return [
    'VEILIO IDENTITY PROFILE INITIALIZATION V1',
    `Wallet: ${input.walletAddress}`,
    `Chain: ${input.chainFamily}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
    'Purpose: Authorize creating a new Veilio identity profile for this wallet.',
  ].join('\n');
}

/**
 * Verifies cryptographic authorization for initializing a new Veilio identity profile.
 */
export async function verifyProfileInitAuth(params: {
  walletAddress: string;
  chainFamily: 'evm' | 'solana';
  auth: ProfileInitAuthPayload;
}): Promise<{ valid: boolean; error?: string; status?: number }> {
  const store = getIdentityPersistenceStore();
  const { walletAddress, chainFamily, auth } = params;

  if (!auth || typeof auth !== 'object') {
    return {
      valid: false,
      error: 'Missing required profile initialization authorization payload',
      status: 401,
    };
  }

  const { signerAddress, signature, timestamp, nonce, chainFamily: signerChain } = auth;
  if (!signerAddress || !signature || !timestamp || !nonce || !signerChain) {
    return {
      valid: false,
      error: 'Incomplete auth payload (signerAddress, signature, timestamp, nonce, chainFamily required)',
      status: 400,
    };
  }

  if (signerChain !== 'evm' && signerChain !== 'solana') {
    return { valid: false, error: "signerChain must be 'evm' or 'solana'", status: 400 };
  }

  const normalizedSigner = normalizeWalletAddress(signerAddress, signerChain);
  const normalizedTarget = normalizeWalletAddress(walletAddress, chainFamily);

  if (normalizedSigner !== normalizedTarget || signerChain !== chainFamily) {
    return {
      valid: false,
      error: `Unauthorized: Signer ${normalizedSigner} on ${signerChain} does not match initializing wallet ${normalizedTarget} on ${chainFamily}`,
      status: 403,
    };
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    return {
      valid: false,
      error: 'Profile initialization signature expired or invalid timestamp. Please retry.',
      status: 401,
    };
  }

  const fresh = await store.consumeNonce('init', normalizedSigner, nonce.trim(), 600);
  if (!fresh) {
    return {
      valid: false,
      error: 'Replay detected: this initialization nonce has already been used.',
      status: 401,
    };
  }

  const message = createProfileInitMessage({
    walletAddress: normalizedTarget,
    chainFamily,
    timestamp,
    nonce: nonce.trim(),
  });

  try {
    if (signerChain === 'evm') {
      const ok = await verifyMessage({
        address: normalizedSigner as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!ok) {
        return { valid: false, error: 'Invalid EVM cryptographic signature for profile initialization', status: 401 };
      }
    } else {
      const ok = verifySolanaSignature(normalizedSigner, message, signature);
      if (!ok) {
        return { valid: false, error: 'Invalid Solana Ed25519 cryptographic signature for profile initialization', status: 401 };
      }
    }
  } catch (err: any) {
    return {
      valid: false,
      error: `Signature verification failed: ${err?.message || 'Invalid signature'}`,
      status: 401,
    };
  }

  return { valid: true };
}

/**
 * Constructs the canonical message for unlinking authorization.
 */
export function createUnlinkAuthMessage(input: {
  identityId: string;
  walletAddress: string;
  signerAddress: string;
  timestamp: number;
  nonce: string;
}): string {
  return [
    'VEILIO UNLINK WALLET AUTHORIZATION V1',
    `Identity: ${input.identityId}`,
    `Wallet to Unlink: ${input.walletAddress}`,
    `Signer: ${input.signerAddress}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
    'Purpose: Authorize removing wallet from Veilio identity.',
  ].join('\n');
}

/**
 * Verifies cryptographic authorization for unlinking a wallet.
 * Enforces:
 * 1. Signer must be an active wallet of the specified identity (either primary wallet or the wallet being unlinked).
 * 2. Fresh timestamp (within 5 minutes).
 * 3. Nonce anti-replay protection.
 * 4. Valid cryptographic signature over the canonical unlinking message.
 */
export async function verifyUnlinkAuth(params: {
  identityId: string;
  walletAddress: string;
  chainFamily: 'evm' | 'solana';
  auth: UnlinkAuthPayload;
}): Promise<{ valid: boolean; error?: string; status?: number }> {
  const store = getIdentityPersistenceStore();
  const { identityId, walletAddress, chainFamily, auth } = params;

  if (!auth || typeof auth !== 'object') {
    return {
      valid: false,
      error: 'Missing required unlinking authorization payload',
      status: 401,
    };
  }

  const { signerAddress, signature, timestamp, nonce, chainFamily: signerChain } = auth;
  if (!signerAddress || !signature || !timestamp || !nonce || !signerChain) {
    return {
      valid: false,
      error: 'Incomplete auth payload (signerAddress, signature, timestamp, nonce, chainFamily required)',
      status: 400,
    };
  }

  if (signerChain !== 'evm' && signerChain !== 'solana') {
    return {
      valid: false,
      error: "signerChain must be 'evm' or 'solana'",
      status: 400,
    };
  }

  const profile = await store.getProfile(identityId);
  if (!profile) {
    return { valid: false, error: `Identity ${identityId} not found`, status: 404 };
  }

  const normalizedSigner = normalizeWalletAddress(signerAddress, signerChain);
  const normalizedTarget = normalizeWalletAddress(walletAddress, chainFamily);

  // Signer MUST be an active wallet of this identity (either primary or the exact wallet being unlinked)
  const isAuthorizedSigner = profile.linkedWallets.some(
    (w) =>
      w.address === normalizedSigner &&
      w.chainFamily === signerChain &&
      w.status === 'active' &&
      (w.isPrimary || (w.address === normalizedTarget && w.chainFamily === chainFamily))
  );

  if (!isAuthorizedSigner) {
    return {
      valid: false,
      error: `Unauthorized: Signer ${normalizedSigner} is not authorized to unlink wallet ${normalizedTarget} from identity ${identityId}`,
      status: 403,
    };
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    return {
      valid: false,
      error: 'Unlinking authorization signature expired or invalid timestamp. Please retry.',
      status: 401,
    };
  }

  const fresh = await store.consumeNonce('unlink', normalizedSigner, nonce.trim(), 600);
  if (!fresh) {
    return {
      valid: false,
      error: 'Replay detected: this unlinking nonce has already been used.',
      status: 401,
    };
  }

  const message = createUnlinkAuthMessage({
    identityId,
    walletAddress: normalizedTarget,
    signerAddress: normalizedSigner,
    timestamp,
    nonce: nonce.trim(),
  });

  try {
    if (signerChain === 'evm') {
      const ok = await verifyMessage({
        address: normalizedSigner as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!ok) {
        return { valid: false, error: 'Invalid EVM cryptographic signature for unlinking', status: 401 };
      }
    } else {
      const ok = verifySolanaSignature(normalizedSigner, message, signature);
      if (!ok) {
        return { valid: false, error: 'Invalid Solana Ed25519 cryptographic signature for unlinking', status: 401 };
      }
    }
  } catch (err: any) {
    return {
      valid: false,
      error: `Signature verification failed: ${err?.message || 'Invalid signature'}`,
      status: 401,
    };
  }

  return { valid: true };
}

/**
 * Unlinks a wallet from an identity.
 * Invariant: Cannot unlink the primary or only remaining active wallet.
 */
export async function unlinkWalletFromIdentity(
  identityId: string,
  walletAddress: string,
  chainFamily: 'evm' | 'solana'
): Promise<VeilioIdentityProfile> {
  const store = getIdentityPersistenceStore();
  return store.unlinkWallet({ identityId, walletAddress, chainFamily });
}

/**
 * Ingests an activity event with idempotent upsert and strict provenance verification.
 */
export async function ingestUnifiedActivity(item: UnifiedActivityItem): Promise<{
  inserted: boolean;
  item: UnifiedActivityItem;
}> {
  const store = getIdentityPersistenceStore();

  // Validate identity exists
  const profile = await store.getProfile(item.identityId);
  if (!profile) {
    throw new Error(`Identity ${item.identityId} not found for activity ingestion`);
  }

  // Validate wallet belongs to identity
  const normalizedWallet = normalizeWalletAddress(item.walletAddress, item.chainFamily);
  const isLinked = profile.linkedWallets.some(
    (w) => w.address === normalizedWallet && w.status === 'active'
  );
  if (!isLinked) {
    throw new Error(
      `Wallet ${normalizedWallet} is not an active linked wallet for identity ${item.identityId}`
    );
  }

  // Sanitize confidential bid secrets if activity is bid_committed
  let sanitizedMetadata = item.metadata ? { ...item.metadata } : undefined;
  if (item.activityType === 'bid_committed' && sanitizedMetadata) {
    sanitizedMetadata = sanitizeBidMetadata(sanitizedMetadata);
  }

  const cleanItem: UnifiedActivityItem = {
    ...item,
    walletAddress: normalizedWallet,
    metadata: sanitizedMetadata,
  };

  return store.saveActivity(cleanItem);
}

/**
 * Queries unified activity history for an identity across all its linked wallets.
 */
export async function getUnifiedActivityHistory(
  identityId: string,
  options?: {
    chainFamily?: 'evm' | 'solana';
    networkId?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ items: UnifiedActivityItem[]; total: number }> {
  const store = getIdentityPersistenceStore();
  const res = await store.getActivityHistory(identityId, options);
  const sanitizedItems = res.items.map((act) => {
    if (act.activityType === 'bid_committed' && act.metadata) {
      return {
        ...act,
        metadata: sanitizeBidMetadata(act.metadata),
      };
    }
    return act;
  });
  return { items: sanitizedItems, total: res.total };
}

/**
 * Queries unified service listings across all linked wallets for an identity.
 */
export async function getUnifiedServicesForIdentity(identityId: string): Promise<ServiceListing[]> {
  const store = getIdentityPersistenceStore();
  const profile = await store.getProfile(identityId);
  if (!profile) return [];

  const activeWallets = new Set(
    profile.linkedWallets.filter((w) => w.status === 'active').map((w) => w.address.toLowerCase())
  );

  const allServices = getAllServices();
  return allServices.filter((s: ServiceListing) => activeWallets.has(s.sellerId.toLowerCase()));
}
