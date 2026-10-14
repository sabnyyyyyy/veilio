import { NextRequest, NextResponse } from 'next/server';
import { submitDispute } from '@/lib/server/transactionDb';
import { validateTransactionContext } from '@/lib/server/aiValidator';
import { getDatasetRecordByAuctionId } from '@/lib/server/datasetDb';
import { AUCTION_AUTH_ACTIONS, isValidAuctionIdForNetwork, parseAuctionNetwork, sameWallet } from '@/lib/auctionNetwork';
import { readOnchainAuction } from '@/lib/server/auctionChainState';
import { verifyAuctionAuth } from '@/lib/server/auctionAuth';


import { withJsonStores } from '@/lib/server/jsonStore';
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auctionId = String(id);

    const body = await req.json();
    const {
      network,
      auth,
      issueCategory,
      expectedCondition,
      actualCondition,
      description,
      evidenceReferences = [],
      requestedResolution = 'Full Refund',
    } = body;

    const networkId = parseAuctionNetwork(network);
    if (!networkId) {
      return NextResponse.json({ error: 'Unsupported auction network' }, { status: 400 });
    }
    if (!isValidAuctionIdForNetwork(auctionId, networkId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    if (!issueCategory || !expectedCondition || !actualCondition || !description) {
      return NextResponse.json(
        { error: 'Missing required dispute fields (issueCategory, expectedCondition, actualCondition, description)' },
        { status: 400 }
      );
    }
    if (!Array.isArray(evidenceReferences) || evidenceReferences.some((ref: unknown) => typeof ref !== 'string')) {
      return NextResponse.json({ error: 'evidenceReferences must be a list of strings' }, { status: 400 });
    }

    // The caller proves wallet ownership with a signature (EIP-191 / ed25519);
    // a client-supplied address alone is not trusted.
    const authResult = await verifyAuctionAuth({ action: AUCTION_AUTH_ACTIONS.submitDispute, networkId, auctionId, auth });
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const buyerAddress = authResult.address;

    // Verify on-chain that the signer is the actual highest bidder and state allows refund
    const auction = await readOnchainAuction(networkId, auctionId);
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found on chain' }, { status: 404 });
    }

    const seller = auction.seller;
    const itemName = auction.itemName;
    const itemDescription = auction.description;
    const inspectionEndTime = auction.inspectionEndTime;
    const stateNumber = auction.state;
    const highestBidder = auction.highestBidder;
    const highestBid = auction.highestBid;

    if (!sameWallet(buyerAddress, highestBidder, networkId)) {
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

    const datasetRecord = await getDatasetRecordByAuctionId(auctionId, networkId);

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
    }, networkId);

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

export const POST = withJsonStores(handlePOST);
