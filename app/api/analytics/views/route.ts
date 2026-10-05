import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_ABI, VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';
import { getAuctionViewStats, recordAuctionView } from '@/lib/server/analyticsDb';

export async function GET(req: NextRequest) {
  const auctionId = req.nextUrl.searchParams.get('auctionId');
  if (!auctionId || !/^\d+$/.test(auctionId)) return NextResponse.json({ error: 'Invalid auctionId' }, { status: 400 });
  return NextResponse.json({ success: true, stats: getAuctionViewStats(auctionId) });
}

export async function POST(req: NextRequest) {
  try {
    const { auctionId, visitorId } = await req.json();
    if (!auctionId || !/^\d+$/.test(String(auctionId)) || typeof visitorId !== 'string' || visitorId.length < 16 || visitorId.length > 128) {
      return NextResponse.json({ error: 'Invalid view event' }, { status: 400 });
    }
    const client = createPublicClient({ chain: bnbChain, transport: http() });
    const raw = await client.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'auctions', args: [BigInt(auctionId)] }) as readonly unknown[];
    if (!raw[0] || raw[0] === BigInt(0)) return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    const stats = recordAuctionView(String(auctionId), visitorId);
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error('[Analytics] Failed to record listing view:', error);
    return NextResponse.json({ error: 'Could not record view' }, { status: 500 });
  }
}
