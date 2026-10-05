import { agentPublicClient, readAgentAuction, agentAuctionAbi } from '@/lib/agent-sdk/server';
import { VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get('limit') ?? 20);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
    const count = await agentPublicClient.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: agentAuctionAbi, functionName: 'auctionCount' });
    const rawCursor = url.searchParams.get('cursor');
    const cursor = rawCursor === null ? count : (/^\d+$/.test(rawCursor) ? BigInt(rawCursor) : -1n);
    if (cursor < 0n) return Response.json({ error: 'cursor must be a non-negative integer.' }, { status: 400 });

    const ids: bigint[] = [];
    for (let id = cursor > count ? count : cursor; id > 0n && ids.length < limit; id--) ids.push(id);
    const results = await Promise.all(ids.map((id) => readAgentAuction(id)));
    const auctions = results.filter((auction) => auction !== null);
    const lastId = ids.at(-1);
    const nextCursor = lastId !== undefined && lastId > 1n && ids.length === limit ? (lastId - 1n).toString() : null;

    return Response.json({
      data: auctions,
      pagination: { limit, nextCursor, total: count.toString() },
      chainId: 97,
      contractAddress: VEIL_V3_CONTRACT_ADDRESS,
    }, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } });
  } catch (error) {
    console.error('[Agent API] Failed to list auctions:', error);
    return Response.json({ error: 'Unable to read auctions from BNB Chain.' }, { status: 502 });
  }
}
