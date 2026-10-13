import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  getOrderSubmissions,
  getOrderRevisions,
  getDisputeByOrderId,
  getOrderNetwork,
  sameWalletAddress,
} from '@/lib/server/servicesDb';
import { verifyServiceAuth, verifyServiceSessionAuth, extractServiceAuth } from '@/lib/server/serviceAuth';
import { getSolanaServiceReviewer } from '@/lib/cross-chain/solanaServiceEscrow';
import { resolveSolanaEscrowPlatformConfig } from '@/lib/server/solanaServiceVerification';

/**
 * Order summary for a participant. Requires a signed services session
 * (`x-veilio-auth` header, see lib/serviceAuth.ts) from the buyer or seller.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const session = await verifyServiceSessionAuth(extractServiceAuth(req.headers));
    if (!session.valid || !session.address) {
      return NextResponse.json({ error: session.error || 'Authentication required' }, { status: session.status || 401 });
    }

    const order = getOrderById(id);
    // Same response for missing and foreign orders to avoid id enumeration.
    if (!order || (!sameWalletAddress(session.address, order.buyerId) && !sameWalletAddress(session.address, order.sellerId))) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        serviceId: order.serviceId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        priceSnapshot: order.priceSnapshot,
        currency: order.currency,
        status: order.status,
        paymentStatus: order.paymentStatus,
        deadline: order.deadline,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        escrowReference: order.escrowReference,
        network: getOrderNetwork(order),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    const body = await req.json().catch(() => null);
    const auth = body?.auth;
    const wallet = typeof auth?.address === 'string' ? auth.address : '';
    const isBuyer = sameWalletAddress(wallet, order.buyerId);
    const isSeller = sameWalletAddress(wallet, order.sellerId);
    // The platform reviewer of the order's network may read disputed orders to settle them.
    const network = getOrderNetwork(order);
    const hasDispute = Boolean(getDisputeByOrderId(id));
    let reviewer: string | null | undefined = process.env.REVIEWER_ADDRESS;
    if (network === 'solana:devnet') {
      reviewer = null;
      if (!isBuyer && !isSeller && hasDispute) {
        // On-chain EscrowConfig reviewer after the program upgrade; env reviewer before it.
        const platform = await resolveSolanaEscrowPlatformConfig({ envReviewer: getSolanaServiceReviewer() });
        reviewer = platform.ok ? platform.reviewer : null;
      }
    }
    const isReviewer = !isBuyer && !isSeller && hasDispute && Boolean(reviewer) && sameWalletAddress(wallet, reviewer);
    if (!isBuyer && !isSeller && !isReviewer) {
      return NextResponse.json({ error: 'Only the order buyer or seller may view this order.' }, { status: 403 });
    }

    const authResult = await verifyServiceAuth({
      action: 'read-order',
      orderId: id,
      expectedAddress: isBuyer ? order.buyerId : isSeller ? order.sellerId : wallet,
      auth,
    });
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication failed' },
        { status: authResult.status || 401 }
      );
    }

    const submissions = getOrderSubmissions(id);
    const revisions = getOrderRevisions(id);
    const dispute = getDisputeByOrderId(id);

    return NextResponse.json({
      success: true,
      order: { ...order, network },
      submissions,
      revisions,
      dispute,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
