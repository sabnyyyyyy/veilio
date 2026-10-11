import { NextRequest, NextResponse } from 'next/server';
import {
  createPaymentRequest,
  getConversationById,
} from '@/lib/server/servicesDb';
import { VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS } from '@/lib/serviceContract';
import { isAddress } from 'viem';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      conversationId,
      serviceId,
      buyerId,
      sellerId,
      description,
      scope,
      agreedPrice,
      currency = 'BNB',
      deadline,
      revisionTerms = 'Up to 2 rounds of revisions within scope',
    } = body;

    if (!conversationId || !serviceId) {
      return NextResponse.json({ error: 'conversationId and serviceId are required' }, { status: 400 });
    }

    if (!buyerId || !isAddress(buyerId) || !sellerId || !isAddress(sellerId)) {
      return NextResponse.json({ error: 'Valid buyer and seller addresses are required' }, { status: 400 });
    }

    if (buyerId.toLowerCase() === sellerId.toLowerCase()) {
      return NextResponse.json({ error: 'Buyer and seller cannot be the same address' }, { status: 400 });
    }

    if (!agreedPrice || isNaN(Number(agreedPrice)) || Number(agreedPrice) <= 0) {
      return NextResponse.json({ error: 'Valid agreedPrice is required' }, { status: 400 });
    }

    if (!description || typeof description !== 'string') {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    const conversation = getConversationById(conversationId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Verify seller is authorized
    if (conversation.sellerId.toLowerCase() !== sellerId.toLowerCase()) {
      return NextResponse.json({ error: 'Only the service seller can create a payment request' }, { status: 403 });
    }

    const deadlineTimestamp = deadline ? Number(deadline) : Date.now() + 7 * 24 * 3600 * 1000;

    const pr = createPaymentRequest({
      conversationId,
      serviceId,
      buyerId: buyerId.toLowerCase(),
      sellerId: sellerId.toLowerCase(),
      description: description.trim(),
      scope: (scope || description).trim(),
      agreedPrice: String(Number(agreedPrice)),
      currency: currency.toUpperCase(),
      deadline: deadlineTimestamp,
      revisionTerms: revisionTerms.trim(),
      escrowContract: VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS,
      network: 'BNB Smart Chain (Testnet/Mainnet)',
      expiresAt: Date.now() + 14 * 24 * 3600 * 1000,
    });

    return NextResponse.json({ success: true, paymentRequest: pr });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
