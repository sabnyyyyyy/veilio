// In-app copy of packages/veilio-sdk/src/auth.ts. Keep in sync.
import type { Address, Hex } from 'viem';
import { VeilioSdkError } from './errors';

/** Signed `auth` object expected by VEILIO Services API routes. */
export interface ServiceAuthPayload {
  address: Address;
  signature: Hex;
  timestamp: number;
  nonce: string;
}

/** Anything that can produce an EIP-191 personal_sign signature (a viem LocalAccount works). */
export interface MessageSigner {
  address: Address;
  signMessage: (args: { message: string }) => Promise<Hex>;
}

/** Random 16-hex-character nonce from a cryptographically secure source. */
export function generateAuthNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new VeilioSdkError({
      code: 'INVALID_CONFIG',
      message: 'A cryptographically secure random generator is required to create an auth nonce.',
    });
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Exact message the VEILIO API verifies; must match the server byte-for-byte. */
export function createServiceAuthMessage(input: {
  action: string;
  orderId: string;
  address: string;
  timestamp: number;
  nonce: string;
}): string {
  return [
    'VEILIO SERVICES AUTHORIZATION V1',
    `Action: ${input.action}`,
    `Order ID: ${input.orderId}`,
    `Wallet: ${input.address.toLowerCase()}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
    'Purpose: Authorize off-chain state change for VEILIO Services escrow.',
  ].join('\n');
}

/**
 * Builds the signed `auth` payload for an off-chain Services action
 * (e.g. 'accept-payment-request', 'verify-deposit', 'submit', 'revision', 'approve', 'cancel').
 */
export async function signServiceAuth(
  signer: MessageSigner,
  action: string,
  orderId: string
): Promise<ServiceAuthPayload> {
  const timestamp = Date.now();
  const nonce = generateAuthNonce();
  const message = createServiceAuthMessage({ action, orderId, address: signer.address, timestamp, nonce });
  const signature = await signer.signMessage({ message });
  return { address: signer.address, signature, timestamp, nonce };
}

// ---------------------------------------------------------------------------
// Read / chat session (matches the VEILIO server's lib/serviceAuth.ts scheme)
// ---------------------------------------------------------------------------

export const SERVICE_SESSION_ACTION = 'services-session';
export const SERVICE_SESSION_SCOPE = 'session';
/** The server accepts a session for 30 minutes after its timestamp. */
export const SERVICE_SESSION_MAX_AGE_MS = 30 * 60 * 1000;
/** Header that carries the JSON-encoded session payload on GET requests. */
export const SERVICE_AUTH_HEADER = 'x-veilio-auth';

/**
 * Signs a reusable read/chat session (nonce not consumed by the server). It authorizes reads and
 * chat only, never escrow state changes, which need `signServiceAuth` per request.
 */
export function signServiceSession(signer: MessageSigner): Promise<ServiceAuthPayload> {
  return signServiceAuth(signer, SERVICE_SESSION_ACTION, SERVICE_SESSION_SCOPE);
}

/** True while a session is at least one minute away from server-side expiry. */
export function isServiceSessionFresh(auth: ServiceAuthPayload | null | undefined, address?: string): boolean {
  if (!auth?.signature) return false;
  if (address && auth.address.toLowerCase() !== address.toLowerCase()) return false;
  return Date.now() - auth.timestamp < SERVICE_SESSION_MAX_AGE_MS - 60 * 1000;
}

/** `{ 'x-veilio-auth': JSON }` header map for a session payload. */
export function encodeServiceAuthHeader(auth: ServiceAuthPayload): Record<string, string> {
  return { [SERVICE_AUTH_HEADER]: JSON.stringify(auth) };
}
