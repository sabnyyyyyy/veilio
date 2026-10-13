import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  addOrderRevision,
  sameWalletAddress,
} from '@/lib/server/servicesDb';
import { isAddress } from 'viem';
import { verifyServiceAuth, isSolanaAddress } from '@/lib/server/serviceAuth';
import { servicesErrorStatus } from '@/lib/server/serviceOrderNetwork';

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
    if (!caller || typeof caller !== 'string' || (!isAddress(caller) && !isSolanaAddress(caller))) {
      return NextResponse.json({ error: 'Valid buyerAddress (EVM or Solana) is required' }, { status: 400 });
    }
    if (!sameWalletAddress(caller, order.buyerId)) {
      return NextResponse.json({ error: 'Unauthorized: only buyer can request revision' }, { status: 403 });
    }

    // Cryptographic wallet authentication (AUDIT-001) - EIP-191 or Ed25519
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

    // Off-chain only (no on-chain counterpart); addOrderRevision enforces InReview.
    const revision = addOrderRevision(id, order.buyerId, feedback.trim().slice(0, 4000));
    return NextResponse.json({ success: true, revision });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: servicesErrorStatus(err) });
  }
}
