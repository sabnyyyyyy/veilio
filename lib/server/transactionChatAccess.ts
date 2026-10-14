import { readOnchainAuction } from './auctionChainState';
import { extractServiceAuth, verifyServiceSessionAuth } from './serviceAuth';

/** Auction transaction chat runs on BNB Testnet (see app/auctions/[id]/page.tsx). */
const CHAT_NETWORK = 'bnb:97' as const;
const PARTIES_TTL_MS = 30_000;

export interface AuctionChatParties {
  seller: string;
  /** Winning bidder; empty until the auction has a winner. */
  buyer: string;
}

const partiesCache = new Map<string, { parties: AuctionChatParties | null; expiresAt: number }>();

/**
 * Buyer and seller come from the auction contract, never from the request or the chat
 * record, so nobody can join a chat by claiming to be a party.
 */
export async function getAuctionChatParties(auctionId: string): Promise<AuctionChatParties | null> {
  const cached = partiesCache.get(auctionId);
  if (cached && cached.expiresAt > Date.now()) return cached.parties;

  const auction = await readOnchainAuction(CHAT_NETWORK, auctionId);
  const parties = auction
    ? { seller: auction.seller.toLowerCase(), buyer: (auction.highestBidder || '').toLowerCase() }
    : null;
  partiesCache.set(auctionId, { parties, expiresAt: Date.now() + PARTIES_TTL_MS });
  return parties;
}

export type AuctionChatAccess =
  | { ok: true; address: string; role: 'buyer' | 'seller'; parties: AuctionChatParties }
  | { ok: false; status: number; error: string };

/**
 * Verifies the signed wallet session (header or `auth` body field) and that the wallet is the
 * auction's seller or winning bidder.
 */
export async function authorizeAuctionChat(
  headers: Headers,
  auctionId: string,
  body?: unknown
): Promise<AuctionChatAccess> {
  const session = await verifyServiceSessionAuth(extractServiceAuth(headers, body as any));
  if (!session.valid || !session.address) {
    return { ok: false, status: session.status || 401, error: session.error || 'Sign in with your wallet to use this chat.' };
  }

  let parties: AuctionChatParties | null;
  try {
    parties = await getAuctionChatParties(auctionId);
  } catch {
    return { ok: false, status: 503, error: 'Could not verify auction participants on-chain. Please retry.' };
  }

  const address = session.address.toLowerCase();
  const role = parties && address === parties.seller ? 'seller' : parties && parties.buyer && address === parties.buyer ? 'buyer' : null;
  if (!parties || !role) {
    // Same response for unknown auctions and non-participants.
    return { ok: false, status: 404, error: 'Transaction chat not found' };
  }
  return { ok: true, address, role, parties };
}
