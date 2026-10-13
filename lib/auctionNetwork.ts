/**
 * Chain-aware helpers for VEILIO auctions (BNB Testnet, Base Sepolia, Solana Devnet).
 *
 * Safe to import from both client components and server routes. Signed message
 * builders for `bnb:97` delegate to `lib/assetAuth` so signatures produced by
 * older clients (and records created before multi-chain support) keep working.
 */

import {
  datasetDownloadMessage as bnbDatasetDownloadMessage,
  datasetInspectMessage as bnbDatasetInspectMessage,
  datasetLinkMessage as bnbDatasetLinkMessage,
  datasetPreviewMessage as bnbDatasetPreviewMessage,
} from './assetAuth';
import { BASE_SEPOLIA_AUCTION_ADDRESS, VEIL_V3_CONTRACT_ADDRESS } from './contract';
import { getSolanaAuctionProgramId } from './cross-chain/solanaAuction';

export type AuctionNetworkId = 'bnb:97' | 'base:84532' | 'solana:devnet';

export const AUCTION_NETWORK_IDS: readonly AuctionNetworkId[] = ['bnb:97', 'base:84532', 'solana:devnet'];

/** Legacy records and requests without a network are BNB Testnet auctions. */
export const DEFAULT_AUCTION_NETWORK: AuctionNetworkId = 'bnb:97';

/**
 * Parses a user/client supplied network value. Missing values default to BNB
 * (backward compatibility); unknown values return null so routes can reject them.
 */
export function parseAuctionNetwork(value: unknown): AuctionNetworkId | null {
  if (value === undefined || value === null || value === '') return DEFAULT_AUCTION_NETWORK;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim().toLowerCase();
  switch (normalized) {
    case 'bnb':
    case 'bnb:97':
    case '97':
      return 'bnb:97';
    case 'base':
    case 'base:84532':
    case '84532':
      return 'base:84532';
    case 'solana':
    case 'solana:devnet':
      return 'solana:devnet';
    default:
      return null;
  }
}

export function isSolanaAuctionNetwork(networkId: AuctionNetworkId): networkId is 'solana:devnet' {
  return networkId === 'solana:devnet';
}

export function auctionNetworkChainId(networkId: AuctionNetworkId): number | null {
  if (networkId === 'bnb:97') return 97;
  if (networkId === 'base:84532') return 84532;
  return null;
}

/** Value used in `/auctions/[id]?network=` links. */
export function auctionNetworkQueryValue(networkId: AuctionNetworkId): string {
  return networkId === 'solana:devnet' ? 'solana' : networkId === 'base:84532' ? 'base' : 'bnb';
}

export function auctionNetworkDisplayName(networkId: AuctionNetworkId): string {
  return networkId === 'solana:devnet' ? 'Solana Devnet' : networkId === 'base:84532' ? 'Base Sepolia' : 'BNB Chain Testnet';
}

/**
 * Storage key for per-auction off-chain records. BNB keeps the bare auction ID
 * so existing records (written before multi-chain support) are still found.
 */
export function scopedAuctionKey(networkId: AuctionNetworkId, auctionId: string): string {
  return networkId === 'bnb:97' ? auctionId : `${networkId}:${auctionId}`;
}

/** Auction IDs are u64 on Solana and uint256 on EVM; both are positive decimal strings. */
export function isValidAuctionIdForNetwork(auctionId: string, networkId: AuctionNetworkId): boolean {
  if (!/^[1-9]\d{0,77}$/.test(auctionId)) return false;
  if (networkId === 'solana:devnet') return BigInt(auctionId) <= 0xffffffffffffffffn;
  return true;
}

/** EVM addresses compare case-insensitively; Solana base58 keys are case-sensitive. */
export function normalizeWalletForNetwork(address: string, networkId: AuctionNetworkId): string {
  return networkId === 'solana:devnet' ? address : address.toLowerCase();
}

export function sameWallet(a: string | null | undefined, b: string | null | undefined, networkId: AuctionNetworkId): boolean {
  if (!a || !b) return false;
  return normalizeWalletForNetwork(a, networkId) === normalizeWalletForNetwork(b, networkId);
}

export function auctionContractLabel(networkId: AuctionNetworkId): string {
  if (networkId === 'solana:devnet') return getSolanaAuctionProgramId();
  if (networkId === 'base:84532') return BASE_SEPOLIA_AUCTION_ADDRESS.toLowerCase();
  return VEIL_V3_CONTRACT_ADDRESS.toLowerCase();
}

