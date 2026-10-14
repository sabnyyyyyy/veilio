import { NextRequest, NextResponse } from 'next/server';
import { getDatasetRecordByAuctionId } from '@/lib/server/datasetDb';
import { isValidAuctionIdForNetwork, parseAuctionNetwork, scopedAuctionKey } from '@/lib/auctionNetwork';
import { readOnchainAuction } from '@/lib/server/auctionChainState';
import {
  getTransactionMessages,
  getDispute,
} from '@/lib/server/transactionDb';
import { validateTransactionContext, type TransactionValidationInput } from '@/lib/server/aiValidator';
import { allowValidationRequest } from '@/lib/server/validationRateLimit';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handlePOST(
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
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    }
    const transactionKey = scopedAuctionKey(networkId, auctionId);

    // Rate-limit before parsing the request body or making RPC/Gemini calls.
    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp?.trim() || '127.0.0.1');
    let rateLimit;
    try {
      rateLimit = await allowValidationRequest(`${clientIp}:${transactionKey}`);
    } catch {
      return NextResponse.json({ error: 'Validation is temporarily unavailable. Please try again shortly.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many validation requests. Please wait before retrying.',
          retryAfter: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSeconds),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > 64 * 1024) {
      return NextResponse.json({ error: 'Request body must be 64 KB or smaller.' }, { status: 413 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }
    const { disputeFormOverride } = body as { disputeFormOverride?: unknown };
    let safeDisputeForm: TransactionValidationInput['disputeForm'];
    if (disputeFormOverride !== undefined) {
      if (!disputeFormOverride || typeof disputeFormOverride !== 'object' || Array.isArray(disputeFormOverride)) {
        return NextResponse.json({ error: 'Invalid dispute form' }, { status: 400 });
      }
      const form = disputeFormOverride as Record<string, unknown>;
      const textField = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : undefined;
      safeDisputeForm = {
        issueCategory: textField(form.issueCategory, 100),
        expectedCondition: textField(form.expectedCondition, 1000),
        actualCondition: textField(form.actualCondition, 1000),
        description: textField(form.description, 4000),
        requestedResolution: textField(form.requestedResolution, 1000),
        evidenceReferences: Array.isArray(form.evidenceReferences)
          ? form.evidenceReferences.filter((value): value is string => typeof value === 'string').slice(0, 20).map((value) => value.slice(0, 500))
          : [],
      };
    }

    // Fetch verified on-chain data from the auction's own network
    const auction = await readOnchainAuction(networkId, auctionId);
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found on chain' }, { status: 404 });
    }

    const seller = auction.seller;
    const itemName = auction.itemName;
    const description = auction.description;
    const inspectionEndTime = auction.inspectionEndTime;
    const stateNumber = auction.state;
    const highestBidder = auction.highestBidder;
    const highestBid = auction.highestBid;

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

    const datasetRecord = await getDatasetRecordByAuctionId(auctionId, networkId);
    const existingDispute = getDispute(auctionId, networkId);
    const messages = getTransactionMessages(transactionKey);

    const validationInput: TransactionValidationInput = {
      transactionId: transactionKey,
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
      delivery: datasetRecord && stateNumber >= 3 && stateNumber <= 7
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
      disputeForm: safeDisputeForm || (existingDispute
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

export const POST = withJsonStores(handlePOST);
