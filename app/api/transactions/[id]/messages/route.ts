import { NextRequest, NextResponse } from 'next/server';
import {
  addTransactionMessage,
  getTransactionMessages,
  getOrCreateTransaction,
  type TransactionMessage,
} from '@/lib/server/transactionDb';
import { authorizeAuctionChat } from '@/lib/server/transactionChatAccess';
import { allowChatMessage, impersonatesSystemNotice, sanitizeChatText } from '@/lib/server/chatSafety';

import { withJsonStores } from '@/lib/server/jsonStore';
/**
 * Auction buyer/seller chat. Both handlers require a signed wallet session (`x-veilio-auth`
 * header, or `auth` in the POST body) from the auction's seller or winning bidder, as read
 * on-chain. The sender and its role are always derived server-side.
 */

/** Message types a participant may post; AI reports and alerts are written by the server only. */
const USER_MESSAGE_TYPES = ['text', 'evidence_submission'] as const;
const MAX_ATTACHMENTS = 10;

function parseTransactionId(id: string): string | null {
  return /^[1-9]\d{0,77}$/.test(id) ? id : null;
}

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const transactionId = parseTransactionId(String((await params).id));
    if (!transactionId) {
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    }

    const access = await authorizeAuctionChat(req.headers, transactionId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const messages = getTransactionMessages(transactionId);
    return NextResponse.json({ success: true, messages });
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
    const transactionId = parseTransactionId(String((await params).id));
    if (!transactionId) {
      return NextResponse.json({ error: 'Invalid transaction ID' }, { status: 400 });
    }

    const body = await req.json();
    const access = await authorizeAuctionChat(req.headers, transactionId, body);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { content, messageType = 'text', attachmentReferences } = body;
    if (!USER_MESSAGE_TYPES.includes(messageType)) {
      return NextResponse.json({ error: `messageType must be one of: ${USER_MESSAGE_TYPES.join(', ')}` }, { status: 400 });
    }

    const sanitizedContent = typeof content === 'string' ? sanitizeChatText(content) : '';
    if (!sanitizedContent) {
      return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
    }
    if (impersonatesSystemNotice(sanitizedContent)) {
      return NextResponse.json(
        { error: 'Messages cannot start with a bracketed [SYSTEM-STYLE] tag; those are reserved for verified VEILIO notices.' },
        { status: 400 }
      );
    }

    const rate = await allowChatMessage(`auction:${transactionId}`, access.address);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many messages. Please slow down.', retryAfter: rate.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    const attachments = Array.isArray(attachmentReferences)
      ? attachmentReferences
          .filter((ref: unknown): ref is string => typeof ref === 'string')
          .map((ref: string) => sanitizeChatText(ref, 500))
          .filter(Boolean)
          .slice(0, MAX_ATTACHMENTS)
      : [];

    // Keep the transaction record's parties in sync with the chain.
    getOrCreateTransaction(transactionId, {
      buyerAddress: access.parties.buyer,
      sellerAddress: access.parties.seller,
    });

    const now = Date.now();
    const newMsg: TransactionMessage = {
      id: `msg-${transactionId}-${now}-${Math.random().toString(36).substring(2, 7)}`,
      transactionId,
      senderType: access.role,
      senderAddress: access.address,
      messageType,
      content: sanitizedContent,
      attachmentReferences: attachments.length ? attachments : undefined,
      createdAt: now,
    };

    const saved = addTransactionMessage(newMsg);
    return NextResponse.json({ success: true, message: saved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
