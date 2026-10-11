import { NextRequest, NextResponse } from 'next/server';
import {
  getConversationById,
  getConversationMessages,
  addServiceMessage,
} from '@/lib/server/servicesDb';
import { isAddress } from 'viem';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const conversation = getConversationById(id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messages = getConversationMessages(id);
    return NextResponse.json({ success: true, conversation, messages });
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
    const conversation = getConversationById(id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const body = await req.json();
    const { senderId, senderType = 'human', content, paymentRequestId } = body;

    if (!senderId || !isAddress(senderId)) {
      return NextResponse.json({ error: 'Valid sender EVM address required' }, { status: 400 });
    }

    const normalizedSender = senderId.toLowerCase();
    const isParticipant =
      normalizedSender === conversation.buyerId.toLowerCase() ||
      normalizedSender === conversation.sellerId.toLowerCase();

    if (!isParticipant) {
      return NextResponse.json(
        { error: 'Unauthorized: only conversation participants can send messages' },
        { status: 403 }
      );
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Message content cannot be empty' }, { status: 400 });
    }

    const sanitizedContent = content.trim().slice(0, 4000);

    const message = addServiceMessage({
      conversationId: id,
      senderId: normalizedSender,
      senderType: senderType === 'agent' ? 'agent' : 'human',
      content: sanitizedContent,
      paymentRequestId: paymentRequestId || undefined,
    });

    return NextResponse.json({ success: true, message });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
