import { NextRequest, NextResponse } from 'next/server';
import { isValidAuctionIdForNetwork, parseAuctionNetwork, scopedAuctionKey } from '@/lib/auctionNetwork';
import { readOnchainAuction } from '@/lib/server/auctionChainState';
import { getOrCreateTransaction, getDispute } from '@/lib/server/transactionDb';
import { getDatasetRecordByAuctionId } from '@/lib/server/datasetDb';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auctionId = String(id);

    const networkId = parseAuctionNetwork(req.nextUrl.searchParams.get('network'));
    if (!networkId) {
      return NextResponse.json({ error: 'Unsupported auction network' }, { status: 400 });
    }
    if (!isValidAuctionIdForNetwork(auctionId, networkId)) {
      return NextResponse.json({ error: 'Invalid auction/transaction ID' }, { status: 400 });
    }

    // Verify on-chain state on the auction's own network
    const auction = await readOnchainAuction(networkId, auctionId);
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found on chain' }, { status: 404 });
    }

    const seller = auction.seller;
    const itemName = auction.itemName;
    const description = auction.description;
    const imageURI = auction.imageURI;
    const startingPrice = auction.startingPrice;
    const inspectionDuration = auction.inspectionDuration;
    const inspectionEndTime = auction.inspectionEndTime;
    const stateNumber = auction.state;
    const highestBidder = auction.highestBidder;
    const highestBid = auction.highestBid;

    const datasetRecord = await getDatasetRecordByAuctionId(auctionId, networkId);

    const transaction = getOrCreateTransaction(scopedAuctionKey(networkId, auctionId), {
      buyerAddress: highestBidder,
      sellerAddress: seller,
      assetType: datasetRecord?.assetType || 'dataset',
      paymentStatus: stateNumber === 6
        ? 'settled'
        : stateNumber === 7 || stateNumber === 8
          ? 'refunded'
          : stateNumber >= 1 && stateNumber <= 5
            ? 'escrowed'
            : 'pending',
      deliveryStatus: datasetRecord && stateNumber >= 3 && stateNumber <= 7 ? 'delivery_submitted' : 'pending_delivery',
      inspectionDeadline: inspectionEndTime,
    });

    const dispute = getDispute(auctionId, networkId);

    return NextResponse.json({
      success: true,
      transaction,
      dispute,
      onchainState: {
        networkId,
        auctionId,
        seller,
        itemName,
        description,
        imageURI,
        startingPrice,
        inspectionDuration,
        inspectionEndTime,
        stateNumber,
        highestBidder,
        highestBid,
      },
      deliverable: datasetRecord
        ? {
            fileName: datasetRecord.fileName,
            size: datasetRecord.size,
            mimeType: datasetRecord.mimeType,
            assetType: datasetRecord.assetType,
            deliveryMethod: datasetRecord.deliveryMethod,
            manifest: datasetRecord.manifest,
            professionalMetadata: datasetRecord.professionalMetadata,
          }
        : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
