import { isAddress, verifyMessage } from 'viem';
import { createServiceAuthMessage, type ServiceAuthPayload } from '../serviceAuth';

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

/**
 * Validates cryptographic wallet authorization for state-changing Services API routes.
 *
 * Verifies:
 * 1. Required auth payload presence (address, signature, timestamp, nonce)
 * 2. Proper Ethereum address format
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

  if (!address || typeof address !== 'string' || !isAddress(address)) {
    return {
      valid: false,
      error: 'Valid wallet address is required in auth payload',
      status: 400,
    };
  }

  if (!signature || typeof signature !== 'string' || !signature.startsWith('0x')) {
    return {
      valid: false,
      error: 'Valid cryptographic signature (0x-prefixed) is required in auth payload',
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
  if (address.toLowerCase() !== expectedAddress.toLowerCase()) {
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
  // NOTE: This in-memory reservation cache is strictly single-instance.
  // For multi-instance horizontal scaling, back with distributed Redis atomic SETNX with TTL.
  cleanupNonces();
  const nonceKey = `${address.toLowerCase()}:${nonce.trim()}`;
  if (usedNonces.has(nonceKey)) {
    return {
      valid: false,
      error: 'Replay detected: this authorization nonce has already been used or is currently being processed.',
      status: 401,
    };
  }

  // Atomically reserve the nonce immediately before entering async signature verification.
  // This blocks any concurrent request with the same nonce from passing the check.
  usedNonces.set(nonceKey, now + 10 * 60 * 1000);

  // 4. Server-side message reconstruction & cryptographic verification
  const message = createServiceAuthMessage({
    action,
    orderId,
    address,
    timestamp: time,
    nonce: nonce.trim(),
  });

  try {
    const isValid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      // Release reservation on verification failure so legitimate retries aren't blocked
      usedNonces.delete(nonceKey);
      return {
        valid: false,
        error: 'Invalid wallet signature for the specified action and order.',
        status: 401,
      };
    }
  } catch (sigErr: any) {
    // Release reservation on verification error so caller can retry
    usedNonces.delete(nonceKey);
    return {
      valid: false,
      error: `Cryptographic signature verification failed: ${sigErr.message || 'Malformed signature'}`,
      status: 401,
    };
  }

  // Verification succeeded - keep nonce in usedNonces for the full 10 minute TTL
  return { valid: true };
}
