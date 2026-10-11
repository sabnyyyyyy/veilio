import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  addOrderSubmission,
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
    const { sellerAddress, description, deliverableReferences = [], auth } = body;

    const caller = sellerAddress || auth?.address;
    if (!caller || !isAddress(caller)) {
      return NextResponse.json({ error: 'Valid sellerAddress is required' }, { status: 400 });
    }

    // Cryptographic wallet authentication (AUDIT-001)
    const authResult = await verifyServiceAuth({
      action: 'submit',
      orderId: id,
      expectedAddress: order.sellerId,
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

    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      return NextResponse.json({ error: 'Submission description is required (minimum 5 characters)' }, { status: 400 });
    }

    const submission = addOrderSubmission(
      id,
      caller,
      description.trim(),
      Array.isArray(deliverableReferences) ? deliverableReferences : []
    );

    return NextResponse.json({ success: true, submission });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
