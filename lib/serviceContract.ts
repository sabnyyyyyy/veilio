import VeilServiceEscrowArtifact from './abi/VeilServiceEscrow.json';
import VeilServiceRegistryArtifact from './abi/VeilServiceRegistry.json';
import { VEILIO_SERVICES_CONTRACT_ADDRESS } from './agent-sdk';
import { baseSepoliaChain } from './chain';

// ============================================================================
// BNB Chain Testnet (Default / Legacy Baseline)
// ============================================================================
export const VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS = VEILIO_SERVICES_CONTRACT_ADDRESS;
export const VEIL_SERVICE_ESCROW_ABI = VeilServiceEscrowArtifact.abi;

export const VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_ADDRESS ||
  process.env.SERVICE_REGISTRY_CONTRACT_ADDRESS ||
  '0x016A23A069180587d5D8B09413e97E1e78ccD702'
) as `0x${string}`;

export const VEIL_SERVICE_REGISTRY_ABI = VeilServiceRegistryArtifact.abi;

// ============================================================================
// Base Sepolia Testnet (Chain ID 84532)
// ============================================================================
export const BASE_SEPOLIA_SERVICE_ESCROW_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_SERVICE_ESCROW_ADDRESS ||
  process.env.BASE_SEPOLIA_SERVICE_ESCROW_ADDRESS ||
  '0x9679f83560076921f364574Ff341c37B7fcFd9A4'
) as `0x${string}`;

export const BASE_SEPOLIA_SERVICE_REGISTRY_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_SERVICE_REGISTRY_ADDRESS ||
  process.env.BASE_SEPOLIA_SERVICE_REGISTRY_ADDRESS ||
  '0x74a6Bf3ed462898F7b3E13e7F4d1c444570bCb88'
) as `0x${string}`;

// ============================================================================
// Network-Aware Contract Configuration Resolvers
// ============================================================================

export function normalizeChainId(chainIdOrNetwork: number | string): number {
  if (typeof chainIdOrNetwork === 'number') return chainIdOrNetwork;
  if (chainIdOrNetwork === 'bnb:97' || chainIdOrNetwork === '97' || chainIdOrNetwork === 'bnb') return 97;
  if (chainIdOrNetwork === 'base:84532' || chainIdOrNetwork === '84532' || chainIdOrNetwork === 'base') return 84532;
  const parsed = parseInt(chainIdOrNetwork, 10);
  return isNaN(parsed) ? 97 : parsed;
}

export function getServiceEscrowAddress(chainIdOrNetwork: number | string = 97): `0x${string}` {
  const chainId = normalizeChainId(chainIdOrNetwork);
  if (chainId === baseSepoliaChain.id) {
    return BASE_SEPOLIA_SERVICE_ESCROW_CONTRACT_ADDRESS;
  }
  return VEIL_SERVICE_ESCROW_CONTRACT_ADDRESS;
}

export function getServiceRegistryAddress(chainIdOrNetwork: number | string = 97): `0x${string}` {
  const chainId = normalizeChainId(chainIdOrNetwork);
  if (chainId === baseSepoliaChain.id) {
    return BASE_SEPOLIA_SERVICE_REGISTRY_CONTRACT_ADDRESS;
  }
  return VEIL_SERVICE_REGISTRY_CONTRACT_ADDRESS;
}

export function getServiceEscrowContractConfig(chainIdOrNetwork: number | string = 97) {
  const address = getServiceEscrowAddress(chainIdOrNetwork);
  return {
    address,
    abi: VEIL_SERVICE_ESCROW_ABI,
  } as const;
}

export function getServiceRegistryContractConfig(chainIdOrNetwork: number | string = 97) {
  const address = getServiceRegistryAddress(chainIdOrNetwork);
  return {
    address,
    abi: VEIL_SERVICE_REGISTRY_ABI,
  } as const;
}
