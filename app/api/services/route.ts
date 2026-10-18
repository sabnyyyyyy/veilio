import { NextRequest, NextResponse } from 'next/server';
import {
  getAllServices,
  createService,
  normalizeServiceNetwork,
  normalizeWalletAddress,
  SERVICE_NETWORK_CURRENCY,
} from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs } from 'viem';
import { isSolanaAddress, verifyServiceAuth } from '@/lib/server/serviceAuth';
import { getAgentPublicClientForChain } from '@/lib/agent-sdk/server';
import {
  VEIL_SERVICE_REGISTRY_ABI,
  getServiceRegistryAddress,
} from '@/lib/serviceContract';
import {
  buildCanonicalMetadata,
  hashCanonicalMetadata,
  formatServiceRegistryId,
} from '@/lib/serviceRegistry';
import { calculateSellerReputation } from '@/lib/server/serviceReputation';
import { verifyServiceOnChain } from '@/lib/server/serviceRegistryVerification';
import { SolanaChainAdapter } from '@/lib/cross-chain/SolanaChainAdapter';
import { createRegisterServiceInstruction, DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID } from '@/lib/cross-chain/solanaServiceRegistry';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query') || undefined;
    const category = searchParams.get('category') || undefined;
    const sellerType = (searchParams.get('sellerType') as 'human' | 'agent' | 'all') || undefined;
    const status = (searchParams.get('status') as 'active' | 'inactive' | 'all') || 'active';
    const verifiedOnly = searchParams.get('verifiedOnly') === 'true' || searchParams.get('verifiedOnly') === '1';
    const includeUnverified = searchParams.get('includeUnverified') === 'true' || searchParams.get('includeUnverified') === '1';

    const services = getAllServices({ query, category, sellerType, status });

    // Verify on-chain against the registry of each listing's network (BNB 97 / Base 84532 / Solana)
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


/** Max age of the client-chosen createdAt (covers wallet confirmation + mining time). */
const MAX_CREATED_AT_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Registers a listing after its on-chain registerService transaction.
 *
 * Requires: signed seller auth ('create-service', orderId = service id), the registry
 * txHash, and the exact `createdAt` + `metadataHash` the client hashed and wrote on-chain.
 * The server recomputes the canonical hash from the submitted fields and that createdAt,
 * rejects any mismatch, checks the ServiceRegistered event (id, seller, hash), and stores
 * createdAt verbatim so later verification recomputes the same hash.
 * BNB 97, Base 84532, and Solana Devnet listings are verified against their native registry.
 */
