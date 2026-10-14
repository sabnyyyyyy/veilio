import { isAddress, verifyMessage } from 'viem';
import {
  createServiceAuthMessage,
  createServiceSessionMessage,
  LEGACY_SERVICE_AUTH_PURPOSE,
  SERVICE_AUTH_HEADER,
  SERVICE_SESSION_ACTION,
  SERVICE_SESSION_SCOPE,
  SERVICE_SESSION_MAX_AGE_MS,
  type ServiceAuthPayload,
} from '../serviceAuth';
import { decodeBase58 } from '../cross-chain/solanaServiceRegistry';
import { ed25519 } from '@noble/curves/ed25519';

// In-memory cache for replay-prevention: address:nonce -> expirationTimestamp
const usedNonces = new Map<string, number>();

// Clean up expired nonces periodically
function cleanupNonces() {
  const now = Date.now();
  for (const [key, expiresAt] of usedNonces.entries()) {
    if (now > expiresAt) {
      usedNonces.delete(key);
    }
  }
}

export interface VerifyServiceAuthParams {
  action: string;
  orderId: string;
  expectedAddress: string;
  auth: Partial<ServiceAuthPayload> | undefined | null;
}

export interface VerifyServiceAuthResult {
  valid: boolean;
  error?: string;
  status?: number;
}

