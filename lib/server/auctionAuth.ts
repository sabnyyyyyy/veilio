/**
 * Replay-resistant wallet authorization for auction dispute / reviewer routes.
 * Modeled on lib/server/serviceAuth.ts, but bound to (action, network,
 * auction contract, auction ID) via `createAuctionAuthMessage`.
 *
 * This only proves who signed. Callers must still check the signer's on-chain
 * role (winner, seller or reviewer) with lib/server/auctionChainState.ts.
 */

import { createAuctionAuthMessage, normalizeWalletForNetwork, type AuctionNetworkId } from '../auctionNetwork';
import { isWalletAddressForNetwork } from './auctionChainState';
import { verifyWalletSignature } from './walletSignature';

const AUTH_MAX_SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;
const usedNonces = new Map<string, number>();

function cleanupNonces(now: number) {
  for (const [key, expiresAt] of usedNonces.entries()) {
    if (now > expiresAt) usedNonces.delete(key);
  }
}

export type AuctionAuthResult =
  | { valid: true; address: string }
  | { valid: false; error: string; status: number };

export async function verifyAuctionAuth(params: {
  action: string;
  networkId: AuctionNetworkId;
  auctionId: string;
  auth: unknown;
  now?: number;
}): Promise<AuctionAuthResult> {
  const { action, networkId, auctionId } = params;
  const auth = params.auth as Partial<Record<'address' | 'signature' | 'timestamp' | 'nonce', unknown>> | null | undefined;
  if (!auth || typeof auth !== 'object') {
    return { valid: false, error: 'A wallet signature is required for this request.', status: 401 };
  }
  const { address, signature, nonce } = auth;
  const timestamp = Number(auth.timestamp);
  if (!isWalletAddressForNetwork(address, networkId)) {
    return { valid: false, error: `A valid ${networkId === 'solana:devnet' ? 'Solana' : 'EVM'} wallet address is required.`, status: 400 };
  }
  if (typeof signature !== 'string' || !signature) {
    return { valid: false, error: 'A wallet signature is required for this request.', status: 401 };
  }
  if (!Number.isSafeInteger(timestamp)) {
    return { valid: false, error: 'A valid timestamp is required.', status: 400 };
  }
  if (typeof nonce !== 'string' || nonce.trim().length < 8 || nonce.length > 128) {
    return { valid: false, error: 'A valid nonce is required.', status: 400 };
  }
  const now = params.now ?? Date.now();
  if (Math.abs(now - timestamp) > AUTH_MAX_SKEW_MS) {
    return { valid: false, error: 'Authorization expired. Please sign again.', status: 401 };
  }

  cleanupNonces(now);
  const nonceKey = `${networkId}:${normalizeWalletForNetwork(address, networkId)}:${nonce.trim()}`;
  if (usedNonces.has(nonceKey)) {
    return { valid: false, error: 'Replay detected: this authorization was already used.', status: 401 };
  }
  usedNonces.set(nonceKey, now + NONCE_TTL_MS);

  const message = createAuctionAuthMessage({ action, networkId, auctionId, address, timestamp, nonce: nonce.trim() });
  const ok = await verifyWalletSignature({ address, message, signature });
  if (!ok) {
    usedNonces.delete(nonceKey);
    return { valid: false, error: 'Invalid wallet signature.', status: 401 };
  }
  return { valid: true, address };
}
