import { NextRequest, NextResponse } from 'next/server';
import { getUserOrders } from '@/lib/server/servicesDb';
import { isAddress } from 'viem';
import { verifyServiceAuth, isSolanaAddress } from '@/lib/server/serviceAuth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const userAddress = body?.auth?.address;

    if (!userAddress || typeof userAddress !== 'string' || (!isAddress(userAddress) && !isSolanaAddress(userAddress))) {
      return NextResponse.json({ error: 'Signed wallet authorization is required' }, { status: 401 });
    }

    const authResult = await verifyServiceAuth({
      action: 'list-orders',
      // EVM addresses are lowercased in the signed scope; Solana keys are case-sensitive.
      orderId: isAddress(userAddress) ? userAddress.toLowerCase() : userAddress,
      expectedAddress: userAddress,
      auth: body.auth,
    });
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication failed' },
        { status: authResult.status || 401 }
      );
    }

    const { asBuyer, asSeller } = getUserOrders(userAddress);
    return NextResponse.json({ success: true, asBuyer, asSeller });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
