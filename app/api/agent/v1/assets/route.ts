import { agentPublicClient, readAgentAuction, agentAuctionAbi } from '@/lib/agent-sdk/server';
import { VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';
import { resolveIpfsUri } from '@/lib/ipfs';
import { MOCK_AUCTIONS } from '@/lib/mockAuctions';
import { computeParticipantReputation } from '@/lib/reputation';
import { formatEther } from 'viem';

export const runtime = 'nodejs';

interface AgentAssetItem {
  id: string;
  title: string;
  description: string;
  category: string;
  license: {
    type: string;
    usage_rights: string;
  };
  format?: string;
  file_size?: string;
  region?: string;
  language?: string;
  data_period?: string;
  update_frequency?: string;
  agent_compatible: boolean;
  seller: {
    address: string;
    delivery_rate_percent: number | null;
    verified: boolean;
    status_label: string;
  };
  auction: {
    auction_id: string;
    state: string;
    starting_price_bnb: string;
    bidder_count: number;
    commit_end_time: number;
    reveal_end_time: number;
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get('limit') ?? 20);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
    const categoryFilter = url.searchParams.get('category')?.toLowerCase();
    const licenseFilter = url.searchParams.get('license')?.toLowerCase();
    const query = url.searchParams.get('query')?.toLowerCase();

    const count = await agentPublicClient
      .readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: agentAuctionAbi, functionName: 'auctionCount' })
      .catch(() => 0n);

    const rawCursor = url.searchParams.get('cursor');
    const cursor = rawCursor === null ? count : (/^\d+$/.test(rawCursor) ? BigInt(rawCursor) : -1n);
    if (cursor < 0n) return Response.json({ error: 'cursor must be a non-negative integer.' }, { status: 400 });

    const ids: bigint[] = [];
    for (let id = cursor > count ? count : cursor; id > 0n && ids.length < limit; id--) ids.push(id);

    // Read onchain auctions and parse IPFS metadata
    const onchainResults = await Promise.all(ids.map((id) => readAgentAuction(id)));
    const validAuctions = onchainResults.filter((a) => a !== null);

    let assets: AgentAssetItem[] = await Promise.all(
      validAuctions.map(async (item) => {
        let meta: Record<string, any> = {};
        if (item.metadataURI) {
          try {
            const resolved = resolveIpfsUri(item.metadataURI) || item.metadataURI;
            const res = await fetch(resolved, { signal: AbortSignal.timeout(4000) });
            if (res.ok) meta = await res.json();
          } catch {
            // Non-blocking
          }
        }

        const assetDetails = meta.asset || {};
        const rep = computeParticipantReputation(item.seller, { role: 'seller' });

        return {
          id: item.id,
          title: item.itemName,
          description: item.description,
          category: assetDetails.category || assetDetails.assetType || 'dataset',
          license: {
            type: assetDetails.licenseType || 'commercial_use',
            usage_rights: assetDetails.usageRights || 'Standard digital asset usage rights',
          },
          format: assetDetails.format || (meta.dataset?.manifest?.format) || 'Parquet',
          file_size: assetDetails.fileSize || (meta.dataset?.size ? `${(meta.dataset.size / (1024 * 1024)).toFixed(2)} MB` : undefined),
          region: assetDetails.region || 'Global',
          language: assetDetails.language || 'English',
          data_period: assetDetails.dataPeriod || '2024 - 2026',
          update_frequency: assetDetails.updateFrequency || 'one_time',
          agent_compatible: assetDetails.agentCompatible ?? true,
          seller: {
            address: item.seller,
            delivery_rate_percent: rep.deliverySuccessRate,
            verified: rep.verifiedStatus,
            status_label: rep.statusLabel,
          },
          auction: {
            auction_id: item.id,
            state: item.state,
            starting_price_bnb: formatEther(BigInt(item.startingPriceWei)),
            bidder_count: Number(item.bidderCount),
            commit_end_time: Number(item.commitEndTime),
            reveal_end_time: Number(item.revealEndTime),
          },
        };
      })
    );

    // Fallback to rich mock catalog if on-chain has no auctions
    if (assets.length === 0) {
      assets = MOCK_AUCTIONS.map((m) => {
        const rep = computeParticipantReputation(m.seller, { role: 'seller' });
        return {
          id: m.id,
          title: m.itemName,
          description: m.description,
          category: m.metadata?.category || m.assetType || 'dataset',
          license: {
            type: m.metadata?.licenseType || 'commercial_use',
            usage_rights: m.metadata?.usageRights || 'Commercial use permitted',
          },
          format: m.metadata?.format || 'Parquet',
          file_size: m.metadata?.fileSize || '2.4 GB',
          region: m.metadata?.region || 'Global',
          language: m.metadata?.language || 'English',
          data_period: m.metadata?.dataPeriod || '2024 - 2026',
          update_frequency: m.metadata?.updateFrequency || 'one_time',
          agent_compatible: m.metadata?.agentCompatible ?? true,
          seller: {
            address: m.seller,
            delivery_rate_percent: rep.deliverySuccessRate,
            verified: rep.verifiedStatus,
            status_label: rep.statusLabel,
          },
          auction: {
            auction_id: m.id,
            state: m.status,
            starting_price_bnb: m.startingPrice,
            bidder_count: m.bidderCount,
            commit_end_time: Math.floor(m.commitEndTime / 1000),
            reveal_end_time: Math.floor(m.revealEndTime / 1000),
          },
        };
      });
    }

    // Apply query and category filters
    const filtered = assets.filter((asset) => {
      const matchCat = !categoryFilter || categoryFilter === 'all' || asset.category.toLowerCase() === categoryFilter;
      const matchLic = !licenseFilter || licenseFilter === 'all' || asset.license.type.toLowerCase() === licenseFilter;
      const matchQ = !query || asset.title.toLowerCase().includes(query) || asset.description.toLowerCase().includes(query);
      return matchCat && matchLic && matchQ;
    });

    const lastId = ids.at(-1);
    const nextCursor = lastId !== undefined && lastId > 1n && ids.length === limit ? (lastId - 1n).toString() : null;

    return Response.json(
      {
        data: filtered,
        pagination: {
          limit,
          nextCursor,
          total: (count > 0n ? count : BigInt(MOCK_AUCTIONS.length)).toString(),
        },
        chainId: 97,
        contractAddress: VEIL_V3_CONTRACT_ADDRESS,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } }
    );
  } catch (error) {
    console.error('[Agent API] Failed to list assets:', error);
    return Response.json({ error: 'Unable to query digital assets from VEILIO.' }, { status: 502 });
  }
}