export function isSolanaAddress(addr: string): boolean {
  if (typeof addr !== 'string' || addr.length < 32 || addr.length > 44) return false;
  try {
    const bytes = decodeBase58(addr);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

function parseSolanaSignature(sig: string): Uint8Array | null {
  try {
    if (sig.startsWith('0x')) {
      const hex = sig.slice(2);
      if (hex.length === 128) {
        return new Uint8Array(Buffer.from(hex, 'hex'));
      }
    }
    const decoded = decodeBase58(sig);
    if (decoded.length === 64) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validates cryptographic wallet authorization for state-changing Services API routes.
 * Supports both EVM (EIP-191 personal_sign) and Solana (Ed25519).
 *
 * Verifies:
 * 1. Required auth payload presence (address, signature, timestamp, nonce)
 * 2. Proper Ethereum or Solana address format
 * 3. Exact match between caller and authorized role address
 * 4. Timestamp validity and freshness (within 5 minutes window)
 * 5. Replay prevention (nonce must not be previously used)
 * 6. Cryptographic message signature against server-reconstructed message
 */
export async function verifyServiceAuth(
  params: VerifyServiceAuthParams
): Promise<VerifyServiceAuthResult> {
  const { action, orderId, expectedAddress, auth } = params;

  if (!auth || typeof auth !== 'object') {
    return {
      valid: false,
      error: 'Missing required cryptographic authentication payload',
      status: 401,
    };
  }

  const { address, signature, timestamp, nonce } = auth;

  if (!address || typeof address !== 'string') {
    return {
      valid: false,
      error: 'Valid wallet address is required in auth payload',
      status: 400,
    };
  }

  const isEvm = isAddress(address);
  const isSol = !isEvm && isSolanaAddress(address);

  if (!isEvm && !isSol) {
    return {
      valid: false,
      error: 'Valid wallet address is required in auth payload (must be 20-byte EVM or 32-byte Solana Base58 address)',
      status: 400,
    };
  }

  if (!signature || typeof signature !== 'string') {
    return {
      valid: false,
      error: 'Valid cryptographic signature is required in auth payload',
      status: 401,
    };
  }

  if (isEvm && !signature.startsWith('0x')) {
    return {
      valid: false,
      error: 'Valid cryptographic signature (0x-prefixed) is required for EVM auth payload',
      status: 401,
    };
  }

  const time = Number(timestamp);
  if (!Number.isSafeInteger(time)) {
    return {
      valid: false,
      error: 'Valid integer timestamp is required in auth payload',
      status: 400,
    };
  }

  if (!nonce || typeof nonce !== 'string' || nonce.trim().length < 6) {
    return {
      valid: false,
      error: 'Valid nonce (minimum 6 characters) is required for replay prevention',
      status: 400,
    };
  }

  // 1. Role verification: caller must match expected participant address
  const normAddress = isEvm ? address.toLowerCase() : address;
  const normExpected = isEvm ? expectedAddress.toLowerCase() : expectedAddress;
  if (normAddress !== normExpected) {
    return {
      valid: false,
      error: `Unauthorized: caller address ${address} does not match required participant ${expectedAddress}`,
      status: 403,
    };
  }

  // 2. Timestamp freshness check (allow max 5 minutes clock skew)
  const now = Date.now();
  const maxSkewMs = 5 * 60 * 1000;
  if (Math.abs(now - time) > maxSkewMs) {
    return {
      valid: false,
      error: 'Authorization signature expired or invalid timestamp. Please retry.',
      status: 401,
    };
  }

  // 3. Replay prevention with atomic in-memory reservation (SEC-NEW-03)
  cleanupNonces();
  const nonceKey = `${normAddress}:${nonce.trim()}`;
  if (usedNonces.has(nonceKey)) {
    return {
      valid: false,
      error: 'Replay detected: this authorization nonce has already been used or is currently being processed.',
      status: 401,
    };
  }

  // Atomically reserve the nonce immediately before entering async signature verification.
  usedNonces.set(nonceKey, now + 10 * 60 * 1000);

  // 4. Server-side message reconstruction & cryptographic verification
  const messageInput = { action, orderId, address, timestamp: time, nonce: nonce.trim() };
  const sigResult = await verifyCurrentOrLegacy(address, isEvm, signature, (purpose) =>
    createServiceAuthMessage(messageInput, purpose));
  if (!sigResult.valid) {
    usedNonces.delete(nonceKey);
    return sigResult;
  }

  // Verification succeeded - keep nonce in usedNonces for the full 10 minute TTL
  return { valid: true };
}

/**
 * Verifies against the current message wording, then the legacy purpose line, so clients
 * (SDK builds, open browser sessions) that signed the old text keep working.
 */
async function verifyCurrentOrLegacy(
  address: string,
  isEvm: boolean,
  signature: string,
  build: (purpose?: string) => string
): Promise<VerifyServiceAuthResult> {
  const current = await verifyWalletSignature(address, isEvm, build(), signature);
  if (current.valid) return current;
  const legacy = await verifyWalletSignature(address, isEvm, build(LEGACY_SERVICE_AUTH_PURPOSE), signature);
  return legacy.valid ? legacy : current;
}

/**
 * Verifies an EIP-191 (EVM) or Ed25519 (Solana) signature over `message`.
 */
async function verifyWalletSignature(
  address: string,
  isEvm: boolean,
  message: string,
  signature: string
): Promise<VerifyServiceAuthResult> {
  try {
    if (isEvm) {
      const isValid = await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });

      if (!isValid) {
        return {
          valid: false,
          error: 'Invalid wallet signature for the specified action and order.',
          status: 401,
        };
      }
    } else {
      // Solana Ed25519 verification
      const sigBytes = parseSolanaSignature(signature);
      if (!sigBytes) {
        return {
          valid: false,
          error: 'Malformed Solana signature: must be 64 bytes Base58 or hex encoded.',
          status: 401,
        };
      }

      const pubkeyBytes = decodeBase58(address);
      const messageBytes = Buffer.from(message, 'utf8');
      const isValid = ed25519.verify(sigBytes, messageBytes, pubkeyBytes);

      if (!isValid) {
        return {
          valid: false,
          error: 'Invalid Solana Ed25519 signature for the specified action and order.',
          status: 401,
        };
      }
    }
  } catch (sigErr: any) {
    return {
      valid: false,
      error: `Cryptographic signature verification failed: ${sigErr.message || 'Malformed signature'}`,
      status: 401,
    };
  }
  return { valid: true };
}

// ============================================================================
// Session authorization for reads and chat (see lib/serviceAuth.ts for the scheme)
// ============================================================================

export interface VerifyServiceSessionResult extends VerifyServiceAuthResult {
  /** Authenticated wallet, normalized per family (EVM lowercased, Solana verbatim). */
  address?: string;
}

/**
 * Reads the session auth payload from a JSON body `auth` field or, for GET requests,
 * from the `x-veilio-auth` header (JSON-encoded ServiceAuthPayload).
 */
export function extractServiceAuth(
  headers: { get(name: string): string | null },
  body?: { auth?: unknown } | null
): Partial<ServiceAuthPayload> | null {
  if (body && body.auth && typeof body.auth === 'object') {
    return body.auth as Partial<ServiceAuthPayload>;
  }
  const raw = headers.get(SERVICE_AUTH_HEADER);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<ServiceAuthPayload>) : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a services session signature. Unlike verifyServiceAuth the nonce is not
 * consumed (the session is reusable until it expires) so it must only gate reads and
 * chat messages, never escrow state transitions.
 */
export async function verifyServiceSessionAuth(
  auth: Partial<ServiceAuthPayload> | null | undefined
): Promise<VerifyServiceSessionResult> {
  if (!auth || typeof auth !== 'object') {
    return { valid: false, error: 'Signed wallet session is required (x-veilio-auth header or auth body field)', status: 401 };
  }
  const { address, signature, timestamp, nonce } = auth;
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Valid wallet address is required in auth payload', status: 401 };
  }
  const isEvm = isAddress(address);
  if (!isEvm && !isSolanaAddress(address)) {
    return { valid: false, error: 'Auth address must be a 20-byte EVM or 32-byte Solana Base58 address', status: 400 };
  }
  if (!signature || typeof signature !== 'string' || (isEvm && !signature.startsWith('0x'))) {
    return { valid: false, error: 'Valid cryptographic signature is required in auth payload', status: 401 };
  }
  const time = Number(timestamp);
  if (!Number.isSafeInteger(time)) {
    return { valid: false, error: 'Valid integer timestamp is required in auth payload', status: 400 };
  }
  if (!nonce || typeof nonce !== 'string' || nonce.trim().length < 6) {
    return { valid: false, error: 'Valid nonce (minimum 6 characters) is required', status: 400 };
  }
  const now = Date.now();
  if (time - now > 5 * 60 * 1000 || now - time > SERVICE_SESSION_MAX_AGE_MS) {
    return { valid: false, error: 'Wallet session expired. Please sign in again.', status: 401 };
  }

  const sessionInput = { action: SERVICE_SESSION_ACTION, orderId: SERVICE_SESSION_SCOPE, address, timestamp: time, nonce: nonce.trim() };
  const sigResult = await verifyCurrentOrLegacy(address, isEvm, signature, (purpose) =>
    purpose ? createServiceAuthMessage(sessionInput, purpose) : createServiceSessionMessage(sessionInput));
  if (!sigResult.valid) return sigResult;

  return { valid: true, address: isEvm ? address.toLowerCase() : address };
}
