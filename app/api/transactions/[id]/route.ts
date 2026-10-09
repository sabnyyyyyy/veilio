import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, isAddress } from 'viem';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_CONTRACT_ADDRESS, VEIL_V3_ABI } from '@/lib/contract';
import { getOrCreateTransaction, getDispute } from '@/lib/server/transactionDb';
import { getDatasetRecordByAuctionId } from '@/lib/server/datasetDb';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auctionId = String(id);

    if (!/^[1-9]\d{0,77}$/.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction/transaction ID' }, { status: 400 });
    }

    // Verify on-chain state
    const publicClient = createPublicClient({
      chain: bnbChain,
      transport: http(process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || undefined),
    });

    const raw = (await publicClient.readContract({
      address: VEIL_V3_CONTRACT_ADDRESS,
      abi: VEIL_V3_ABI,
      functionName: 'auctions',
      args: [BigInt(auctionId)],
    })) as readonly unknown[];

    if (!raw || Number(raw[0]) === 0) {
      return NextResponse.json({ error: 'Auction not found on chain' }, { status: 404 });
    }

    const seller = String(raw[1]);
    const itemName = String(raw[2]);
    const description = String(raw[3]);
    const imageURI = String(raw[4]);
    const startingPrice = String(raw[5]);
    const inspectionDuration = Number(raw[8]);
    const inspectionEndTime = Number(raw[9]);
    const stateNumber = Number(raw[10]);
    const highestBidder = String(raw[11]);
    const highestBid = String(raw[12]);

    const datasetRecord = await getDatasetRecordByAuctionId(auctionId);

    const transaction = getOrCreateTransaction(auctionId, {
      buyerAddress: highestBidder,
      sellerAddress: seller,
      assetType: datasetRecord?.assetType || 'dataset',
      paymentStatus: stateNumber >= 6 ? 'settled' : 'escrowed',
      deliveryStatus: datasetRecord ? 'delivery_submitted' : 'pending_delivery',
      inspectionDeadline: inspectionEndTime,
    });

    const dispute = getDispute(auctionId);

    return NextResponse.json({
      success: true,
      transaction,
      dispute,
      onchainState: {
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
