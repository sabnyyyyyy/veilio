import { NextRequest, NextResponse } from 'next/server';
import { respondToDispute } from '@/lib/server/transactionDb';
import { AUCTION_AUTH_ACTIONS, isValidAuctionIdForNetwork, parseAuctionNetwork, sameWallet } from '@/lib/auctionNetwork';
import { readOnchainAuction } from '@/lib/server/auctionChainState';
import { verifyAuctionAuth } from '@/lib/server/auctionAuth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auctionId = String(id);

    const body = await req.json();
    const { network, auth, statement, evidenceReferences } = body;

    const networkId = parseAuctionNetwork(network);
    if (!networkId) {
      return NextResponse.json({ error: 'Unsupported auction network' }, { status: 400 });
    }
    if (!isValidAuctionIdForNetwork(auctionId, networkId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    if (!statement || typeof statement !== 'string' || statement.trim().length === 0) {
      return NextResponse.json({ error: 'Statement is required' }, { status: 400 });
    }

    // Seller must prove wallet ownership; the on-chain seller is the only authority.
    const authResult = await verifyAuctionAuth({ action: AUCTION_AUTH_ACTIONS.respondDispute, networkId, auctionId, auth });
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const auction = await readOnchainAuction(networkId, auctionId);
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found on chain' }, { status: 404 });
    }
    if (!sameWallet(authResult.address, auction.seller, networkId)) {
      return NextResponse.json(
        { error: 'Unauthorized: Only the seller of this auction can submit a response' },
        { status: 403 }
      );
    }

    const updatedDispute = respondToDispute(auctionId, {
      statement: statement.trim().slice(0, 4000),
      evidenceReferences: Array.isArray(evidenceReferences)
        ? evidenceReferences.filter((ref: unknown): ref is string => typeof ref === 'string').slice(0, 20)
        : [],
    }, networkId);

    if (!updatedDispute) {
      return NextResponse.json({ error: 'No dispute found for this auction' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      dispute: updatedDispute,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