function assetDomain(action: string, networkId: AuctionNetworkId) {
  return [
    'VEILIO ASSET ACCESS V1',
    `Action: ${action}`,
    networkId === 'solana:devnet' ? `Network: ${networkId}` : `Chain ID: ${auctionNetworkChainId(networkId)}`,
    networkId === 'solana:devnet' ? `Program: ${auctionContractLabel(networkId)}` : `Contract: ${auctionContractLabel(networkId)}`,
  ].join('\n');
}

export function datasetLinkMessageFor(networkId: AuctionNetworkId, input: { datasetId: string; auctionId: string; address: string; timestamp: number }) {
  if (networkId === 'bnb:97') return bnbDatasetLinkMessage(input);
  return [assetDomain('link', networkId), `Dataset ID: ${input.datasetId}`, `Auction ID: ${input.auctionId}`, `Seller: ${normalizeWalletForNetwork(input.address, networkId)}`, `Timestamp: ${input.timestamp}`].join('\n');
}

export function datasetInspectMessageFor(networkId: AuctionNetworkId, input: { auctionId: string; address: string; timestamp: number }) {
  if (networkId === 'bnb:97') return bnbDatasetInspectMessage(input);
  return [assetDomain('inspect', networkId), `Auction ID: ${input.auctionId}`, `Wallet: ${normalizeWalletForNetwork(input.address, networkId)}`, `Timestamp: ${input.timestamp}`].join('\n');
}

export function datasetDownloadMessageFor(networkId: AuctionNetworkId, input: { auctionId: string; address: string; timestamp: number }) {
  if (networkId === 'bnb:97') return bnbDatasetDownloadMessage(input);
  return [assetDomain('download', networkId), `Auction ID: ${input.auctionId}`, `Wallet: ${normalizeWalletForNetwork(input.address, networkId)}`, `Timestamp: ${input.timestamp}`].join('\n');
}

export function datasetPreviewMessageFor(networkId: AuctionNetworkId, input: { auctionId: string; address: string; timestamp: number }) {
  if (networkId === 'bnb:97') return bnbDatasetPreviewMessage(input);
  return [assetDomain('publish preview', networkId), 'Purpose: Make up to 10 dataset rows and column names public for this auction. This is an off-chain signature only; it does not submit a blockchain transaction.', `Auction ID: ${input.auctionId}`, `Seller: ${normalizeWalletForNetwork(input.address, networkId)}`, `Timestamp: ${input.timestamp}`].join('\n');
}

/** Signed action names shared by clients and API routes. */
export const AUCTION_AUTH_ACTIONS = {
  submitDispute: 'submit-dispute',
  respondDispute: 'respond-dispute',
  submitRefundEvidence: 'submit-refund-evidence',
  listRefunds: 'list-refunds',
} as const;

/** Auction ID placeholder for authorizations that are not tied to one auction. */
export const ALL_AUCTIONS = '*';

/** Replay-resistant authorization for auction dispute/reviewer API calls. */
export interface AuctionAuthPayload {
  address: string;
  signature: string;
  timestamp: number;
  nonce: string;
}

export function createAuctionAuthMessage(input: {
  action: string;
  networkId: AuctionNetworkId;
  auctionId: string;
  address: string;
  timestamp: number;
  nonce: string;
}): string {
  return [
    'VEILIO AUCTION AUTHORIZATION V1',
    `Action: ${input.action}`,
    `Network: ${input.networkId}`,
    `Contract: ${auctionContractLabel(input.networkId)}`,
    `Auction ID: ${input.auctionId}`,
    `Wallet: ${normalizeWalletForNetwork(input.address, input.networkId)}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
    'Purpose: Off-chain authorization only; this signature does not submit a blockchain transaction.',
  ].join('\n');
}

export function generateAuctionAuthNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Text describing what non-winning bidders get back. EVM V3/V4 deducts a 5%
 * anti-abort penalty from unrevealed deposits; the Solana program does not.
 */
export function noWinnerRefundText(networkId: AuctionNetworkId, symbol: string): string {
  if (networkId === 'solana:devnet') {
    return `Every bidder (revealed or not) can claim back their full ${symbol} deposit; Solana auctions charge no penalty.`;
  }
  return `Any deposited ${symbol} has been credited back for withdrawal (minus a 5% anti-abort penalty for unrevealed bids).`;
}

/** Platform fee in basis points: EVM V3/V4 constant 10%, Solana program 0%. */
export function auctionPlatformFeeBps(networkId: AuctionNetworkId): number {
  return networkId === 'solana:devnet' ? 0 : 1000;
}
