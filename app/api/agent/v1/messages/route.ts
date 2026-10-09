import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import {
  addTransactionMessage,
  getTransactionMessages,
  getOrCreateTransaction,
  type TransactionMessage,
} from '@/lib/server/transactionDb';
import { validateTransactionContext } from '@/lib/server/aiValidator';

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const transactionId = searchParams.get('transactionId') || searchParams.get('auctionId');

    if (!transactionId || !/^[1-9]\d{0,77}$/.test(transactionId)) {
      return NextResponse.json({ error: 'Valid transactionId parameter required' }, { status: 400 });
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

export async function POST(req: NextRequest) {
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

    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Structured payload object required' }, { status: 400 });
    }

    const tx = getOrCreateTransaction(String(transactionId));

    // Content summary for human reading
    const contentSummary = `[AGENT ${messageType.toUpperCase()}] ${payload.summary || JSON.stringify(payload).slice(0, 200)}`;

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
        agentId: agentId || agentAddress,
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
    if (requestAiValidation || messageType === 'agreement_proposal') {
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
      notice: 'Advisory: Agent messages do not trigger smart contract transactions automatically.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
