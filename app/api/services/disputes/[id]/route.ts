import { NextRequest, NextResponse } from 'next/server';
import {
  getDisputeById,
  getOrderById,
  getOrderSubmissions,
  getOrderRevisions,
  sameWalletAddress,
} from '@/lib/server/servicesDb';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';

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
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const body = await req.json().catch(() => null);
    const auth = body?.auth;
    const wallet = typeof auth?.address === 'string' ? auth.address : '';
    const isBuyer = sameWalletAddress(wallet, order.buyerId);
    const isSeller = sameWalletAddress(wallet, order.sellerId);
    if (!isBuyer && !isSeller) {
      return NextResponse.json({ error: 'Only the order buyer or seller may view this dispute.' }, { status: 403 });
    }
    const authResult = await verifyServiceAuth({
      action: 'read-dispute',
      orderId: dispute.orderId,
      expectedAddress: isBuyer ? order.buyerId : order.sellerId,
      auth,
    });
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication failed' },
        { status: authResult.status || 401 }
      );
    }

    const submissions = getOrderSubmissions(dispute.orderId);
    const revisions = getOrderRevisions(dispute.orderId);

    return NextResponse.json({
      success: true,
      dispute,
      order,
      submissions,
      revisions,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withJsonStores(handlePOST);
