import { NextRequest, NextResponse } from 'next/server';
import { getServiceById, updateService } from '@/lib/server/servicesDb';
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
  verifyMetadataHash,
} from '@/lib/serviceRegistry';
import { calculateSellerReputation } from '@/lib/server/serviceReputation';
import { verifyServiceOnChain } from '@/lib/server/serviceRegistryVerification';


export async function GET(
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

    // Verify metadata hash against current state
    const canonicalMeta = buildCanonicalMetadata({
      id: service.id,
      seller: service.sellerId,
      sellerType: service.sellerType,
      sellerName: service.sellerName || 'Specialist',
      title: service.title,
      description: service.description,
      category: service.category,
      price: service.price,
      currency: service.currency,
      deliveryTime: service.deliveryTime,
      sampleDeliverables: service.sampleDeliverables,
      createdAt: service.createdAt,
    });
    const metadataVerified = service.metadataHash
      ? verifyMetadataHash(canonicalMeta, service.metadataHash)
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

export async function PATCH(
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

    if (current.sellerId.toLowerCase() !== caller.toLowerCase()) {
      return NextResponse.json(
        { error: 'Unauthorized: only the service seller can modify this listing' },
        { status: 403 }
      );
    }

    // 1. Cryptographic wallet authentication (if auth payload provided)
    if (auth || body.signature) {
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
          { error: 'On-chain service registry update transaction failed or reverted' },
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
