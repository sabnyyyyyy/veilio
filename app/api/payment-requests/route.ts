import { NextRequest, NextResponse } from 'next/server';
import {
  createPaymentRequest,
  getConversationById,
  normalizeServiceNetwork,
  sameWalletAddress,
  SERVICE_NETWORK_CURRENCY,
  type ServiceNetworkId,
} from '@/lib/server/servicesDb';
import { getServiceEscrowAddress } from '@/lib/serviceContract';
import { getSolanaServiceEscrowProgramId } from '@/lib/cross-chain/solanaServiceEscrow';
import { isAddress } from 'viem';
import { decodeBase58 } from '@/lib/cross-chain/solanaServiceRegistry';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';

import { withJsonStores } from '@/lib/server/jsonStore';
function isValidMultiChainAddress(addr: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  if (isAddress(addr)) return true;
  try {
    return decodeBase58(addr).length === 32;
  } catch {
    return false;
  }
}

/**
 * Seller issues a payment request inside a conversation.
 *
 * Auth: per-request signed payload from the conversation's seller
 * (verifyServiceAuth action 'create-payment-request', orderId = conversationId, nonce
 * consumed). Buyer/seller are always taken from the stored conversation, never from the
 * body. The network is stored as a canonical id ('bnb:97' | 'base:84532' |
 * 'solana:devnet') and fixes the currency and the escrow contract/program.
 */
async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      conversationId,
      description,
      scope,
      agreedPrice,
      deadline,
      revisionTerms = 'Up to 2 rounds of revisions within scope',
      network: reqNetwork,
      currency: reqCurrency,
      auth,
    } = body;

    if (!conversationId || typeof conversationId !== 'string') {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    const conversation = getConversationById(conversationId);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Only the conversation's seller may issue a payment request, with a fresh signature.
    if (!auth?.address || !sameWalletAddress(auth.address, conversation.sellerId)) {
      return NextResponse.json({ error: 'Only the service seller can create a payment request' }, { status: 403 });
    }
    const authResult = await verifyServiceAuth({
      action: 'create-payment-request',
      orderId: conversationId,
      expectedAddress: conversation.sellerId,
      auth,
    });
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error || 'Authentication failed' },
        { status: authResult.status || 401 }
      );
    }

    // Body buyer/seller/service ids, if sent by older clients, must match the conversation.
    if ((body.buyerId && !sameWalletAddress(body.buyerId, conversation.buyerId)) ||
        (body.sellerId && !sameWalletAddress(body.sellerId, conversation.sellerId)) ||
        (body.serviceId && body.serviceId !== conversation.serviceId)) {
      return NextResponse.json({ error: 'Payment request parties do not match the conversation' }, { status: 400 });
    }

    const buyerId = conversation.buyerId;
    const sellerId = conversation.sellerId;
    if (!isValidMultiChainAddress(buyerId) || !isValidMultiChainAddress(sellerId)) {
      return NextResponse.json({ error: 'Valid buyer and seller addresses are required' }, { status: 400 });
    }
    if (sameWalletAddress(buyerId, sellerId)) {
      return NextResponse.json({ error: 'Buyer and seller cannot be the same address' }, { status: 400 });
    }

    const network: ServiceNetworkId | null = reqNetwork
      ? normalizeServiceNetwork(reqNetwork)
      : reqCurrency === 'ETH' ? 'base:84532' : reqCurrency === 'SOL' ? 'solana:devnet' : 'bnb:97';
    if (!network) {
      return NextResponse.json({ error: `Unsupported network: ${String(reqNetwork)}` }, { status: 400 });
    }
    const currency = SERVICE_NETWORK_CURRENCY[network];
    if (reqCurrency && String(reqCurrency).toUpperCase().trim() !== currency) {
      return NextResponse.json({ error: `Currency ${reqCurrency} does not match network ${network} (${currency})` }, { status: 400 });
    }

    // Escrow parties must be native accounts of the settlement chain.
    const isSolanaNetwork = network === 'solana:devnet';
    if (isSolanaNetwork ? (isAddress(buyerId) || isAddress(sellerId)) : (!isAddress(buyerId) || !isAddress(sellerId))) {
      return NextResponse.json(
        { error: isSolanaNetwork
          ? 'Solana Devnet payment requests require both parties to use Solana wallets in this conversation'
          : 'EVM payment requests require both parties to use EVM wallets in this conversation' },
        { status: 400 }
      );
    }

    if (!agreedPrice || isNaN(Number(agreedPrice)) || Number(agreedPrice) <= 0) {
      return NextResponse.json({ error: 'Valid agreedPrice is required' }, { status: 400 });
    }
    const priceStr = String(agreedPrice).trim();
    if (!/^\d+(\.\d+)?$/.test(priceStr) || (priceStr.split('.')[1] || '').length > (isSolanaNetwork ? 9 : 18)) {
      return NextResponse.json({ error: 'agreedPrice must be a plain decimal amount' }, { status: 400 });
    }

    if (!description || typeof description !== 'string' || !description.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    const now = Date.now();
    const deadlineTimestamp = deadline ? Number(deadline) : now + 7 * 24 * 3600 * 1000;
    if (!Number.isFinite(deadlineTimestamp) || deadlineTimestamp < now + 60 * 60 * 1000) {
      return NextResponse.json({ error: 'Deadline must be at least 1 hour in the future' }, { status: 400 });
    }

    const escrowContract = isSolanaNetwork
      ? getSolanaServiceEscrowProgramId()
      : getServiceEscrowAddress(network === 'base:84532' ? 84532 : 97);

    const pr = createPaymentRequest({
      conversationId,
      serviceId: conversation.serviceId,
      buyerId,
      sellerId,
      description: description.trim().slice(0, 2000),
      scope: String(scope || description).trim().slice(0, 4000),
      agreedPrice: priceStr,
      currency,
      deadline: deadlineTimestamp,
      revisionTerms: String(revisionTerms).trim().slice(0, 1000),
      escrowContract,
      network,
      // The request must be accepted (and funded) well before the delivery deadline,
      // otherwise the on-chain deposit would revert with "deadline in the past".
      expiresAt: Math.min(now + 14 * 24 * 3600 * 1000, deadlineTimestamp - 60 * 60 * 1000),
    });

    return NextResponse.json({ success: true, paymentRequest: pr });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withJsonStores(handlePOST);
