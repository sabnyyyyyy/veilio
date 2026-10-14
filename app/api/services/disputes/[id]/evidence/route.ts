import { NextRequest, NextResponse } from 'next/server';
import { addDisputeEvidence, getDisputeById, getOrderById, sameWalletAddress } from '@/lib/server/servicesDb';
import { isAddress } from 'viem';
import { verifyServiceAuth, isSolanaAddress } from '@/lib/server/serviceAuth';

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

    const body = await req.json();
    const { submittedBy, evidenceType, title, description, references, auth } = body;

    if (!submittedBy || !title || !description) {
      return NextResponse.json(
        { error: 'Missing required fields: submittedBy, title, and description are required' },
        { status: 400 }
      );
    }

    if (dispute.status === 'resolved') {
      return NextResponse.json({ error: 'Evidence cannot be added to a resolved dispute.' }, { status: 409 });
    }
    const order = getOrderById(dispute.orderId);
    if (!order || (!isAddress(String(submittedBy)) && !isSolanaAddress(String(submittedBy)))) {
      return NextResponse.json({ error: 'A valid buyer or seller wallet is required.' }, { status: 400 });
    }
    const expectedAddress = [order.buyerId, order.sellerId].find((address) => sameWalletAddress(address, String(submittedBy)));
    if (!expectedAddress) {
      return NextResponse.json({ error: 'Only the buyer or seller may submit evidence.' }, { status: 403 });
    }
    const authResult = await verifyServiceAuth({
      action: 'submit-dispute-evidence',
      orderId: disputeId,
      expectedAddress,
      auth,
    });
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error || 'Wallet authentication failed.' }, { status: authResult.status || 401 });
    }

    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof description !== 'string' || !description.trim() || description.length > 4000) {
      return NextResponse.json({ error: 'Title must be 1–200 characters and description 1–4000 characters.' }, { status: 400 });
    }

    const validTypes = ['claim', 'file_url', 'milestone_proof', 'contract_log', 'chat_excerpt'];
    if (!validTypes.includes(evidenceType)) {
      return NextResponse.json({ error: 'Invalid evidence type.' }, { status: 400 });
    }
    const resolvedType = evidenceType;

    const evidence = addDisputeEvidence({
      disputeId,
      submittedBy: expectedAddress,
      evidenceType: resolvedType as any,
      title: title.trim(),
      description: description.trim(),
      references: Array.isArray(references) ? references.filter((r: unknown): r is string => typeof r === 'string').slice(0, 20).map((r: string) => r.slice(0, 500)) : [],
    });

    const updatedDispute = getDisputeById(disputeId);

    return NextResponse.json({
      success: true,
      evidence,
      dispute: updatedDispute,
      message: 'Evidence submitted successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export const POST = withJsonStores(handlePOST);
