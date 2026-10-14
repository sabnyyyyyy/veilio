/**
 * VEILIO Services Cryptographic Wallet Authentication
 *
 * Provides message formats, nonce helpers, and signature verification
 * for replay-resistant authorization of state-changing Services actions.
 */

export interface ServiceAuthPayload {
  address: string;
  signature: string;
  timestamp: number;
  nonce: string;
}

export function generateAuthNonce(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Wallets show this text when signing, so it states plainly that nothing is paid.
const SERVICE_ACTION_PURPOSE = 'Purpose: Off-chain authorization only. This signature does not move funds and costs no gas.';
const SERVICE_SESSION_PURPOSE = 'Purpose: Sign in to VEILIO Services. This is not a transaction: no funds move and no gas is charged.';
/** Purpose line signed by clients before the wording change; the server still accepts it. */
export const LEGACY_SERVICE_AUTH_PURPOSE = 'Purpose: Authorize off-chain state change for VEILIO Services escrow.';

export function createServiceAuthMessage(input: {
  action: string;
  orderId: string;
  address: string;
  timestamp: number;
  nonce: string;
}, purpose?: string): string {
  return [
    'VEILIO SERVICES AUTHORIZATION V1',
    `Action: ${input.action}`,
    `Order ID: ${input.orderId}`,
    `Wallet: ${input.address.toLowerCase()}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
    purpose ?? (input.action === 'services-session' ? SERVICE_SESSION_PURPOSE : SERVICE_ACTION_PURPOSE),
  ].join('\n');
}

// ============================================================================
// Read / chat session authorization
// ============================================================================
//
// Scheme (used by conversations, messages, payment-request reads and order reads):
//   - The wallet signs createServiceAuthMessage({ action: SERVICE_SESSION_ACTION,
//     orderId: SERVICE_SESSION_SCOPE, address, timestamp, nonce }) once.
//   - The resulting ServiceAuthPayload is sent either as JSON in the
//     `x-veilio-auth` request header (GET requests) or as `auth` in a JSON body.
//   - The server accepts it for SERVICE_SESSION_MAX_AGE_MS after `timestamp`. The
//     nonce is NOT consumed, so the same session can authorize read polling and
//     chat messages without a wallet prompt per request. It never authorizes
//     escrow/state-changing order actions, which keep per-request signed nonces.
//   - The server additionally checks that the session address is a participant of
//     the conversation / order being accessed.

export const SERVICE_SESSION_ACTION = 'services-session';
export const SERVICE_SESSION_SCOPE = 'session';
export const SERVICE_SESSION_MAX_AGE_MS = 30 * 60 * 1000;
export const SERVICE_AUTH_HEADER = 'x-veilio-auth';

export function createServiceSessionMessage(input: {
  address: string;
  timestamp: number;
  nonce: string;
}): string {
  return createServiceAuthMessage({
    action: SERVICE_SESSION_ACTION,
    orderId: SERVICE_SESSION_SCOPE,
    address: input.address,
    timestamp: input.timestamp,
    nonce: input.nonce,
  });
}

/** True while a cached session payload is still comfortably inside its validity window. */
export function isServiceSessionFresh(auth: ServiceAuthPayload | null | undefined, address?: string | null): boolean {
  if (!auth || !auth.signature) return false;
  if (address && auth.address.toLowerCase() !== address.toLowerCase()) return false;
  // Refresh one minute before the server-side expiry.
  return Date.now() - auth.timestamp < SERVICE_SESSION_MAX_AGE_MS - 60 * 1000;
}

export function encodeServiceAuthHeader(auth: ServiceAuthPayload): Record<string, string> {
  return { [SERVICE_AUTH_HEADER]: JSON.stringify(auth) };
}
