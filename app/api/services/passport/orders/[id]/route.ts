import { NextRequest, NextResponse } from 'next/server';
import { getOrderById, getDisputeByOrderId, getTrustPassportRecordByOrder, getOrderSubmissions } from '@/lib/server/servicesDb';
import { hashOrderEvidence, makeTrustPassportSnapshot, hashTrustPassportSnapshot } from '@/lib/server/trustPassport';
import { withJsonStores } from '@/lib/server/jsonStore';

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = getOrderById(id);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (order.status !== 'Completed' || order.paymentStatus !== 'Released' || !order.escrowTxHash) {
    return NextResponse.json({ error: 'Only completed, released orders can enter the Trust Passport' }, { status: 409 });
  }
  const dispute = getDisputeByOrderId(id);
  if (dispute && dispute.status !== 'resolved' && dispute.status !== 'cancelled') {
    return NextResponse.json({ error: 'An active dispute prevents passport approval' }, { status: 409 });
  }
  const submissions = getOrderSubmissions(id);
  if (!submissions.length) return NextResponse.json({ error: 'A completed order needs at least one submitted deliverable before passport approval' }, { status: 409 });
  const existing = getTrustPassportRecordByOrder(id);
  const snapshot = makeTrustPassportSnapshot(order, dispute, hashOrderEvidence(submissions), existing?.snapshot.recordedAt || Date.now());
  const proofHash = hashTrustPassportSnapshot(snapshot);
  if (existing && proofHash !== existing.proofHash) return NextResponse.json({ error: 'Order facts changed; approvals must be restarted' }, { status: 409 });
  return NextResponse.json({ success: true, snapshot, proofHash, approvals: {
    buyer: Boolean(existing?.buyerApproval), seller: Boolean(existing?.sellerApproval),
  } });
}

export const GET = withJsonStores(handleGET);
