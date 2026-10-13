import { NextRequest, NextResponse } from 'next/server';
import { saveRefundEvidence, getAllRefundEvidence } from '@/lib/server/refundDb';
import crypto from 'crypto';
import {
  ALL_AUCTIONS,
  AUCTION_AUTH_ACTIONS,
  isValidAuctionIdForNetwork,
  parseAuctionNetwork,
  sameWallet,
} from '@/lib/auctionNetwork';
import { readEvmAuctionReviewer, readOnchainAuction } from '@/lib/server/auctionChainState';
import { verifyAuctionAuth } from '@/lib/server/auctionAuth';

const MAX_SOLANA_LOOKUPS = 100;

/**
 * Reviewer-only listing of refund evidence for one network.
 * Query: network, address, signature, timestamp, nonce (signed `list-refunds` for auction `*`).
 * EVM: signer must be the auction contract's reviewer(). Solana: only auctions
 * whose on-chain reviewer is the signer are returned.
 */
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const networkId = parseAuctionNetwork(params.get('network'));
    if (!networkId) return NextResponse.json({ error: 'Unsupported auction network' }, { status: 400 });

    const authResult = await verifyAuctionAuth({
      action: AUCTION_AUTH_ACTIONS.listRefunds,
      networkId,
      auctionId: ALL_AUCTIONS,
      auth: {
        address: params.get('address') || undefined,
        signature: params.get('signature') || undefined,
        timestamp: params.get('timestamp') || undefined,
        nonce: params.get('nonce') || undefined,
      },
    });
    if (!authResult.valid) return NextResponse.json({ error: authResult.error }, { status: authResult.status });

    const evidenceList = getAllRefundEvidence().filter((record) => record.networkId === networkId);

    if (networkId !== 'solana:devnet') {
      const reviewer = await readEvmAuctionReviewer(networkId);
      if (!sameWallet(reviewer, authResult.address, networkId)) {
        return NextResponse.json({ error: 'Unauthorized: wallet is not the auction contract reviewer' }, { status: 403 });
      }
      return NextResponse.json({ success: true, networkId, refunds: evidenceList });
    }

    const refunds = [];
    for (const record of evidenceList.slice(0, MAX_SOLANA_LOOKUPS)) {
      try {
        const auction = await readOnchainAuction(networkId, record.auctionId);
        if (auction?.reviewer && sameWallet(auction.reviewer, authResult.address, networkId)) refunds.push(record);
      } catch {
        // Skip auctions whose state cannot be read right now.
      }
    }
    return NextResponse.json({ success: true, networkId, refunds });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Stores refund evidence. Only the on-chain winner of an auction in Inspection
 * (or RefundRequested) may submit, proven by a signed `submit-refund-evidence`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { auctionId, network, auth, disputedCriterion, expectedValue, actualValue, reason } = body;

    if (!auctionId || !disputedCriterion || !expectedValue || !actualValue || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const networkId = parseAuctionNetwork(network);
    if (!networkId) return NextResponse.json({ error: 'Unsupported auction network' }, { status: 400 });
    const id = String(auctionId);
    if (!isValidAuctionIdForNetwork(id, networkId)) return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    if ([disputedCriterion, expectedValue, actualValue, reason].some((value) => typeof value !== 'string' || value.length > 4000)) {
      return NextResponse.json({ error: 'Evidence fields must be text (max 4000 characters).' }, { status: 400 });
    }

    const authResult = await verifyAuctionAuth({ action: AUCTION_AUTH_ACTIONS.submitRefundEvidence, networkId, auctionId: id, auth });
    if (!authResult.valid) return NextResponse.json({ error: authResult.error }, { status: authResult.status });

    const auction = await readOnchainAuction(networkId, id);
    if (!auction) return NextResponse.json({ error: 'Auction not found on chain' }, { status: 404 });
    if (!sameWallet(auction.highestBidder, authResult.address, networkId)) {
      return NextResponse.json({ error: 'Unauthorized: only the winning bidder can submit refund evidence' }, { status: 403 });
    }
    if (auction.state !== 3 && auction.state !== 4) {
      return NextResponse.json({ error: 'Refund evidence is only accepted during inspection or an open refund request.' }, { status: 409 });
    }

    const buyer = authResult.address;
    // Generate evidence hash (mocking an IPFS upload or off-chain immutable storage hash)
    const evidenceStr = JSON.stringify({ auctionId: id, buyer, disputedCriterion, expectedValue, actualValue, reason });
    const evidenceHash = `0x${crypto.createHash('sha256').update(evidenceStr).digest('hex')}`;

    saveRefundEvidence({
      auctionId: id,
      networkId,
      buyer,
      disputedCriterion,
      expectedValue,
      actualValue,
      reason,
      evidenceHash,
      timestamp: Date.now(),
    });

    return NextResponse.json({ success: true, evidenceHash });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
