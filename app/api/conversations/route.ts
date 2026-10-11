import { NextRequest, NextResponse } from 'next/server';
import {
  getUserConversations,
  getOrCreateConversation,
  getServiceById,
} from '@/lib/server/servicesDb';
import { isAddress } from 'viem';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userAddress = searchParams.get('userAddress');

    if (!userAddress || !isAddress(userAddress)) {
      return NextResponse.json({ error: 'Valid userAddress parameter is required' }, { status: 400 });
    }

    const conversations = getUserConversations(userAddress);
    return NextResponse.json({ success: true, conversations });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { buyerAddress, sellerAddress, serviceId, serviceTitle } = body;

    if (!buyerAddress || !isAddress(buyerAddress)) {
      return NextResponse.json({ error: 'Valid buyerAddress is required' }, { status: 400 });
    }

    if (!sellerAddress || !isAddress(sellerAddress)) {
      return NextResponse.json({ error: 'Valid sellerAddress is required' }, { status: 400 });
    }

    if (!serviceId) {
      return NextResponse.json({ error: 'serviceId is required' }, { status: 400 });
    }

    const service = getServiceById(serviceId);
    const title = serviceTitle || service?.title || 'Custom Service Negotiation';

    const conv = getOrCreateConversation(buyerAddress, sellerAddress, serviceId, title);
    return NextResponse.json({ success: true, conversation: conv });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
