import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import {
  addTransactionMessage,
  getTransactionMessages,
  getOrCreateTransaction,
  type TransactionMessage,
} from '@/lib/server/transactionDb';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const transactionId = String(id);

    if (!/^[1-9]\d{0,77}$/.test(transactionId)) {
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    }

    const messages = getTransactionMessages(transactionId);
    return NextResponse.json({ success: true, messages });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const transactionId = String(id);

    if (!/^[1-9]\d{0,77}$/.test(transactionId)) {
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    }

    const body = await req.json();
    const {
      senderAddress,
      senderType,
      content,
      messageType = 'text',
      attachmentReferences,
      structuredPayload,
    } = body;

    if (!senderAddress || !isAddress(String(senderAddress))) {
      return NextResponse.json({ error: 'Valid senderAddress is required' }, { status: 400 });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
    }

    // Sanitize message content: length cap and trim
    const sanitizedContent = content.trim().slice(0, 4000);

    const transaction = getOrCreateTransaction(transactionId);

    // Verify sender is participant (buyer, seller, or authorized reviewer)
    const normalizedSender = senderAddress.toLowerCase();
    const normalizedBuyer = transaction.buyerAddress.toLowerCase();
    const normalizedSeller = transaction.sellerAddress.toLowerCase();

    const isParticipant =
      normalizedSender === normalizedBuyer ||
      normalizedSender === normalizedSeller ||
      senderType === 'ai_validator' ||
      senderType === 'agent';

    if (!isParticipant) {
      return NextResponse.json(
        { error: 'Unauthorized: Only buyer, seller, or authorized agent can post in this transaction' },
        { status: 403 }
      );
    }

    const now = Date.now();
    const newMsg: TransactionMessage = {
      id: `msg-${transactionId}-${now}-${Math.random().toString(36).substring(2, 7)}`,
      transactionId,
      senderType: senderType || (normalizedSender === normalizedBuyer ? 'buyer' : 'seller'),
      senderAddress: normalizedSender,
      messageType,
      content: sanitizedContent,
      attachmentReferences: Array.isArray(attachmentReferences) ? attachmentReferences : undefined,
      structuredPayload: typeof structuredPayload === 'object' ? structuredPayload : undefined,
      createdAt: now,
    };

    const saved = addTransactionMessage(newMsg);

    return NextResponse.json({ success: true, message: saved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
