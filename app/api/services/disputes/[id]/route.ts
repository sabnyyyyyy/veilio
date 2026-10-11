import { NextRequest, NextResponse } from 'next/server';
import {
  getDisputeById,
  getOrderById,
  getOrderSubmissions,
  getOrderRevisions,
} from '@/lib/server/servicesDb';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: disputeId } = await params;
    const dispute = getDisputeById(disputeId);
    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const order = getOrderById(dispute.orderId);
    const submissions = getOrderSubmissions(dispute.orderId);
    const revisions = getOrderRevisions(dispute.orderId);

    return NextResponse.json({
      success: true,
      dispute,
      order,
      submissions,
      revisions,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
