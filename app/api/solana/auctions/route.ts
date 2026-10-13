import { NextRequest, NextResponse } from 'next/server';
import {
  fetchSolanaOnchainAuctionById,
  querySolanaOnchainAuctionsDirectly,
} from '@/lib/solanaAuctions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const auctionId = searchParams.get('id');

    if (auctionId) {
      try {
        const auction = await fetchSolanaOnchainAuctionById(auctionId);
        if (!auction) {
          return NextResponse.json(
            {
              success: false,
              error: `Auction #${auctionId} not found on Solana Devnet.`,
              auction: null,
            },
            { status: 404, headers: NO_CACHE_HEADERS }
          );
        }
        return NextResponse.json(
          {
            success: true,
            auction,
          },
          { headers: NO_CACHE_HEADERS }
        );
      } catch (err: any) {
        return NextResponse.json(
          {
            success: false,
            error: err?.message || 'Failed to fetch Solana auction details.',
            auction: null,
          },
          { status: 502, headers: NO_CACHE_HEADERS }
        );
      }
    }

    // List all auctions
    const auctions = await querySolanaOnchainAuctionsDirectly();
    return NextResponse.json(
      {
        success: true,
        auctions,
        total: String(auctions.length),
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    console.error('Solana auctions API error:', err);
    return NextResponse.json(
      {
        success: false,
        error:
          err?.message ||
          'Failed to connect to Solana Devnet RPC. Check network connectivity.',
        auctions: [],
        total: '0',
      },
      { status: 503, headers: NO_CACHE_HEADERS }
    );
  }
}
