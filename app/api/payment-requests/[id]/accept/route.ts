import { NextRequest, NextResponse } from 'next/server';
import {
  getPaymentRequest,
  createOrderFromPaymentRequest,
} from '@/lib/server/servicesDb';
import { isAddress } from 'viem';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pr = getPaymentRequest(id);
    if (!pr) {
      return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
    }

    if (pr.status !== 'pending') {
      return NextResponse.json({ error: `Payment request is already ${pr.status}` }, { status: 400 });
    }

    const body = await req.json();
    const { buyerAddress, auth } = body;

    const caller = buyerAddress || auth?.address;
    if (!caller || !isAddress(caller)) {
      return NextResponse.json({ error: 'Valid buyer EVM address is required' }, { status: 400 });
    }

    // Role check: Only designated buyer can accept
    if (pr.buyerId.toLowerCase() !== caller.toLowerCase()) {
      return NextResponse.json(
        { error: 'Unauthorized: only designated buyer can accept this payment request' },
        { status: 403 }
      );
    }

    // Cryptographic wallet authentication (SEC-NEW-02)
    const authResult = await verifyServiceAuth({
      action: 'accept-payment-request',
      orderId: id,
      expectedAddress: pr.buyerId,
      auth: auth || {
        address: caller,
        signature: body.signature,
        timestamp: body.timestamp,
        nonce: body.nonce,
      },
    });

    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication failed' },
        { status: authResult.status || 401 }
      );
    }

    // Re-check payment request state immediately prior to order creation (SEC-NEW-02)
    const freshPr = getPaymentRequest(id);
    if (!freshPr || freshPr.status !== 'pending') {
      return NextResponse.json(
        { error: `Payment request is no longer pending (status: ${freshPr?.status || 'unknown'})` },
        { status: 409 }
      );
    }

    const order = createOrderFromPaymentRequest(id, caller);
    return NextResponse.json({ success: true, order });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
