import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage, createPublicClient, http, isAddress } from 'viem';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_CONTRACT_ADDRESS, VEIL_V3_ABI } from '@/lib/contract';
import { getDatasetRecordByAuctionId } from '@/lib/server/datasetDb';
import { datasetInspectMessage } from '@/lib/assetAuth';
import { auditAssetEvent } from '@/lib/server/assetAudit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { auctionId, address, signature, timestamp } = body;

    if (!auctionId || !address || !signature || !timestamp) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const id = String(auctionId);
    const time = Number(timestamp);
    if (!/^[1-9]\d{0,77}$/.test(id) || !isAddress(String(address)) || !Number.isSafeInteger(time)) {
      return NextResponse.json({ error: 'Invalid auction ID, wallet address, or timestamp.' }, { status: 400 });
    }

    // Short-lived signature prevents unauthenticated inspection requests.
    const now = Date.now();
    if (Math.abs(now - time) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired or invalid timestamp' }, { status: 401 });
    }

    const message = datasetInspectMessage({ auctionId: id, address: String(address), timestamp: time });
    const isValidSignature = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValidSignature) {
      auditAssetEvent({ action: 'inspect', result: 'denied', auctionId: id, walletAddress: String(address), reasonCode: 'invalid_signature' });
      return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });
    }

    // 3. Verify On-Chain State
    const publicClient = createPublicClient({ chain: bnbChain, transport: http(process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || undefined) });

    const auctionRaw = await publicClient.readContract({
      address: VEIL_V3_CONTRACT_ADDRESS,
      abi: VEIL_V3_ABI,
      functionName: 'auctions',
      args: [BigInt(id)],
    });

    const values = auctionRaw as readonly unknown[];

    // Parse state and highestBidder based on ABI length
    let state: number;
    let highestBidder: string;

    if (values.length === 15) {
      state = Number(values[8]);
      highestBidder = String(values[9]);
    } else {
      state = Number(values[10]);
      highestBidder = String(values[11]);
    }

    // Allowed states for inspection: Inspection(3), RefundRequested(4), UnderReview(5)
    // Even if completed(6), they have full access anyway, but inspect should still work for UI consistency
    if (state < 3 || state > 6) {
      auditAssetEvent({ action: 'inspect', result: 'denied', auctionId: id, walletAddress: String(address), reasonCode: 'auction_state' });
      return NextResponse.json({ error: 'Dataset inspection is only available during the inspection phase or after completion.' }, { status: 403 });
    }

    if (highestBidder.toLowerCase() !== address.toLowerCase()) {
      auditAssetEvent({ action: 'inspect', result: 'denied', auctionId: id, walletAddress: String(address), reasonCode: 'not_winner' });
      return NextResponse.json({ error: 'Wallet is not the winning bidder' }, { status: 403 });
    }

    // 4. Retrieve Dataset Record
    const record = getDatasetRecordByAuctionId(id);
    if (!record) {
      return NextResponse.json({ error: 'Dataset record not found for this auction' }, { status: 404 });
    }

    // 5. Return Manifest & Bounded Sample (NO ENCRYPTION KEYS OR RAW DATA)
    auditAssetEvent({ action: 'inspect', result: 'success', assetType: record.assetType || 'dataset', sizeBytes: record.size, auctionId: id, walletAddress: String(address) });
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
