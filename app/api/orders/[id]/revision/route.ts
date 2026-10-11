import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  addOrderRevision,
} from '@/lib/server/servicesDb';
import { isAddress } from 'viem';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const body = await req.json();
    const { buyerAddress, feedback, auth } = body;

    const caller = buyerAddress || auth?.address;
    if (!caller || !isAddress(caller)) {
      return NextResponse.json({ error: 'Valid buyerAddress is required' }, { status: 400 });
    }

    // Cryptographic wallet authentication (AUDIT-001)
    const authResult = await verifyServiceAuth({
      action: 'revision',
      orderId: id,
      expectedAddress: order.buyerId,
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

    if (!feedback || typeof feedback !== 'string' || feedback.trim().length < 5) {
      return NextResponse.json({ error: 'Detailed revision feedback is required (minimum 5 characters)' }, { status: 400 });
    }

    const revision = addOrderRevision(id, caller, feedback.trim());
    return NextResponse.json({ success: true, revision });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
