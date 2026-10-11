import { NextRequest, NextResponse } from 'next/server';
import { getAllServices, createService } from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs } from 'viem';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';
import { agentPublicClient } from '@/lib/agent-sdk/server';
import {
  VEIL_SERVICE_REGISTRY_ABI,
  VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS,
} from '@/lib/serviceContract';
import {
  buildCanonicalMetadata,
  hashCanonicalMetadata,
  formatServiceRegistryId,
} from '@/lib/serviceRegistry';
import { calculateSellerReputation } from '@/lib/server/serviceReputation';
import { verifyServiceOnChain } from '@/lib/server/serviceRegistryVerification';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query') || undefined;
    const category = searchParams.get('category') || undefined;
    const sellerType = (searchParams.get('sellerType') as 'human' | 'agent' | 'all') || undefined;
    const status = (searchParams.get('status') as 'active' | 'inactive' | 'all') || 'active';
    const verifiedOnly = searchParams.get('verifiedOnly') === 'true' || searchParams.get('verifiedOnly') === '1';
    const includeUnverified = searchParams.get('includeUnverified') === 'true' || searchParams.get('includeUnverified') === '1';

    const services = getAllServices({ query, category, sellerType, status });

    // Verify on-chain against deployed VeilServiceRegistry contract (Chain ID 97)
    const verifiedServices = await Promise.all(
      services.map(async (s) => {
        const onChainResult = await verifyServiceOnChain(s);
        const rep = calculateSellerReputation(s.sellerId);
        return {
          ...s,
          onChainRegistered: onChainResult.isVerified,
          verificationDetails: onChainResult,
          unverifiedReason: onChainResult.isVerified ? undefined : onChainResult.reason,
          ordersCompleted: rep.completedOrders,
          reputation: {
            badge: rep.reputationBadge,
            completedOrders: rep.completedOrders,
            totalVolumeBnb: rep.totalVolumeBnb,
            hasVerifiableHistory: rep.hasVerifiableHistory,
            completionRatePercent: rep.completionRatePercent,
          },
        };
      })
    );

    // Filter based on verifiedOnly or default marketplace behavior
    // If includeUnverified is not set and verifiedOnly is requested (or by default in verified view), show verified only
    const shouldFilterVerified = verifiedOnly || !includeUnverified;
    const displayedServices = shouldFilterVerified
      ? verifiedServices.filter((s) => s.onChainRegistered)
      : verifiedServices;

    return NextResponse.json({
      success: true,
      services: displayedServices,
      metrics: {
        totalListings: displayedServices.length,
        verifiedCount: verifiedServices.filter((s) => s.onChainRegistered).length,
        unverifiedCount: verifiedServices.filter((s) => !s.onChainRegistered).length,
        agentCount: displayedServices.filter((s) => s.sellerType === 'agent').length,
        humanCount: displayedServices.filter((s) => s.sellerType === 'human').length,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      id: requestedId,
      sellerId,
      sellerType = 'human',
      sellerName,
      title,
      description,
      category,
      price,
      currency = 'BNB',
      deliveryTime = '3 Days',
      sampleDeliverables = [],
      txHash,
      metadataURI,
      metadataHash: suppliedMetadataHash,
      auth,
    } = body;

    if (!sellerId || !isAddress(String(sellerId))) {
      return NextResponse.json({ error: 'Valid seller EVM address is required' }, { status: 400 });
    }

    if (!title || typeof title !== 'string' || title.trim().length < 5) {
      return NextResponse.json({ error: 'Title must be at least 5 characters' }, { status: 400 });
    }

    if (!description || typeof description !== 'string' || description.trim().length < 15) {
      return NextResponse.json({ error: 'Description must be at least 15 characters' }, { status: 400 });
    }

    if (!price || isNaN(Number(price)) || Number(price) <= 0) {
      return NextResponse.json({ error: 'Valid positive price in BNB is required' }, { status: 400 });
    }

    if (!category || typeof category !== 'string') {
      return NextResponse.json({ error: 'Valid category is required' }, { status: 400 });
    }

    // 1. Cryptographic wallet authentication (if auth payload provided)
    if (auth || body.signature) {
      const authResult = await verifyServiceAuth({
        action: 'create-service',
        orderId: requestedId || 'service-creation',
        expectedAddress: sellerId,
        auth: auth || {
          address: sellerId,
          signature: body.signature,
          timestamp: body.timestamp,
          nonce: body.nonce,
        },
      });

      if (!authResult.valid) {
        return NextResponse.json(
          { error: authResult.error || 'Authentication failed' },
          { status: authResult.status || 401 }
        );
      }
    }

    // 2. Compute canonical metadata & hash
    const serviceId = requestedId || `srv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const canonicalMeta = buildCanonicalMetadata({
      id: serviceId,
      seller: sellerId,
      sellerType: sellerType === 'agent' ? 'agent' : 'human',
      sellerName: sellerName?.trim() || (sellerType === 'agent' ? 'Autonomous AI Agent' : 'Verified Specialist'),
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      price: String(Number(price)),
      currency: currency.toUpperCase(),
      deliveryTime: deliveryTime.trim(),
      sampleDeliverables,
    });
    const computedMetadataHash = hashCanonicalMetadata(canonicalMeta);

    // 3. On-chain receipt verification (if txHash is provided)
    let onChainVerified = false;
    if (txHash) {
      if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return NextResponse.json(
          { error: 'Invalid transaction hash format' },
          { status: 400 }
        );
      }

      let receipt;
      try {
        receipt = await agentPublicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      } catch (rpcErr: any) {
        return NextResponse.json(
          { error: `Registry transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
          { status: 400 }
        );
      }

      if (!receipt || receipt.status !== 'success') {
        return NextResponse.json(
          { error: 'On-chain service registration transaction failed or reverted' },
          { status: 400 }
        );
      }

      const targetRegistryAddr = VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS;
      if (targetRegistryAddr && receipt.to && receipt.to.toLowerCase() !== targetRegistryAddr.toLowerCase()) {
        return NextResponse.json(
          { error: `Transaction recipient does not match VeilServiceRegistry (${targetRegistryAddr})` },
          { status: 400 }
        );
      }

      // Validate ServiceRegistered event
      try {
        const logs = parseEventLogs({
          abi: VEIL_SERVICE_REGISTRY_ABI,
          logs: receipt.logs,
          eventName: 'ServiceRegistered',
        });

        if (logs && logs.length > 0) {
          const expectedBytes32 = formatServiceRegistryId(serviceId).toLowerCase();
          const match = logs.find((l: any) => {
            const loggedId = String(l.args?.serviceId || '').toLowerCase();
            const loggedSeller = String(l.args?.seller || '').toLowerCase();
            return loggedId === expectedBytes32 && loggedSeller === sellerId.toLowerCase();
          });

          if (!match) {
            return NextResponse.json(
              { error: 'ServiceRegistered event does not match service ID or seller address' },
              { status: 400 }
            );
          }
          onChainVerified = true;
        }
      } catch (parseErr: any) {
        console.warn('[Service Registry] Could not parse event log:', parseErr);
      }
    }

    // 4. Calculate verifiable reputation dynamically from settled escrow records
    const reputation = calculateSellerReputation(sellerId);

    const created = createService({
      id: serviceId,
      sellerId: sellerId.toLowerCase(),
      sellerType: sellerType === 'agent' ? 'agent' : 'human',
      sellerName: sellerName?.trim() || (sellerType === 'agent' ? 'Autonomous AI Agent' : 'Verified Seller'),
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      price: String(Number(price)),
      currency: currency.toUpperCase(),
      deliveryTime: deliveryTime.trim(),
      sampleDeliverables: Array.isArray(sampleDeliverables) ? sampleDeliverables : [],
      status: 'active',
      ordersCompleted: reputation.completedOrders,
      onChainRegistered: onChainVerified,
      registryTxHash: txHash || undefined,
      metadataHash: computedMetadataHash,
      metadataURI: metadataURI || `ipfs://QmServiceMeta-${serviceId}`,
      onChainServiceId: formatServiceRegistryId(serviceId),
    });

    return NextResponse.json({
      success: true,
      service: created,
      metadataHash: computedMetadataHash,
      onChainVerified,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
