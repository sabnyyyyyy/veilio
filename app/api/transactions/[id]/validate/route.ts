import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, isAddress } from 'viem';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_CONTRACT_ADDRESS, VEIL_V3_ABI } from '@/lib/contract';
import { getDatasetRecordByAuctionId } from '@/lib/server/datasetDb';
import {
  getOrCreateTransaction,
  getTransactionMessages,
  getDispute,
} from '@/lib/server/transactionDb';
import { validateTransactionContext, type TransactionValidationInput } from '@/lib/server/aiValidator';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auctionId = String(id);

    if (!/^[1-9]\d{0,77}$/.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { disputeFormOverride } = body;

    // Fetch verified on-chain data
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
    const inspectionEndTime = Number(raw[9]);
    const stateNumber = Number(raw[10]);
    const highestBidder = String(raw[11]);
    const highestBid = String(raw[12]);

    const stateNames = [
      'Created',
      'Bidding',
      'Revealing',
      'Inspection',
      'RefundRequested',
      'UnderReview',
      'Completed',
      'Refunded',
      'Cancelled',
    ];

    const datasetRecord = await getDatasetRecordByAuctionId(auctionId);
    const existingDispute = getDispute(auctionId);
    const messages = getTransactionMessages(auctionId);

    const validationInput: TransactionValidationInput = {
      transactionId: auctionId,
      auctionId,
      buyerAddress: highestBidder,
      sellerAddress: seller,
      contractState: {
        stateNumber,
        stateName: stateNames[stateNumber] || `State ${stateNumber}`,
        highestBidder,
        winningPriceBnb: highestBid,
        inspectionEndTime,
      },
      listing: {
        auctionId,
        itemName,
        description,
        assetType: datasetRecord?.assetType || 'dataset',
        licenseType: datasetRecord?.professionalMetadata?.licenseType,
        usageRights: datasetRecord?.professionalMetadata?.usageRights,
        expectedFormat: datasetRecord?.manifest?.format,
        expectedRecordCount: datasetRecord?.manifest?.recordCount,
        expectedColumnCount: datasetRecord?.manifest?.columnCount,
      },
      delivery: datasetRecord
        ? {
            deliveryStatus: 'delivery_submitted',
            assetType: datasetRecord.assetType,
            fileName: datasetRecord.fileName,
            fileSize: datasetRecord.size,
            fileHashHex: datasetRecord.fileHashHex,
            manifest: datasetRecord.manifest,
            accessInstructionsAvailable: true,
          }
        : undefined,
      disputeForm: disputeFormOverride || (existingDispute
        ? {
            issueCategory: existingDispute.issueCategory,
            expectedCondition: existingDispute.expectedCondition,
            actualCondition: existingDispute.actualCondition,
            description: existingDispute.description,
            evidenceReferences: existingDispute.evidenceReferences,
            requestedResolution: existingDispute.requestedResolution,
          }
        : undefined),
      chatMessages: messages.map((m) => ({
        senderType: m.senderType,
        senderAddress: m.senderAddress,
        content: m.content,
        timestamp: m.createdAt,
      })),
    };

    const report = await validateTransactionContext(validationInput);

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
