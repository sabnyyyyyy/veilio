import { NextRequest, NextResponse } from 'next/server';
import { getPaymentRequest, sameWalletAddress } from '@/lib/server/servicesDb';
import { extractServiceAuth, verifyServiceSessionAuth } from '@/lib/server/serviceAuth';

import { withJsonStores } from '@/lib/server/jsonStore';
/**
 * Payment request details for its buyer or seller. Requires a signed services session
 * (`x-veilio-auth` header, see lib/serviceAuth.ts).
 */
async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await verifyServiceSessionAuth(extractServiceAuth(req.headers));
    if (!session.valid || !session.address) {
      return NextResponse.json({ error: session.error || 'Authentication required' }, { status: session.status || 401 });
    }

    const pr = getPaymentRequest(id);
    if (!pr || (!sameWalletAddress(session.address, pr.buyerId) && !sameWalletAddress(session.address, pr.sellerId))) {
      return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, paymentRequest: pr });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withJsonStores(handleGET);
