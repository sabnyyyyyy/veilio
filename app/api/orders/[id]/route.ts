import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderById,
  getOrderSubmissions,
  getOrderRevisions,
} from '@/lib/server/servicesDb';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const submissions = getOrderSubmissions(id);
    const revisions = getOrderRevisions(id);

    return NextResponse.json({
      success: true,
      order,
      submissions,
      revisions,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
