import { NextRequest, NextResponse } from 'next/server';
import { getOrdersBySeller, getTrustPassportRecords, getDisputeByOrderId, getOrderNetwork, getTrustPassportRecordByOrder, getOrderSubmissions, saveTrustPassportApproval } from '@/lib/server/servicesDb';
import { isSolanaAddress, verifyServiceAuth } from '@/lib/server/serviceAuth';
import { isAddress } from 'viem';
import { callGeminiStructured, isGeminiConfigured } from '@/lib/server/gemini';
import { withJsonStores } from '@/lib/server/jsonStore';
import { hashOrderEvidence, hashTrustPassportSnapshot, makeTrustPassportSnapshot } from '@/lib/server/trustPassport';

function normalize(value: string) { return value.startsWith('0x') ? value.toLowerCase() : value; }

async function handleGET(_req: NextRequest, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!isAddress(wallet) && !isSolanaAddress(wallet)) return NextResponse.json({ error: 'Invalid vendor wallet address' }, { status: 400 });
  const orders = getOrdersBySeller(wallet);
  const records = getTrustPassportRecords(wallet);
  const summaries = records.map(({ snapshot, proofHash, buyerApproval, sellerApproval, anchor }) => ({
    ...snapshot,
    proofHash,
    approvals: { buyer: buyerApproval, seller: sellerApproval },
    anchor: anchor || null,
    verifiedOnChain: Boolean(anchor),
  }));
  const stats = {
    verifiedCompletedOrders: summaries.filter((item) => item.verifiedOnChain).length,
    mutuallyApprovedOrders: summaries.length,
    networks: [...new Set(summaries.map((item) => item.network))],
    disputeFreeOrders: summaries.filter((item) => item.dispute === 'none').length,
    ordersWithResolvedDisputes: summaries.filter((item) => item.dispute === 'resolved').length,
    pendingMutualApproval: orders.filter((order) => order.status === 'Completed' && order.paymentStatus === 'Released' && !records.some((item) => item.orderId === order.id)).length,
  };
  let aiSummary: { text: string; model: string } | null = null;
  if (new URL(_req.url).searchParams.get('summary') === 'true' && isGeminiConfigured()) {
    const generated = await callGeminiStructured<{ summary: string }>(
      'Summarize only the supplied vendor outcome counts in one neutral sentence. Do not infer quality, honesty, or future performance. Do not make up facts.',
      JSON.stringify(stats),
      { type: 'OBJECT', properties: { summary: { type: 'STRING' } }, required: ['summary'] },
      { maxRetries: 0, timeoutMs: 8000 },
    );
    if (generated?.data?.summary) aiSummary = { text: generated.data.summary, model: generated.model };
  }
  return NextResponse.json({ success: true, wallet, stats, records: summaries, aiSummary, aiSummaryAvailable: isGeminiConfigured() });
}

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  const body = await req.json().catch(() => ({}));
  const { orderId, auth } = body;
  if (!orderId || typeof orderId !== 'string' || !auth?.address || !auth?.signature) {
    return NextResponse.json({ error: 'orderId and a wallet signature are required' }, { status: 400 });
  }
  if (!isAddress(wallet) && !isSolanaAddress(wallet)) return NextResponse.json({ error: 'Invalid vendor wallet address' }, { status: 400 });
  const orders = getOrdersBySeller(wallet);
  const order = orders.find((item) => item.id === orderId);
  if (!order) return NextResponse.json({ error: 'Vendor order not found' }, { status: 404 });
  if (order.status !== 'Completed' || order.paymentStatus !== 'Released' || !order.escrowTxHash) {
    return NextResponse.json({ error: 'Only completed orders with released escrow and a verified settlement transaction can be added' }, { status: 409 });
  }
  const dispute = getDisputeByOrderId(order.id);
  if (dispute && dispute.status !== 'resolved' && dispute.status !== 'cancelled') {
    return NextResponse.json({ error: 'An active dispute prevents passport approval' }, { status: 409 });
  }
  const submissions = getOrderSubmissions(order.id);
  if (!submissions.length) return NextResponse.json({ error: 'A completed order needs at least one submitted deliverable before passport approval' }, { status: 409 });
  const prior = getTrustPassportRecordByOrder(order.id);
  const snapshot = makeTrustPassportSnapshot(order, dispute, hashOrderEvidence(submissions), prior?.snapshot.recordedAt || Date.now());
  const proofHash = hashTrustPassportSnapshot(snapshot);
  if (prior && proofHash !== prior.proofHash) {
    return NextResponse.json({ error: 'Order or dispute facts changed after the first approval. This passport record must be reviewed again.' }, { status: 409 });
  }
  const role = normalize(auth.address) === normalize(order.buyerId) ? 'buyer' : normalize(auth.address) === normalize(order.sellerId) ? 'seller' : null;
  if (!role) return NextResponse.json({ error: 'Only the order buyer or seller can approve this record' }, { status: 403 });
  const verified = await verifyServiceAuth({
    action: 'trust-passport-approve', orderId: `${order.id}:${proofHash}`,
    expectedAddress: role === 'buyer' ? order.buyerId : order.sellerId, auth,
  });
  if (!verified.valid) return NextResponse.json({ error: verified.error || 'Wallet signature is invalid' }, { status: verified.status || 401 });
  const record = saveTrustPassportApproval({ orderId: order.id, proofHash, snapshot }, role, {
    address: auth.address, signature: auth.signature, signedAt: Number(auth.timestamp) || Date.now(), nonce: String(auth.nonce || ''),
  });
  return NextResponse.json({ success: true, record, mutuallyApproved: Boolean(record.buyerApproval && record.sellerApproval) });
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
