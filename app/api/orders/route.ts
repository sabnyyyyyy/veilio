import { NextRequest, NextResponse } from 'next/server';
import { getUserOrders } from '@/lib/server/servicesDb';
import { isAddress } from 'viem';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userAddress = searchParams.get('userAddress');

    if (!userAddress || !isAddress(userAddress)) {
      return NextResponse.json({ error: 'Valid userAddress parameter is required' }, { status: 400 });
    }

    const { asBuyer, asSeller } = getUserOrders(userAddress);
    return NextResponse.json({ success: true, asBuyer, asSeller });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
