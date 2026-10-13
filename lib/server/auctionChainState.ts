/**
 * Server-side, chain-aware reader of VEILIO auction state.
 *
 * EVM (BNB Testnet / Base Sepolia) reads `auctions(id)` from the VeilNFTV4 /
 * VeilV3 contract configured in lib/contract.ts. Solana Devnet decodes the
 * `veilio-auction` AuctionStateAccount PDA. State numbers share one numbering:
 * Created/active=0 (Solana Bidding=1, Revealing=2), Inspection=3,
 * RefundRequested=4, UnderReview=5, Completed=6, Refunded=7, Cancelled=8.
 */

import { createPublicClient, http, isAddress } from 'viem';
import { baseSepoliaChain, bnbChain } from '../chain';
import { getAuctionContractConfig } from '../contract';
import type { AuctionNetworkId } from '../auctionNetwork';
import { fetchSolanaAuctionConfig, fetchSolanaAuctionStateById, SOLANA_DEFAULT_PUBKEY } from '../solanaAuctions';
import { decodeBase58 } from '../cross-chain/solanaServiceRegistry';

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface OnchainAuctionSnapshot {
  networkId: AuctionNetworkId;
  auctionId: string;
  seller: string;
  itemName: string;
  description: string;
  imageURI: string;
  startingPrice: string;
  commitEndTime: number;
  revealEndTime: number;
  inspectionDuration: number;
  inspectionEndTime: number;
  state: number;
  /** Empty string when there is no winner. */
  highestBidder: string;
  highestBid: string;
  /**
   * Solana: the wallet authorized to sign review_refund. After the program upgrade this is the
   * global AuctionConfig reviewer (the per-auction field is only an informational snapshot);
   * before it (no config account) the reviewer stored in the auction. EVM uses the
   * contract-wide reviewer() instead.
   */
  reviewer?: string;
  /** Solana: reviewer stored in the auction account at creation. */
  storedReviewer?: string;
  /** Solana: where `reviewer` came from. */
  reviewerSource?: 'onchain-config' | 'auction';
  evidenceHash: string;
  reviewReason: string;
}

export function evmChainForNetwork(networkId: AuctionNetworkId) {
  if (networkId === 'base:84532') return baseSepoliaChain;
  if (networkId === 'bnb:97') return bnbChain;
  throw new Error(`${networkId} is not an EVM auction network.`);
}

export function evmClientForNetwork(networkId: AuctionNetworkId) {
  const chain = evmChainForNetwork(networkId);
  const rpc = networkId === 'base:84532' ? process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC : process.env.NEXT_PUBLIC_BNB_CHAIN_RPC;
  return createPublicClient({ chain, transport: http(rpc || undefined) });
}

/** Returns null when the auction does not exist on that network. */
export async function readOnchainAuction(networkId: AuctionNetworkId, auctionId: string): Promise<OnchainAuctionSnapshot | null> {
  if (networkId === 'solana:devnet') {
    const [decoded, config] = await Promise.all([
      fetchSolanaAuctionStateById(auctionId),
      fetchSolanaAuctionConfig(),
    ]);
    if (!decoded) return null;
    const active = decoded.state === 0 || decoded.state === 1 || decoded.state === 2;
    return {
      networkId,
      auctionId: decoded.auctionId.toString(),
      seller: decoded.seller,
      itemName: decoded.itemName,
      description: decoded.description,
      imageURI: decoded.imageUri,
      startingPrice: decoded.startingPrice.toString(),
      commitEndTime: decoded.commitEndTime,
      revealEndTime: decoded.revealEndTime,
      inspectionDuration: decoded.inspectionDuration,
      inspectionEndTime: decoded.inspectionEndTime,
      state: active ? 0 : Number(decoded.state),
      highestBidder: decoded.highestBidder === SOLANA_DEFAULT_PUBKEY ? '' : decoded.highestBidder,
      highestBid: decoded.highestBid.toString(),
      reviewer: config ? config.reviewer : decoded.reviewer,
      storedReviewer: decoded.reviewer,
      reviewerSource: config ? 'onchain-config' : 'auction',
      evidenceHash: decoded.evidenceHash,
      reviewReason: decoded.reviewReason,
    };
  }

  const contract = getAuctionContractConfig(evmChainForNetwork(networkId).id);
  const client = evmClientForNetwork(networkId);
  const raw = await client.readContract({
    address: contract.address,
    abi: contract.abi,
    functionName: 'auctions',
    args: [BigInt(auctionId)],
  }) as readonly unknown[];
  if (!raw || String(raw[0]) === '0') return null;
  const highestBidder = String(raw[11]);
  return {
    networkId,
    auctionId: String(raw[0]),
    seller: String(raw[1]),
    itemName: String(raw[2]),
    description: String(raw[3]),
    imageURI: String(raw[4]),
    startingPrice: String(raw[5]),
    commitEndTime: Number(raw[6]),
    revealEndTime: Number(raw[7]),
    inspectionDuration: Number(raw[8]),
    inspectionEndTime: Number(raw[9]),
    state: Number(raw[10]),
    highestBidder: highestBidder.toLowerCase() === ZERO_EVM_ADDRESS ? '' : highestBidder,
    highestBid: String(raw[12]),
    evidenceHash: String(raw[16] ?? ''),
    reviewReason: String(raw[17] ?? ''),
  };
}

/** Contract-wide reviewer for EVM auction contracts. */
export async function readEvmAuctionReviewer(networkId: AuctionNetworkId): Promise<string> {
  const contract = getAuctionContractConfig(evmChainForNetwork(networkId).id);
  const client = evmClientForNetwork(networkId);
  return String(await client.readContract({ address: contract.address, abi: contract.abi, functionName: 'reviewer', args: [] }));
}

export function isWalletAddressForNetwork(address: unknown, networkId: AuctionNetworkId): address is string {
  if (typeof address !== 'string') return false;
  if (networkId !== 'solana:devnet') return isAddress(address, { strict: false });
  if (address.length < 32 || address.length > 44) return false;
  try {
    return decodeBase58(address).length === 32;
  } catch {
    return false;
  }
}
