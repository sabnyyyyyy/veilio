import { NextRequest, NextResponse } from 'next/server';
import {
  getConversationById,
  getConversationMessages,
  addServiceMessage,
  getPaymentRequest,
  sameWalletAddress,
  type Conversation,
} from '@/lib/server/servicesDb';
import { extractServiceAuth, verifyServiceSessionAuth } from '@/lib/server/serviceAuth';

/**
 * Both handlers require a signed services session (lib/serviceAuth.ts) from a
 * conversation participant: GET via the `x-veilio-auth` header, POST via `auth` in the
 * body (or the header). The sender of a posted message is the authenticated wallet.
 */

function isParticipant(conversation: Conversation, address: string): boolean {
  return sameWalletAddress(address, conversation.buyerId) || sameWalletAddress(address, conversation.sellerId);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await verifyServiceSessionAuth(extractServiceAuth(req.headers));
    if (!session.valid || !session.address) {
      return NextResponse.json({ error: session.error || 'Authentication required' }, { status: session.status || 401 });
    }

    const conversation = getConversationById(id);
    // Same response for missing and foreign conversations to avoid id enumeration.
    if (!conversation || !isParticipant(conversation, session.address)) {
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
    const body = await req.json();
    const { senderId, senderType = 'human', content, paymentRequestId } = body;

    const session = await verifyServiceSessionAuth(extractServiceAuth(req.headers, body));
    if (!session.valid || !session.address) {
      return NextResponse.json({ error: session.error || 'Authentication required' }, { status: session.status || 401 });
    }

    const conversation = getConversationById(id);
    if (!conversation || !isParticipant(conversation, session.address)) {
      return NextResponse.json(
        { error: 'Unauthorized: only conversation participants can send messages' },
        { status: 403 }
      );
    }

    if (senderId && !sameWalletAddress(senderId, session.address)) {
      return NextResponse.json({ error: 'senderId does not match the authenticated wallet' }, { status: 403 });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Message content cannot be empty' }, { status: 400 });
    }

    // Payment request cards can only be referenced for this conversation's own requests.
    if (paymentRequestId) {
      const pr = getPaymentRequest(String(paymentRequestId));
      if (!pr || pr.conversationId !== id) {
        return NextResponse.json({ error: 'paymentRequestId does not belong to this conversation' }, { status: 400 });
      }
    }

    const sanitizedContent = content.trim().slice(0, 4000);

    const message = addServiceMessage({
      conversationId: id,
      senderId: session.address,
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
