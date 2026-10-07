import { readAgentAuction } from '@/lib/agent-sdk/server';
import { resolveIpfsUri } from '@/lib/ipfs';
import { getAuctionById } from '@/lib/mockAuctions';
import { computeParticipantReputation } from '@/lib/reputation';
import { formatEther } from 'viem';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || BigInt(id) < 1n) {
    return Response.json({ error: 'id must be a positive integer.' }, { status: 400 });
  }

  try {
    const onchainAuction = await readAgentAuction(BigInt(id)).catch(() => null);

    if (onchainAuction) {
      let meta: Record<string, any> = {};
      if (onchainAuction.metadataURI) {
        try {
          const resolved = resolveIpfsUri(onchainAuction.metadataURI) || onchainAuction.metadataURI;
          const res = await fetch(resolved, { signal: AbortSignal.timeout(4000) });
          if (res.ok) meta = await res.json();
        } catch {
          // Non-blocking
        }
      }

      const assetDetails = meta.asset || {};
      const rep = computeParticipantReputation(onchainAuction.seller, { role: 'seller' });

      return Response.json(
        {
          data: {
            id: onchainAuction.id,
            title: onchainAuction.itemName,
            description: onchainAuction.description,
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
            schema_or_specification: assetDetails.schemaOrSpecification || null,
            sample_preview: meta.asset?.samplePreview || null,
            agent_compatible: assetDetails.agentCompatible ?? true,
            delivery_method: assetDetails.deliveryMethod || 'encrypted-download',
            seller: {
              address: onchainAuction.seller,
              delivery_rate_percent: rep.deliverySuccessRate,
              verified: rep.verifiedStatus,
              reliability_score: rep.reliabilityScore,
              status_label: rep.statusLabel,
            },
            auction: {
              auction_id: onchainAuction.id,
              state: onchainAuction.state,
              starting_price_bnb: formatEther(BigInt(onchainAuction.startingPriceWei)),
              bidder_count: Number(onchainAuction.bidderCount),
              commit_end_time: Number(onchainAuction.commitEndTime),
              reveal_end_time: Number(onchainAuction.revealEndTime),
              inspection_duration_sec: Number(onchainAuction.inspectionDuration),
            },
          },
          chainId: 97,
        },
        { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } }
      );
    }

    // Fallback to mock item
    const mock = getAuctionById(id);
    const rep = computeParticipantReputation(mock.seller, { role: 'seller' });

    return Response.json({
      data: {
        id: mock.id,
        title: mock.itemName,
        description: mock.description,
        category: mock.metadata?.category || mock.assetType || 'dataset',
        license: {
          type: mock.metadata?.licenseType || 'commercial_use',
          usage_rights: mock.metadata?.usageRights || 'Commercial use permitted',
        },
        format: mock.metadata?.format || 'Parquet',
        file_size: mock.metadata?.fileSize || '1.8 GB',
        region: mock.metadata?.region || 'Global',
        language: mock.metadata?.language || 'English',
        data_period: mock.metadata?.dataPeriod || '2024 - 2026',
        update_frequency: mock.metadata?.updateFrequency || 'one_time',
        schema_or_specification: mock.metadata?.schemaOrSpecification || null,
        agent_compatible: mock.metadata?.agentCompatible ?? true,
        delivery_method: 'encrypted-download',
        seller: {
          address: mock.seller,
          delivery_rate_percent: rep.deliverySuccessRate,
          verified: rep.verifiedStatus,
          reliability_score: rep.reliabilityScore,
          status_label: rep.statusLabel,
        },
        auction: {
          auction_id: mock.id,
          state: mock.status,
          starting_price_bnb: mock.startingPrice,
          bidder_count: mock.bidderCount,
          commit_end_time: Math.floor(mock.commitEndTime / 1000),
          reveal_end_time: Math.floor(mock.revealEndTime / 1000),
        },
      },
      chainId: 97,
    });
  } catch (error) {
    console.error(`[Agent API] Failed to read asset ${id}:`, error);
    return Response.json({ error: 'Unable to read asset details.' }, { status: 502 });
  }
}
