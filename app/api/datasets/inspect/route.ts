import { NextRequest, NextResponse } from 'next/server';
import { getDatasetRecordByAuctionId } from '@/lib/server/datasetDb';
import { datasetInspectMessageFor, isValidAuctionIdForNetwork, parseAuctionNetwork, sameWallet } from '@/lib/auctionNetwork';
import { isWalletAddressForNetwork, readOnchainAuction } from '@/lib/server/auctionChainState';
import { verifyWalletSignature } from '@/lib/server/walletSignature';
import { auditAssetEvent } from '@/lib/server/assetAudit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { auctionId, address, signature, timestamp, network } = body;

    if (!auctionId || !address || !signature || !timestamp) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const networkId = parseAuctionNetwork(network);
    if (!networkId) return NextResponse.json({ error: 'Unsupported auction network.' }, { status: 400 });
    const id = String(auctionId);
    const time = Number(timestamp);
    if (!isValidAuctionIdForNetwork(id, networkId) || !isWalletAddressForNetwork(address, networkId) || !Number.isSafeInteger(time)) {
      return NextResponse.json({ error: 'Invalid auction ID, wallet address, or timestamp.' }, { status: 400 });
    }

    // Short-lived signature prevents unauthenticated inspection requests.
    const now = Date.now();
    if (Math.abs(now - time) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired or invalid timestamp' }, { status: 401 });
    }

    const message = datasetInspectMessageFor(networkId, { auctionId: id, address, timestamp: time });
    const isValidSignature = await verifyWalletSignature({ address, message, signature });

    if (!isValidSignature) {
      auditAssetEvent({ action: 'inspect', result: 'denied', auctionId: id, walletAddress: address, reasonCode: 'invalid_signature' });
      return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });
    }

    // 3. Verify on-chain state on the auction's own network
    const auction = await readOnchainAuction(networkId, id);
    if (!auction) return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    const state = auction.state;

    // Allowed states for inspection: Inspection(3), RefundRequested(4), UnderReview(5)
    // Even if completed(6), they have full access anyway, but inspect should still work for UI consistency
    if (state < 3 || state > 6) {
      auditAssetEvent({ action: 'inspect', result: 'denied', auctionId: id, walletAddress: address, reasonCode: 'auction_state' });
      return NextResponse.json({ error: 'Dataset inspection is only available during the inspection phase or after completion.' }, { status: 403 });
    }

    if (!sameWallet(auction.highestBidder, address, networkId)) {
      auditAssetEvent({ action: 'inspect', result: 'denied', auctionId: id, walletAddress: address, reasonCode: 'not_winner' });
      return NextResponse.json({ error: 'Wallet is not the winning bidder' }, { status: 403 });
    }

    // 4. Retrieve Dataset Record
    const record = await getDatasetRecordByAuctionId(id, networkId);
    if (!record) {
      return NextResponse.json({ error: 'Dataset record not found for this auction' }, { status: 404 });
    }

    // 5. Return Manifest & Bounded Sample (NO ENCRYPTION KEYS OR RAW DATA)
    auditAssetEvent({ action: 'inspect', result: 'success', assetType: record.assetType || 'dataset', sizeBytes: record.size, auctionId: id, walletAddress: address });
    return NextResponse.json({
      success: true,
      manifest: record.manifest, // Includes bounded sample and statistics
      deliveryInfo: state === 3 || state === 4 || state === 5 || state === 6 ? record.assetDetails : undefined,
    });

  } catch (err: unknown) {
    auditAssetEvent({ action: 'inspect', result: 'error', reasonCode: 'unexpected_error' });
    console.error('[Dataset Inspect] Unexpected failure:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Could not complete the asset inspection request.' }, { status: 500 });
  }
}
