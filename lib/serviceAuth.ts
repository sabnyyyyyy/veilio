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
