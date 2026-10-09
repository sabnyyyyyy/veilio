import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { respondToDispute, getOrCreateTransaction } from '@/lib/server/transactionDb';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auctionId = String(id);

    if (!/^[1-9]\d{0,77}$/.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    const body = await req.json();
    const { sellerAddress, statement, evidenceReferences } = body;

    if (!sellerAddress || !isAddress(String(sellerAddress))) {
      return NextResponse.json({ error: 'Valid sellerAddress is required' }, { status: 400 });
    }

    if (!statement || typeof statement !== 'string' || statement.trim().length === 0) {
      return NextResponse.json({ error: 'Statement is required' }, { status: 400 });
    }

    const tx = getOrCreateTransaction(auctionId);
    if (tx.sellerAddress && sellerAddress.toLowerCase() !== tx.sellerAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Unauthorized: Only the seller of this auction can submit a response' },
        { status: 403 }
      );
    }

    const updatedDispute = respondToDispute(auctionId, {
      statement: statement.trim().slice(0, 4000),
      evidenceReferences: Array.isArray(evidenceReferences) ? evidenceReferences : [],
    });

    if (!updatedDispute) {
      return NextResponse.json({ error: 'No dispute found for this auction' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      dispute: updatedDispute,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
