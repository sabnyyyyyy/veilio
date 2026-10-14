import { NextRequest, NextResponse } from 'next/server';
import {
  getDisputeById,
  getOrderById,
  getOrderSubmissions,
  getOrderRevisions,
  getConversationMessages,
  saveDisputeRecommendation,
  sameWalletAddress,
} from '@/lib/server/servicesDb';
import { evaluateDisputeWithAi } from '@/lib/server/disputeAiEvaluator';
import { isAddress } from 'viem';
import { verifyServiceAuth, isSolanaAddress } from '@/lib/server/serviceAuth';
import { allowValidationRequest } from '@/lib/server/validationRateLimit';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: disputeId } = await params;
    const dispute = getDisputeById(disputeId);
    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const order = getOrderById(dispute.orderId);
    if (!order) {
      return NextResponse.json({ error: 'Associated order not found' }, { status: 404 });
    }

    if (dispute.status === 'resolved') {
      return NextResponse.json({ error: 'A resolved dispute cannot be re-evaluated.' }, { status: 409 });
    }
    const body = await req.json().catch(() => null);
    const auth = body && typeof body === 'object' ? (body as { auth?: { address?: string } }).auth : undefined;
    if (!auth?.address || (!isAddress(auth.address) && !isSolanaAddress(auth.address))) {
      return NextResponse.json({ error: 'Signed participant authorization is required.' }, { status: 401 });
    }
    const expectedAddress = [order.buyerId, order.sellerId].find((address) => sameWalletAddress(address, auth.address));
    if (!expectedAddress) {
      return NextResponse.json({ error: 'Only the buyer or seller may request an evaluation.' }, { status: 403 });
    }
    const authResult = await verifyServiceAuth({
      action: 'evaluate-dispute',
      orderId: disputeId,
      expectedAddress,
      auth,
    });
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error || 'Wallet authentication failed.' }, { status: authResult.status || 401 });
    }

    let rateLimit;
    try {
      rateLimit = await allowValidationRequest(`service-dispute:${disputeId}:${expectedAddress}`, 60_000, 3);
    } catch {
      return NextResponse.json({ error: 'AI evaluation is temporarily unavailable. Please try again shortly.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many AI evaluations. Please wait before retrying.', retryAfter: rateLimit.retryAfterSeconds }, {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      });
    }

    const submissions = getOrderSubmissions(order.id);
    const revisions = getOrderRevisions(order.id);
    const messages = getConversationMessages(order.conversationId);

    // Run AI Evaluation
    const recommendation = await evaluateDisputeWithAi({
      dispute,
      order,
      submissions,
      revisions,
      messages,
    });

    // Persist recommendation in DB
    const updatedDispute = saveDisputeRecommendation(disputeId, recommendation);

    return NextResponse.json({
      success: true,
      recommendation,
      dispute: updatedDispute,
      message: 'AI dispute evaluation completed successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withJsonStores(handlePOST);
