import { agentPublicClient } from '@/lib/agent-sdk/server';
import {
  VEIL_SERVICE_REGISTRY_ABI,
  VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS,
} from '@/lib/serviceContract';
import {
  formatServiceRegistryId,
  buildCanonicalMetadata,
  hashCanonicalMetadata,
} from '@/lib/serviceRegistry';
import type { ServiceListing } from '@/lib/server/servicesDb';

export interface OnChainVerificationResult {
  isVerified: boolean;
  onChainServiceId?: `0x${string}`;
  seller?: string;
  metadataHash?: `0x${string}`;
  metadataURI?: string;
  active?: boolean;
  registeredAt?: number;
  updatedAt?: number;
  reason?: string;
}

/**
 * Verifies a service listing against the deployed VeilServiceRegistry contract on BNB Chain Testnet (Chain ID 97).
 * Validates:
 * 1. Network chain ID is exactly 97.
 * 2. Contract address matches configured VeilServiceRegistry address.
 * 3. Service ID exists in the contract.
 * 4. Contract seller matches listing seller address.
 * 5. Contract status is active.
 * 6. Contract metadata hash matches recomputed canonical metadata hash.
 * 7. Contract metadata URI matches listing metadata URI.
 */
export async function verifyServiceOnChain(
  service: ServiceListing
): Promise<OnChainVerificationResult> {
  try {
    // 1. Verify RPC Chain ID is 97
    const chainId = await agentPublicClient.getChainId();
    if (chainId !== 97) {
      return {
        isVerified: false,
        reason: `RPC network mismatch: expected chain ID 97, detected ${chainId}`,
      };
    }

    const registryAddress = VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS;
    if (!registryAddress) {
      return {
        isVerified: false,
        reason: 'VeilServiceRegistry contract address is not configured',
      };
    }

    // 2. Format bytes32 service ID
    const serviceBytes32Id = formatServiceRegistryId(service.id);

    // 3. Query contract serviceExists
    const exists = await agentPublicClient.readContract({
      address: registryAddress,
      abi: VEIL_SERVICE_REGISTRY_ABI,
      functionName: 'serviceExists',
      args: [serviceBytes32Id],
    });

    if (!exists) {
      return {
        isVerified: false,
        onChainServiceId: serviceBytes32Id,
        reason: 'Service ID not found in on-chain VeilServiceRegistry',
      };
    }

    // 4. Retrieve contract ServiceRecord
    const record = (await agentPublicClient.readContract({
      address: registryAddress,
      abi: VEIL_SERVICE_REGISTRY_ABI,
      functionName: 'getService',
      args: [serviceBytes32Id],
    })) as {
      serviceId: `0x${string}`;
      seller: string;
      metadataHash: `0x${string}`;
      metadataURI: string;
      active: boolean;
      registeredAt: bigint;
      updatedAt: bigint;
    };

    // 5. Verify Seller Identity
    if (record.seller.toLowerCase() !== service.sellerId.toLowerCase()) {
      return {
        isVerified: false,
        reason: `Contract seller (${record.seller}) does not match listing seller (${service.sellerId})`,
      };
    }

    // 6. Verify Active Status
    if (!record.active) {
      return {
        isVerified: false,
        reason: 'Listing is marked inactive on-chain by seller',
      };
    }

    // 7. Verify Metadata URI
    if (service.metadataURI && record.metadataURI !== service.metadataURI) {
      return {
        isVerified: false,
        reason: `Contract metadata URI (${record.metadataURI}) does not match listing URI (${service.metadataURI})`,
      };
    }

    // 8. Recompute canonical metadata hash and verify integrity
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

    const recomputedHash = hashCanonicalMetadata(canonicalMeta);
    if (record.metadataHash.toLowerCase() !== recomputedHash.toLowerCase()) {
      return {
        isVerified: false,
        reason: `Recomputed metadata hash (${recomputedHash}) does not match on-chain hash (${record.metadataHash})`,
      };
    }

    return {
      isVerified: true,
      onChainServiceId: serviceBytes32Id,
      seller: record.seller,
      metadataHash: record.metadataHash,
      metadataURI: record.metadataURI,
      active: record.active,
      registeredAt: Number(record.registeredAt),
      updatedAt: Number(record.updatedAt),
    };
  } catch (err: any) {
    return {
      isVerified: false,
      reason: err?.message || 'Failed to query on-chain registry',
    };
  }
}
