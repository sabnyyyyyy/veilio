import { NextRequest, NextResponse } from 'next/server';
import { getServiceById, updateService, sameWalletAddress } from '@/lib/server/servicesDb';
import { isAddress, parseEventLogs } from 'viem';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';
import { getAgentPublicClientForChain } from '@/lib/agent-sdk/server';
import { getServiceRegistryAddress } from '@/lib/serviceContract';
import {
  buildCanonicalMetadata,
  hashCanonicalMetadata,
} from '@/lib/serviceRegistry';
import { calculateSellerReputation } from '@/lib/server/serviceReputation';
import { verifyServiceOnChain, computeListingMetadataHash } from '@/lib/server/serviceRegistryVerification';


import { withJsonStores } from '@/lib/server/jsonStore';
async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const service = getServiceById(id);
    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    const onChainResult = await verifyServiceOnChain(service);
    const reputation = calculateSellerReputation(service.sellerId);

    // Verify the stored hash against the stored fields (incl. stored createdAt)
    const metadataVerified = service.metadataHash
      ? computeListingMetadataHash(service).toLowerCase() === service.metadataHash.toLowerCase()
      : false;

    return NextResponse.json({
      success: true,
      service: {
        ...service,
        onChainRegistered: onChainResult.isVerified,
        verificationDetails: onChainResult,
        unverifiedReason: onChainResult.isVerified ? undefined : onChainResult.reason,
        ordersCompleted: reputation.completedOrders,
        metadataVerified,
      },
      reputation,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const {
      sellerAddress,
      title,
      description,
      category,
      price,
      deliveryTime,
      sampleDeliverables,
      status,
      txHash,
      auth,
    } = body;

    const caller = sellerAddress || auth?.address;
    if (!caller || !isAddress(String(caller))) {
      return NextResponse.json({ error: 'Valid seller EVM address is required' }, { status: 400 });
    }

    const current = getServiceById(id);
    if (!current) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    if (!sameWalletAddress(current.sellerId, caller)) {
      return NextResponse.json(
        { error: 'Unauthorized: only the service seller can modify this listing' },
        { status: 403 }
      );
    }

    // 1. Cryptographic wallet authentication (required)
    {
      const authResult = await verifyServiceAuth({
        action: 'update-service',
        orderId: id,
        expectedAddress: current.sellerId,
        auth: auth || {
          address: caller,
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

    // 2. Receipt validation if an on-chain status/metadata update tx was executed
    if (txHash) {
      if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return NextResponse.json({ error: 'Invalid transaction hash format' }, { status: 400 });
      }

      const listingChainId = current.network === 'base:84532' ? 84532 : 97;
      let receipt;
      try {
        receipt = await getAgentPublicClientForChain(listingChainId).getTransactionReceipt({ hash: txHash as `0x${string}` });
      } catch (rpcErr: any) {
        return NextResponse.json(
          { error: `Registry transaction not confirmed on-chain: ${rpcErr?.shortMessage || rpcErr?.message || 'Transaction receipt not found'}` },
          { status: 400 }
        );
      }

      if (!receipt || receipt.status !== 'success') {
        return NextResponse.json(
          { error: 'On-chain service registry update transaction failed or reverted' },
          { status: 400 }
        );
      }

      const registryAddress = getServiceRegistryAddress(listingChainId);
      if (!receipt.to || !registryAddress || receipt.to.toLowerCase() !== registryAddress.toLowerCase()) {
        return NextResponse.json(
          { error: `Registry update transaction must target VeilServiceRegistry (${registryAddress})` },
          { status: 400 }
        );
      }
    }

    // 3. Compute updated metadata hash if metadata fields modified
    let updatedMetadataHash = current.metadataHash;
    if (title || description || category || price || deliveryTime || sampleDeliverables) {
      const updatedCanonical = buildCanonicalMetadata({
        id: current.id,
        seller: current.sellerId,
        sellerType: current.sellerType,
        sellerName: current.sellerName || 'Specialist',
        title: title ? title.trim() : current.title,
        description: description ? description.trim() : current.description,
        category: category ? category.trim() : current.category,
        price: price ? String(Number(price)) : current.price,
        currency: current.currency,
        deliveryTime: deliveryTime ? deliveryTime.trim() : current.deliveryTime,
        sampleDeliverables: Array.isArray(sampleDeliverables) ? sampleDeliverables : current.sampleDeliverables,
        createdAt: current.createdAt,
      });
      updatedMetadataHash = hashCanonicalMetadata(updatedCanonical);
    }

    const updated = updateService(id, caller, {
      ...(title ? { title: title.trim() } : {}),
      ...(description ? { description: description.trim() } : {}),
      ...(category ? { category: category.trim() } : {}),
      ...(price ? { price: String(Number(price)) } : {}),
      ...(deliveryTime ? { deliveryTime: deliveryTime.trim() } : {}),
      ...(Array.isArray(sampleDeliverables) ? { sampleDeliverables } : {}),
      ...(status && (status === 'active' || status === 'inactive') ? { status } : {}),
      ...(updatedMetadataHash ? { metadataHash: updatedMetadataHash } : {}),
      ...(txHash ? { registryTxHash: txHash } : {}),
    });

    return NextResponse.json({ success: true, service: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const GET = withJsonStores(handleGET);
export const PATCH = withJsonStores(handlePATCH);
