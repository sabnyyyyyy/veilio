import { readAgentAuction } from '@/lib/agent-sdk/server';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || BigInt(id) < 1n) {
    return Response.json({ error: 'id must be a positive integer.' }, { status: 400 });
  }

  try {
    const auction = await readAgentAuction(BigInt(id));
    if (!auction) return Response.json({ error: 'Auction not found.' }, { status: 404 });
    return Response.json({ data: auction, chainId: 97 }, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } });
  } catch (error) {
    console.error(`[Agent API] Failed to read auction ${id}:`, error);
    return Response.json({ error: 'Unable to read auction from BNB Chain.' }, { status: 502 });
  }
}
