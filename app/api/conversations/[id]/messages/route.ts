import { NextRequest, NextResponse } from 'next/server';
import {
  getConversationById,
  getConversationMessages,
  addServiceMessage,
  getPaymentRequest,
  getServiceById,
  sameWalletAddress,
  type Conversation,
} from '@/lib/server/servicesDb';
import { extractServiceAuth, verifyServiceSessionAuth } from '@/lib/server/serviceAuth';
import { allowChatMessage, impersonatesSystemNotice, sanitizeChatText } from '@/lib/server/chatSafety';

import { withJsonStores } from '@/lib/server/jsonStore';
/**
 * Both handlers require a signed services session (lib/serviceAuth.ts) from a
 * conversation participant: GET via the `x-veilio-auth` header, POST via `auth` in the
 * body (or the header). The sender of a posted message is the authenticated wallet.
 */

function isParticipant(conversation: Conversation, address: string): boolean {
  return sameWalletAddress(address, conversation.buyerId) || sameWalletAddress(address, conversation.sellerId);
}

async function handleGET(
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

async function handlePOST(
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

    const sanitizedContent = typeof content === 'string' ? sanitizeChatText(content) : '';
    if (!sanitizedContent) {
      return NextResponse.json({ error: 'Message content cannot be empty' }, { status: 400 });
    }
    if (impersonatesSystemNotice(sanitizedContent)) {
      return NextResponse.json(
        { error: 'Messages cannot start with a bracketed [SYSTEM-STYLE] tag; those are reserved for verified VEILIO notices.' },
        { status: 400 }
      );
    }

    const rate = await allowChatMessage(`conv:${id}`, session.address);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many messages. Please slow down.', retryAfter: rate.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    // Payment request cards can only be referenced for this conversation's own requests.
    if (paymentRequestId) {
      const pr = getPaymentRequest(String(paymentRequestId));
      if (!pr || pr.conversationId !== id) {
        return NextResponse.json({ error: 'paymentRequestId does not belong to this conversation' }, { status: 400 });
      }
    }

    // The "AI Agent" badge is only for the seller of a listing registered as an agent.
    const service = getServiceById(conversation.serviceId);
    const isAgentSeller =
      service?.sellerType === 'agent' && sameWalletAddress(session.address, conversation.sellerId);

    const message = addServiceMessage({
      conversationId: id,
      senderId: session.address,
      senderType: senderType === 'agent' && isAgentSeller ? 'agent' : 'human',
      content: sanitizedContent,
      paymentRequestId: paymentRequestId || undefined,
    });

    return NextResponse.json({ success: true, message });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
