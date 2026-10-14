import { readAgentAuction } from '@/lib/agent-sdk/server';
import { resolveIpfsUri } from '@/lib/ipfs';
import { computeParticipantReputation } from '@/lib/reputation';
import { formatEther } from 'viem';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || BigInt(id) < 1n) {
    return Response.json({ error: 'id must be a positive integer.' }, { status: 400 });
  }

  try {
    const onchainAuction = await readAgentAuction(BigInt(id));
    if (!onchainAuction) {
      return Response.json({ error: `Asset ${id} does not exist on-chain.` }, { status: 404 });
    }

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
          format: assetDetails.format || meta.dataset?.manifest?.format,
          file_size: assetDetails.fileSize || (meta.dataset?.size ? `${(meta.dataset.size / (1024 * 1024)).toFixed(2)} MB` : undefined),
          region: assetDetails.region,
          language: assetDetails.language,
          data_period: assetDetails.dataPeriod,
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
  } catch (error) {
    console.error(`[Agent API] Failed to read asset ${id}:`, error);
    return Response.json({ error: 'Unable to read asset details.' }, { status: 502 });
  }
}
