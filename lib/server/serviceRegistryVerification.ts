import { getAgentPublicClientForChain } from '@/lib/agent-sdk/server';
import {
  VEIL_SERVICE_REGISTRY_ABI,
  getServiceRegistryAddress,
  normalizeChainId,
} from '@/lib/serviceContract';
import {
  formatServiceRegistryId,
  buildCanonicalMetadata,
  hashCanonicalMetadata,
} from '@/lib/serviceRegistry';
import {
  DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID,
  decodeServiceRecordAccount,
  findServiceRecordPda,
} from '@/lib/cross-chain/solanaServiceRegistry';
import { SolanaChainAdapter } from '@/lib/cross-chain/SolanaChainAdapter';
import { getNetworkConfig } from '@/lib/cross-chain/networkConfig';
import { normalizeServiceNetwork, type ServiceListing } from '@/lib/server/servicesDb';

/** Deterministic hash of a stored listing, using its stored createdAt (see lib/serviceRegistry.ts). */
export function computeListingMetadataHash(service: ServiceListing): `0x${string}` {
  return hashCanonicalMetadata(buildCanonicalMetadata({
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
  }));
}

/**
 * Solana registry program id: NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID, else the
 * deployed devnet program from networkConfig / solanaServiceRegistry (same default).
 */
function getSolanaRegistryProgramId(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID ||
    getNetworkConfig('solana:devnet').contracts.serviceRegistry ||
    DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID
  );
}

/**
 * Reads the seller-owned ServiceRecord PDA from the Solana registry program and checks
 * owner, seller, service id, active flag, metadata URI and metadata hash. Fails closed on
 * any RPC/decoding error.
 */
async function verifySolanaServiceOnChain(
  service: ServiceListing,
  adapter: SolanaChainAdapter = new SolanaChainAdapter({ networkId: 'solana:devnet' })
): Promise<OnChainVerificationResult> {
  const programId = getSolanaRegistryProgramId();
  const serviceIdHex = formatServiceRegistryId(service.id);
  if (serviceIdHex.length !== 66) {
    return { isVerified: false, reason: 'Service id does not fit in a bytes32 registry id', network: 'solana:devnet' };
  }

  let pda: string;
  try {
    pda = findServiceRecordPda(serviceIdHex, service.sellerId, programId).pda;
  } catch (err: any) {
    return { isVerified: false, reason: `Cannot derive Solana ServiceRecord PDA: ${err?.message || err}`, network: 'solana:devnet' };
  }

  const account = await adapter.getAccountInfo(pda);
  if (!account) {
    return { isVerified: false, onChainServiceId: pda, reason: 'Service record not found in Solana service registry', network: 'solana:devnet' };
  }
  if (account.owner !== programId) {
    return { isVerified: false, onChainServiceId: pda, reason: `Service record owner (${account.owner}) is not the registry program`, network: 'solana:devnet' };
  }

  const record = decodeServiceRecordAccount(account.data);
  if (record.seller !== service.sellerId) {
    return { isVerified: false, reason: `Registry seller (${record.seller}) does not match listing seller (${service.sellerId})`, network: 'solana:devnet' };
  }
  if (record.serviceId.toLowerCase() !== serviceIdHex.toLowerCase()) {
    return { isVerified: false, reason: 'Registry service id does not match listing id', network: 'solana:devnet' };
  }
  if (!record.active) {
    return { isVerified: false, reason: 'Listing is marked inactive on-chain by seller', network: 'solana:devnet' };
  }
  if (service.metadataURI && record.metadataUri !== service.metadataURI) {
    return { isVerified: false, reason: `Registry metadata URI (${record.metadataUri}) does not match listing URI (${service.metadataURI})`, network: 'solana:devnet' };
  }
  const recomputedHash = computeListingMetadataHash(service);
  if (record.metadataHash.toLowerCase() !== recomputedHash.toLowerCase()) {
    return { isVerified: false, reason: `Recomputed metadata hash (${recomputedHash}) does not match on-chain hash (${record.metadataHash})`, network: 'solana:devnet' };
  }

  return {
    isVerified: true,
    onChainServiceId: pda,
    seller: record.seller,
    metadataHash: record.metadataHash,
    metadataURI: record.metadataUri,
    active: record.active,
    registeredAt: record.registeredAt,
    updatedAt: record.updatedAt,
    network: 'solana:devnet',
  };
}

export interface OnChainVerificationResult {
  isVerified: boolean;
  onChainServiceId?: `0x${string}` | string;
  seller?: string;
  metadataHash?: `0x${string}` | string;
  metadataURI?: string;
  active?: boolean;
  registeredAt?: number;
  updatedAt?: number;
  network?: string;
  reason?: string;
}

/**
 * Verifies a service listing against the deployed VeilServiceRegistry contract
 * on BNB Chain Testnet (Chain ID 97), Base Sepolia (Chain ID 84532), or Solana Devnet.
 *
 * The network comes from the listing (`service.network`); legacy listings without one
 * are BNB Chain Testnet (Chain ID 97). Every branch fails closed.
 */
export async function verifyServiceOnChain(
  service: ServiceListing,
  networkIdOrChainId?: number | string
): Promise<OnChainVerificationResult> {
  try {
    const network =
      normalizeServiceNetwork(networkIdOrChainId ?? service.network ?? (service as any).chainId) ||
      ((service as any).chainFamily === 'solana' ? 'solana:devnet' : 'bnb:97');

    if (network === 'solana:devnet') {
      return await verifySolanaServiceOnChain(service);
    }

    const chainId = normalizeChainId(network);
    const client = getAgentPublicClientForChain(chainId);

    // 1. Verify RPC Chain ID matches expected chain
    const rpcChainId = await client.getChainId();
    if (rpcChainId !== chainId) {
      return {
        isVerified: false,
        reason: `RPC network mismatch: expected chain ID ${chainId}, detected ${rpcChainId}`,
      };
    }

    const registryAddress = getServiceRegistryAddress(chainId);
    if (!registryAddress) {
      return {
        isVerified: false,
        reason: `VeilServiceRegistry contract address is not configured for chain ID ${chainId}`,
      };
    }

    // 2. Format bytes32 service ID
    const serviceBytes32Id = formatServiceRegistryId(service.id);

    // 3. Query contract serviceExists
    const exists = await client.readContract({
      address: registryAddress,
      abi: VEIL_SERVICE_REGISTRY_ABI,
      functionName: 'serviceExists',
      args: [serviceBytes32Id],
    });

    if (!exists) {
      return {
        isVerified: false,
        onChainServiceId: serviceBytes32Id,
        reason: `Service ID not found in on-chain VeilServiceRegistry (${chainId === 84532 ? 'Base Sepolia' : 'BNB Testnet'})`,
      };
    }

    // 4. Retrieve contract ServiceRecord
    const record = (await client.readContract({
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

    // 8. Recompute canonical metadata hash (with the stored createdAt) and verify integrity
    const recomputedHash = computeListingMetadataHash(service);
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
      network: chainId === 84532 ? 'base:84532' : 'bnb:97',
    };
  } catch (err: any) {
    return {
      isVerified: false,
      reason: err?.message || 'Failed to query on-chain registry',
    };
  }
}
