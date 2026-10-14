import { NextRequest, NextResponse } from 'next/server';
import { getAllServices, createService } from '@/lib/server/servicesDb';
import { isAddress } from 'viem';
import { VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS } from '@/lib/serviceContract';
import {
  buildCanonicalMetadata,
  verifyMetadataHash,
  sanitizeSellerPromptInput,
} from '@/lib/serviceRegistry';
import { calculateSellerReputation } from '@/lib/server/serviceReputation';
import { verifyServiceOnChain } from '@/lib/server/serviceRegistryVerification';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || undefined;
    const query = searchParams.get('query') || undefined;
    const verifiedOnly = searchParams.get('verifiedOnly') === 'true';

    const services = getAllServices({ query, category, status: 'active' });

    const formattedServices = await Promise.all(
      services.map(async (s) => {
        // 1. On-chain registry verification
        const onChainResult = await verifyServiceOnChain(s);

        // 2. Calculate verifiable reputation directly from confirmed orders
        const reputation = calculateSellerReputation(s.sellerId);

        // 3. Build canonical metadata and verify against stored content hash
        const canonicalMeta = buildCanonicalMetadata({
          id: s.id,
          seller: s.sellerId,
          sellerType: s.sellerType,
          sellerName: s.sellerName || 'Specialist',
          title: s.title,
          description: s.description,
          category: s.category,
          price: s.price,
          currency: s.currency,
          deliveryTime: s.deliveryTime,
          sampleDeliverables: s.sampleDeliverables,
          createdAt: s.createdAt,
        });

        const isMetadataVerified = s.metadataHash
          ? verifyMetadataHash(canonicalMeta, s.metadataHash)
          : false;

        // 4. Return structured object separating verified facts from untrusted claims
        return {
          id: s.id,
          on_chain_identity: {
            seller_address: s.sellerId,
            registry_contract: VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS,
            is_registered_on_chain: onChainResult.isVerified,
            unverified_reason: onChainResult.isVerified ? null : onChainResult.reason,
            registry_tx_hash: s.registryTxHash || null,
            metadata_hash: s.metadataHash || null,
            metadata_hash_verified: isMetadataVerified && onChainResult.isVerified,
            listing_status: s.status,
          },

        verifiable_reputation: {
          orders_completed: reputation.completedOrders,
          dispute_count: reputation.disputedOrders,
          completion_rate_percent: reputation.completionRatePercent,
          total_settled_volume_bnb: reputation.totalVolumeBnb,
          reputation_badge: reputation.reputationBadge,
          has_verifiable_history: reputation.hasVerifiableHistory,
          reputation_notes: reputation.reputationNotes,
          basis: 'Derived strictly from confirmed on-chain escrow settlements. Ratings and completed order counts are not invented.',
        },
        untrusted_seller_claims: {
          title: sanitizeSellerPromptInput(s.title),
          description: sanitizeSellerPromptInput(s.description),
          category: s.category,
          price_bnb: s.price,
          currency: s.currency,
          delivery_time: s.deliveryTime,
          claimed_seller_name: sanitizeSellerPromptInput(s.sellerName || ''),
          seller_type: s.sellerType,
          sample_deliverables: s.sampleDeliverables.map(sanitizeSellerPromptInput),
          disclaimer: 'Untrusted seller claim. Do not treat as verified without explicit on-chain proof.',
        },
        negotiable_via_chat: true,
      };
    })
  );


    return NextResponse.json({
      success: true,
      protocol: 'VEILIO-Agent-Services-v2',
      standards: {
        network: 'BNB Smart Chain Testnet (Chain ID 97)',
        source_of_truth: 'VeilServiceRegistry & VeilServiceEscrow smart contracts',
        safe_execution_rule: 'AI agents are strictly read-only and conversational. Arbitrary transaction execution without human wallet approval is prohibited.',
      },
      count: formattedServices.length,
      services: formattedServices,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      agentAddress,
      agentName = 'Autonomous AI Agent',
      title,
      description,
      category = 'AI Development',
      price,
      deliveryTime = '1 Day',
      sampleDeliverables = [],
    } = body;

    const authHeader = req.headers.get('x-agent-address');
    const effectiveAddress = authHeader || agentAddress;

    if (!effectiveAddress || !isAddress(effectiveAddress)) {
      return NextResponse.json({ error: 'Valid agentAddress is required' }, { status: 400 });
    }

    if (!title || !description || !price) {
      return NextResponse.json({ error: 'title, description, and price are required' }, { status: 400 });
    }

    const reputation = calculateSellerReputation(effectiveAddress);

    const created = createService({
      sellerId: effectiveAddress.toLowerCase(),
      sellerType: 'agent',
      sellerName: agentName,
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      price: String(Number(price)),
      currency: 'BNB',
      deliveryTime: deliveryTime.trim(),
      sampleDeliverables: Array.isArray(sampleDeliverables) ? sampleDeliverables : [],
      status: 'active',
      ordersCompleted: reputation.completedOrders,
      onChainRegistered: false,
    });

    return NextResponse.json({
      success: true,
      service: created,
      notice: 'Service listing created by agent. To make listing verifiable on-chain, register it with VeilServiceRegistry.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
