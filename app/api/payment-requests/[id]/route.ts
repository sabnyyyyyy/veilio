import { NextRequest, NextResponse } from 'next/server';
import { getPaymentRequest } from '@/lib/server/servicesDb';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pr = getPaymentRequest(id);
    if (!pr) {
      return NextResponse.json({ error: 'Payment request not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, paymentRequest: pr });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
