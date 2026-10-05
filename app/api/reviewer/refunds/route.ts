import { NextRequest, NextResponse } from 'next/server';
import { saveRefundEvidence, getAllRefundEvidence } from '@/lib/server/refundDb';
import crypto from 'crypto';

export async function GET() {
  try {
    const evidenceList = getAllRefundEvidence();
    return NextResponse.json({ success: true, refunds: evidenceList });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { auctionId, buyer, disputedCriterion, expectedValue, actualValue, reason } = body;

    if (!auctionId || !buyer || !disputedCriterion || !expectedValue || !actualValue || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Generate evidence hash (mocking an IPFS upload or off-chain immutable storage hash)
    const evidenceStr = JSON.stringify({ auctionId, buyer, disputedCriterion, expectedValue, actualValue, reason });
    const evidenceHash = `0x${crypto.createHash('sha256').update(evidenceStr).digest('hex')}`;

    const evidenceRecord = {
      auctionId: auctionId.toString(),
      buyer,
      disputedCriterion,
      expectedValue,
      actualValue,
      reason,
      evidenceHash,
      timestamp: Date.now(),
    };

    saveRefundEvidence(evidenceRecord);

    return NextResponse.json({ success: true, evidenceHash });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
