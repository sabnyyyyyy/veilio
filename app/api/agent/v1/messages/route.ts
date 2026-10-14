import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import {
  addTransactionMessage,
  getTransactionMessages,
  getOrCreateTransaction,
  type TransactionMessage,
} from '@/lib/server/transactionDb';
import { validateTransactionContext } from '@/lib/server/aiValidator';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';
import { allowValidationRequest } from '@/lib/server/validationRateLimit';
import { authorizeAuctionChat, getAuctionChatParties } from '@/lib/server/transactionChatAccess';
import { allowChatMessage, sanitizeChatText } from '@/lib/server/chatSafety';

import { withJsonStores } from '@/lib/server/jsonStore';
/**
 * Structured agent messages for an auction transaction.
 * GET: signed wallet session (`x-veilio-auth`) from the auction's seller or winning bidder.
 * POST: a one-time signature by `agentAddress` (services auth, action 'agent-message',
 * orderId = transactionId), and the agent wallet must be the seller or winning bidder on-chain.
 */
const MAX_PAYLOAD_BYTES = 8 * 1024;

export const ALLOWED_STRUCTURED_MESSAGE_TYPES = [
  'asset_inquiry',
  'license_question',
  'delivery_request',
  'delivery_confirmation',
  'agreement_proposal',
  'agreement_confirmation',
  'dispute_notification',
  'evidence_request',
  'resolution_proposal',
] as const;

export type StructuredMessageType = (typeof ALLOWED_STRUCTURED_MESSAGE_TYPES)[number];

async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const transactionId = searchParams.get('transactionId') || searchParams.get('auctionId');

    if (!transactionId || !/^[1-9]\d{0,77}$/.test(transactionId)) {
      return NextResponse.json({ error: 'Valid transactionId parameter required' }, { status: 400 });
    }

    const access = await authorizeAuctionChat(req.headers, transactionId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const messages = getTransactionMessages(transactionId);
    const agentMessages = messages.filter((m) => m.messageType === 'agent_structured');

    return NextResponse.json({
      success: true,
      transactionId,
      messages: agentMessages,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      version = '1.0',
      transactionId,
      agentId,
      agentAddress,
      recipientAddress,
      communicationMode = 'agent_to_agent', // human_to_agent | agent_to_human | agent_to_agent
      messageType,
      payload,
      requestAiValidation = false,
      auth,
    } = body;

    if (!transactionId || !/^[1-9]\d{0,77}$/.test(String(transactionId))) {
      return NextResponse.json({ error: 'Valid transactionId required' }, { status: 400 });
    }

    if (!agentAddress || !isAddress(String(agentAddress))) {
      return NextResponse.json({ error: 'Valid agentAddress is required' }, { status: 400 });
    }

    if (!ALLOWED_STRUCTURED_MESSAGE_TYPES.includes(messageType as StructuredMessageType)) {
      return NextResponse.json(
        {
          error: `Invalid messageType. Allowed types: ${ALLOWED_STRUCTURED_MESSAGE_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: 'Structured payload object required' }, { status: 400 });
    }
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: `payload exceeds ${MAX_PAYLOAD_BYTES} bytes` }, { status: 413 });
    }

    // The agent proves control of agentAddress with a one-time signature...
    const authResult = await verifyServiceAuth({
      action: 'agent-message',
      orderId: String(transactionId),
      expectedAddress: String(agentAddress),
      auth,
    });
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error || 'Agent signature required' }, { status: authResult.status || 401 });
    }

    // ...and that wallet must be a party of the auction on-chain.
    let parties;
    try {
      parties = await getAuctionChatParties(String(transactionId));
    } catch {
      return NextResponse.json({ error: 'Could not verify auction participants on-chain. Please retry.' }, { status: 503 });
    }
    const agent = String(agentAddress).toLowerCase();
    if (!parties || (agent !== parties.seller && (!parties.buyer || agent !== parties.buyer))) {
      return NextResponse.json({ error: 'agentAddress is not the seller or winning bidder of this auction' }, { status: 403 });
    }

    const rate = await allowChatMessage(`agent:${transactionId}`, agent);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many messages. Please slow down.', retryAfter: rate.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    const tx = getOrCreateTransaction(String(transactionId), { buyerAddress: parties.buyer, sellerAddress: parties.seller });

    // Content summary for human reading
    const summary = typeof payload.summary === 'string' ? payload.summary : JSON.stringify(payload);
    const contentSummary = `[AGENT ${messageType.toUpperCase()}] ${sanitizeChatText(summary, 200)}`;

    const now = Date.now();
    const newMsg: TransactionMessage = {
      id: `agent-msg-${transactionId}-${now}-${Math.random().toString(36).substring(2, 7)}`,
      transactionId: String(transactionId),
      senderType: 'agent',
      senderAddress: agentAddress.toLowerCase(),
      messageType: 'agent_structured',
      content: contentSummary,
      structuredPayload: {
        version,
        agentId: sanitizeChatText(String(agentId || agentAddress), 100),
        recipientAddress: recipientAddress ? String(recipientAddress).toLowerCase() : undefined,
        communicationMode,
        type: messageType,
        payload,
      },
      createdAt: now,
    };

    const saved = addTransactionMessage(newMsg);

    // If agreement proposal, run AI validator consistency analysis
    let aiValidationResult = null;
    let aiValidationSkipped: string | undefined;
    if (requestAiValidation || messageType === 'agreement_proposal') {
      let aiAllowed = false;
      try {
        aiAllowed = (await allowValidationRequest(`agent-ai:${transactionId}:${agent}`, 60_000, 3)).allowed;
      } catch {
        aiAllowed = false;
      }
      if (!aiAllowed) aiValidationSkipped = 'AI validation rate limit reached; message saved without validation.';
    }
    if (!aiValidationSkipped && (requestAiValidation || messageType === 'agreement_proposal')) {
      aiValidationResult = await validateTransactionContext({
        transactionId: String(transactionId),
        auctionId: String(transactionId),
        buyerAddress: tx.buyerAddress,
        sellerAddress: tx.sellerAddress,
        listing: {
          auctionId: String(transactionId),
          itemName: `Auction #${transactionId}`,
          description: 'Autonomous agent proposal review',
        },
        chatMessages: [
          {
            senderType: 'agent',
            senderAddress: agentAddress,
            content: contentSummary,
            timestamp: now,
          },
        ],
      });
    }

    return NextResponse.json({
      success: true,
      message: saved,
      aiValidation: aiValidationResult,
      ...(aiValidationSkipped ? { aiValidationSkipped } : {}),
      notice: 'Advisory: Agent messages do not trigger smart contract transactions automatically.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
