import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, isAddress } from 'viem';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_CONTRACT_ADDRESS, VEIL_V3_ABI } from '@/lib/contract';
import { submitDispute, getDispute } from '@/lib/server/transactionDb';
import { validateTransactionContext } from '@/lib/server/aiValidator';
import { getDatasetRecordByAuctionId } from '@/lib/server/datasetDb';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auctionId = String(id);

    if (!/^[1-9]\d{0,77}$/.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    const body = await req.json();
    const {
      buyerAddress,
      issueCategory,
      expectedCondition,
      actualCondition,
      description,
      evidenceReferences = [],
      requestedResolution = 'Full Refund',
    } = body;

    if (!buyerAddress || !isAddress(String(buyerAddress))) {
      return NextResponse.json({ error: 'Valid buyerAddress is required' }, { status: 400 });
    }

    if (!issueCategory || !expectedCondition || !actualCondition || !description) {
      return NextResponse.json(
        { error: 'Missing required dispute fields (issueCategory, expectedCondition, actualCondition, description)' },
        { status: 400 }
      );
    }

    // Verify on-chain caller is the actual highest bidder and state allows refund
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
    const itemDescription = String(raw[3]);
    const inspectionEndTime = Number(raw[9]);
    const stateNumber = Number(raw[10]);
    const highestBidder = String(raw[11]);
    const highestBid = String(raw[12]);

    if (buyerAddress.toLowerCase() !== highestBidder.toLowerCase()) {
      return NextResponse.json(
        { error: 'Unauthorized: Only the winning bidder can submit a dispute or request refund' },
        { status: 403 }
      );
    }

    // Must be in Inspection phase (3) or already requested (4)
    if (stateNumber !== 3 && stateNumber !== 4) {
      return NextResponse.json(
        { error: `Refund requests are only valid during Inspection phase (Current state: ${stateNumber})` },
        { status: 400 }
      );
    }

    const datasetRecord = await getDatasetRecordByAuctionId(auctionId);

    // Run AI validator assessment for reviewer notes
    const aiAssessment = await validateTransactionContext({
      transactionId: auctionId,
      auctionId,
      buyerAddress,
      sellerAddress: seller,
      contractState: {
        stateNumber,
        stateName: 'Inspection',
        highestBidder,
        winningPriceBnb: highestBid,
        inspectionEndTime,
      },
      listing: {
        auctionId,
        itemName,
        description: itemDescription,
        assetType: datasetRecord?.assetType || 'dataset',
        licenseType: datasetRecord?.professionalMetadata?.licenseType,
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
            manifest: datasetRecord.manifest,
          }
        : undefined,
      disputeForm: {
        issueCategory,
        expectedCondition,
        actualCondition,
        description,
        evidenceReferences,
        requestedResolution,
      },
    });

    // Save dispute and get canonical evidence hash
    const dispute = submitDispute(auctionId, {
      buyerAddress,
      sellerAddress: seller,
      issueCategory,
      expectedCondition,
      actualCondition,
      description,
      evidenceReferences,
      requestedResolution,
      aiAssessment,
    });

    return NextResponse.json({
      success: true,
      dispute,
      evidenceHash: dispute.evidenceHash,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
