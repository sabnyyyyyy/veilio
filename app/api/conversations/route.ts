import { NextRequest, NextResponse } from 'next/server';
import {
  getUserConversations,
  getOrCreateConversation,
  getServiceById,
  sameWalletAddress,
} from '@/lib/server/servicesDb';
import { isAddress } from 'viem';
import { extractServiceAuth, isSolanaAddress, verifyServiceSessionAuth } from '@/lib/server/serviceAuth';

import { withJsonStores } from '@/lib/server/jsonStore';
/**
 * Both handlers require a signed services session (lib/serviceAuth.ts):
 *   GET  -> `x-veilio-auth` header; lists only the authenticated wallet's conversations.
 *   POST -> `auth` body field (or header); the authenticated wallet becomes the buyer.
 */

function isWallet(addr: unknown): addr is string {
  return typeof addr === 'string' && (isAddress(addr) || isSolanaAddress(addr));
}

async function handleGET(req: NextRequest) {
  try {
    const session = await verifyServiceSessionAuth(extractServiceAuth(req.headers));
    if (!session.valid || !session.address) {
      return NextResponse.json({ error: session.error || 'Authentication required' }, { status: session.status || 401 });
    }

    // Legacy query param is still accepted but must name the authenticated wallet.
    const { searchParams } = new URL(req.url);
    const userAddress = searchParams.get('userAddress');
    if (userAddress && !sameWalletAddress(userAddress, session.address)) {
      return NextResponse.json({ error: 'userAddress does not match the authenticated wallet' }, { status: 403 });
    }

    const conversations = getUserConversations(session.address);
    return NextResponse.json({ success: true, conversations });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const { buyerAddress, serviceId, serviceTitle } = body;

    const session = await verifyServiceSessionAuth(extractServiceAuth(req.headers, body));
    if (!session.valid || !session.address) {
      return NextResponse.json({ error: session.error || 'Authentication required' }, { status: session.status || 401 });
    }

    if (buyerAddress && !sameWalletAddress(buyerAddress, session.address)) {
      return NextResponse.json({ error: 'buyerAddress does not match the authenticated wallet' }, { status: 403 });
    }

    if (!serviceId || typeof serviceId !== 'string') {
      return NextResponse.json({ error: 'serviceId is required' }, { status: 400 });
    }

    // The seller is always the listing owner; it is never taken from the request.
    const service = getServiceById(serviceId);
    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }
    if (!isWallet(service.sellerId)) {
      return NextResponse.json({ error: 'Service seller address is invalid' }, { status: 400 });
    }
    if (sameWalletAddress(service.sellerId, session.address)) {
      return NextResponse.json({ error: 'You cannot start a conversation with yourself as the seller' }, { status: 400 });
    }

    const title = service.title || (typeof serviceTitle === 'string' && serviceTitle) || 'Custom Service Negotiation';
    const conv = getOrCreateConversation(session.address, service.sellerId, serviceId, title);
    return NextResponse.json({ success: true, conversation: conv });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