async function handlePOST(req: NextRequest) {
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
      deliveryTime = '3 Days',
      sampleDeliverables = [],
      txHash,
      metadataURI,
      metadataHash: suppliedMetadataHash,
      createdAt: suppliedCreatedAt,
      network: reqNetwork,
      currency: reqCurrency,
      auth,
    } = body;

    if (!requestedId || typeof requestedId !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(requestedId)) {
      return NextResponse.json({ error: 'Service id (3-32 chars, [A-Za-z0-9_-]) is required' }, { status: 400 });
    }

    if (!title || typeof title !== 'string' || title.trim().length < 5) {
      return NextResponse.json({ error: 'Title must be at least 5 characters' }, { status: 400 });
    }

    if (!description || typeof description !== 'string' || description.trim().length < 15) {
      return NextResponse.json({ error: 'Description must be at least 15 characters' }, { status: 400 });
    }

    if (!price || isNaN(Number(price)) || Number(price) <= 0) {
      return NextResponse.json({ error: 'Valid positive price is required' }, { status: 400 });
    }

    if (!category || typeof category !== 'string') {
      return NextResponse.json({ error: 'Valid category is required' }, { status: 400 });
    }

    const network = reqNetwork ? normalizeServiceNetwork(reqNetwork) : 'bnb:97';
    if (!network) {
      return NextResponse.json({ error: `Unsupported listing network: ${String(reqNetwork)}` }, { status: 400 });
    }
    const isSolana = network === 'solana:devnet';
    if (typeof sellerId !== 'string' || (isSolana ? !isSolanaAddress(sellerId) : !isAddress(sellerId))) {
      return NextResponse.json({ error: `Valid seller ${isSolana ? 'Solana' : 'EVM'} address is required` }, { status: 400 });
    }
    const chainId = network === 'base:84532' ? 84532 : 97;
    const currency = SERVICE_NETWORK_CURRENCY[network];
    if (reqCurrency && String(reqCurrency).toUpperCase().trim() !== currency) {
      return NextResponse.json({ error: `Currency ${reqCurrency} does not match network ${network}` }, { status: 400 });
    }

    const createdAt = Number(suppliedCreatedAt);
    const now = Date.now();
    if (!Number.isSafeInteger(createdAt) || createdAt > now + 5 * 60 * 1000 || now - createdAt > MAX_CREATED_AT_AGE_MS) {
      return NextResponse.json({ error: 'createdAt (the timestamp hashed into metadataHash) is missing or out of range' }, { status: 400 });
    }

    // 1. Cryptographic wallet authentication (required)
    const authResult = await verifyServiceAuth({
      action: 'create-service',
      orderId: requestedId,
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

    // 2. Compute canonical metadata & hash with the exact fields that get stored
    const serviceId = requestedId;
    const normalizedSellerType: 'human' | 'agent' = sellerType === 'agent' ? 'agent' : 'human';
    const resolvedSellerName = (typeof sellerName === 'string' && sellerName.trim()) ||
      (normalizedSellerType === 'agent' ? 'Autonomous AI Agent' : 'Verified Specialist');
    const deliverables: string[] = Array.isArray(sampleDeliverables)
      ? sampleDeliverables.filter((d: unknown): d is string => typeof d === 'string').map((d: string) => d.trim()).filter((d: string) => d.length > 0)
      : [];
    const listingFields = {
      sellerType: normalizedSellerType,
      sellerName: resolvedSellerName,
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      price: String(Number(price)),
      currency,
      deliveryTime: String(deliveryTime).trim(),
      sampleDeliverables: deliverables,
    };
    const computedMetadataHash = hashCanonicalMetadata(buildCanonicalMetadata({
      id: serviceId,
      seller: sellerId,
      ...listingFields,
      createdAt,
    }));

    if (!suppliedMetadataHash || String(suppliedMetadataHash).toLowerCase() !== computedMetadataHash.toLowerCase()) {
      return NextResponse.json(
        { error: `metadataHash mismatch: server computed ${computedMetadataHash} from the submitted fields and createdAt` },
        { status: 400 }
      );
    }

    // 3. On-chain receipt verification (required)
    if (!txHash || typeof txHash !== 'string' || (isSolana ? !/^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(txHash) : !/^0x[a-fA-F0-9]{64}$/.test(txHash))) {
      return NextResponse.json(
        { error: 'Valid registry transaction hash is required' },
        { status: 400 }
      );
    }

    if (isSolana) {
      const programId = process.env.NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID || DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID;
      const adapter = new SolanaChainAdapter({ networkId: 'solana:devnet' });
      const summary = await adapter.getTransactionSummary(txHash, 'confirmed');
      if (!summary || summary.err) return NextResponse.json({ error: 'Solana registry transaction is not confirmed or failed' }, { status: 400 });
      const expectedIx = createRegisterServiceInstruction({
        programId,
        seller: sellerId,
        serviceId: formatServiceRegistryId(serviceId),
        metadataHash: computedMetadataHash,
        metadataUri: String(metadataURI || `ipfs://QmServiceMeta-${serviceId}`),
      });
      const expectedData = Buffer.from(expectedIx.data);
      const matches = summary.instructions.some((ix) =>
        ix.programId === programId && ix.accounts[0] === expectedIx.accounts[0].pubkey &&
        ix.accounts[1] === sellerId && Buffer.from(ix.data).equals(expectedData)
      );
      if (!matches || !summary.signers.includes(sellerId)) {
        return NextResponse.json({ error: 'Solana registry instruction does not match seller, service metadata, or signature' }, { status: 400 });
      }
      const created = createService({
        id: serviceId, sellerId, ...listingFields,
        status: 'active', ordersCompleted: calculateSellerReputation(sellerId).completedOrders,
        onChainRegistered: true, registryTxHash: txHash, metadataHash: computedMetadataHash,
        metadataURI: String(metadataURI || `ipfs://QmServiceMeta-${serviceId}`),
        onChainServiceId: expectedIx.accounts[0].pubkey, network, createdAt,
      });
      return NextResponse.json({ success: true, service: created, metadataHash: computedMetadataHash, onChainVerified: true });
    }

    const targetRegistryAddr = getServiceRegistryAddress(chainId);
    if (!targetRegistryAddr || !isAddress(targetRegistryAddr)) {
      return NextResponse.json({ error: `VeilServiceRegistry is not configured for chain ${chainId}` }, { status: 500 });
    }

    let receipt;
    try {
      receipt = await getAgentPublicClientForChain(chainId).getTransactionReceipt({ hash: txHash as `0x${string}` });
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

    if (!receipt.to || receipt.to.toLowerCase() !== targetRegistryAddr.toLowerCase()) {
      return NextResponse.json(
        { error: `Transaction recipient does not match VeilServiceRegistry (${targetRegistryAddr})` },
        { status: 400 }
      );
    }

    // Validate ServiceRegistered event (id, seller and metadata hash must all match)
    let logs;
    try {
      logs = parseEventLogs({
        abi: VEIL_SERVICE_REGISTRY_ABI,
        logs: receipt.logs,
        eventName: 'ServiceRegistered',
      });
    } catch (parseErr: any) {
      return NextResponse.json({ error: `Could not parse ServiceRegistered event: ${parseErr?.message || parseErr}` }, { status: 400 });
    }
    const expectedBytes32 = formatServiceRegistryId(serviceId).toLowerCase();
    const match = (logs || []).find((l: any) =>
      String(l.args?.serviceId || '').toLowerCase() === expectedBytes32 &&
      String(l.args?.seller || '').toLowerCase() === sellerId.toLowerCase() &&
      String(l.args?.metadataHash || '').toLowerCase() === computedMetadataHash.toLowerCase()
    );
    if (!match) {
      return NextResponse.json(
        { error: 'ServiceRegistered event does not match service ID, seller address or metadata hash' },
        { status: 400 }
      );
    }
    const onChainURI = String((match as any).args?.metadataURI || '');
    if (metadataURI && onChainURI && metadataURI !== onChainURI) {
      return NextResponse.json({ error: 'metadataURI does not match the on-chain registry record' }, { status: 400 });
    }

    // 4. Calculate verifiable reputation dynamically from settled escrow records
    const reputation = calculateSellerReputation(sellerId);

    const created = createService({
      id: serviceId,
      sellerId: normalizeWalletAddress(sellerId),
      ...listingFields,
      status: 'active',
      ordersCompleted: reputation.completedOrders,
      onChainRegistered: true,
      registryTxHash: txHash,
      metadataHash: computedMetadataHash,
      metadataURI: onChainURI || metadataURI || `ipfs://QmServiceMeta-${serviceId}`,
      onChainServiceId: formatServiceRegistryId(serviceId),
      network,
      createdAt,
    });

    return NextResponse.json({
      success: true,
      service: created,
      metadataHash: computedMetadataHash,
      onChainVerified: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('already exists') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
