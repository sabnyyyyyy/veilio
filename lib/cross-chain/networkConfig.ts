/**
 * VEILIO Cross-Chain Network Configuration Registry
 * 
 * Central registry of supported networks, RPC endpoints, and contract/program addresses.
 * Adheres strictly to the network registry schema without exposing secrets.
 */

import { CanonicalNetworkId, ChainFamily, NetworkEnvironment } from './types';

// Keep in sync with lib/contract.ts (VEIL_V3_CONTRACT_ADDRESS): the active BNB
// auction is VeilNFTV4, which is also the NFT custody contract.
const BNB_TESTNET_AUCTION_ADDRESS =
  process.env.NEXT_PUBLIC_V4_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_V3_CONTRACT_ADDRESS ||
  '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1';

export interface NetworkConfig {
  readonly networkId: CanonicalNetworkId;
  readonly family: ChainFamily;
  readonly displayName: string;
  readonly environment: NetworkEnvironment;
  readonly nativeCurrency: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly rpcEndpoints: string[];
  readonly explorerUrl: string;
  readonly contracts: {
    readonly auction?: string;
    readonly serviceEscrow?: string;
    readonly serviceRegistry?: string;
    readonly nftCustody?: string;
    readonly messageEmitter?: string;
  };
  readonly finalityConfig: {
    readonly requiredConfirmations: number;
    readonly targetSlotCommitment?: 'confirmed' | 'finalized';
  };
  readonly verificationStatus: 'verified_active' | 'in_development' | 'planned';
  /** Actual VEILIO application capability on this network, separate from RPC health. */
  readonly marketplaceCapability: 'live' | 'rpc_monitoring' | 'not_deployed' | 'integration_pending';
}

export const NETWORK_REGISTRY: Record<CanonicalNetworkId, NetworkConfig> = {
  'bnb:97': {
    networkId: 'bnb:97',
    family: 'evm',
    displayName: 'BNB Smart Chain Testnet',
    environment: 'testnet',
    nativeCurrency: {
      name: 'Test BNB',
      symbol: 'tBNB',
      decimals: 18,
    },
    rpcEndpoints: [
      process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
      'https://data-seed-prebsc-2-s1.bnbchain.org:8545',
    ],
    explorerUrl: 'https://testnet.bscscan.com',
    contracts: {
      auction: BNB_TESTNET_AUCTION_ADDRESS,
      serviceEscrow: process.env.NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS || '0xEd83D9f97c01a94d235927704638d6e765501f50',
      serviceRegistry: process.env.NEXT_PUBLIC_SERVICE_REGISTRY_CONTRACT_ADDRESS || '0x016A23A069180587d5D8B09413e97E1e78ccD702',
      nftCustody: BNB_TESTNET_AUCTION_ADDRESS,
    },
    finalityConfig: {
      requiredConfirmations: 15, // Reorg protection for EVM
    },
    verificationStatus: 'verified_active',
    marketplaceCapability: 'live',
  },
  'bnb:56': {
    networkId: 'bnb:56',
    family: 'evm',
    displayName: 'BNB Smart Chain Mainnet',
    environment: 'mainnet',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
    },
    rpcEndpoints: ['https://bsc-dataseed.binance.org'],
    explorerUrl: 'https://bscscan.com',
    contracts: {},
    finalityConfig: {
      requiredConfirmations: 15,
    },
    verificationStatus: 'in_development',
    marketplaceCapability: 'integration_pending',
  },
  'base:84532': {
    networkId: 'base:84532',
    family: 'evm',
    displayName: 'Base Sepolia',
    environment: 'testnet',
    nativeCurrency: {
      name: 'Base Sepolia ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcEndpoints: [
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    ],
    explorerUrl: 'https://sepolia.basescan.org',
    contracts: {
      auction: process.env.NEXT_PUBLIC_BASE_SEPOLIA_AUCTION_ADDRESS || '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
      serviceEscrow: process.env.NEXT_PUBLIC_BASE_SEPOLIA_SERVICE_ESCROW_ADDRESS || '0x9679f83560076921f364574Ff341c37B7fcFd9A4',
      serviceRegistry: process.env.NEXT_PUBLIC_BASE_SEPOLIA_SERVICE_REGISTRY_ADDRESS || '0x74a6Bf3ed462898F7b3E13e7F4d1c444570bCb88',
    },
    finalityConfig: {
      requiredConfirmations: 12,
    },
    verificationStatus: 'verified_active',
    marketplaceCapability: 'live',
  },
  'solana:devnet': {
    networkId: 'solana:devnet',
    family: 'solana',
    displayName: 'Solana Devnet',
    environment: 'devnet',
    nativeCurrency: {
      name: 'Solana SOL',
      symbol: 'SOL',
      decimals: 9,
    },
    rpcEndpoints: [
      process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com',
    ],
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
    contracts: {
      // Only listed when explicitly configured: entries here are also trusted as
      // Wormhole emitters. The app itself uses getSolanaAuctionProgramId().
      ...(process.env.NEXT_PUBLIC_SOLANA_AUCTION_PROGRAM_ID
        ? { auction: process.env.NEXT_PUBLIC_SOLANA_AUCTION_PROGRAM_ID }
        : {}),
      serviceRegistry: process.env.NEXT_PUBLIC_SOLANA_SERVICE_REGISTRY_PROGRAM_ID || '6CMoJyQmBobLTk4M9ZoygMShRB6A6i77e6viq2Lew2KY',
      serviceEscrow: process.env.NEXT_PUBLIC_SOLANA_SERVICE_ESCROW_PROGRAM_ID || '5Vj4y8BT74PDe5VwLuDp9agTR5ak4vtZdwxnBfRW3R8s',
    },
    finalityConfig: {
      requiredConfirmations: 31,
      targetSlotCommitment: 'finalized',
    },
    verificationStatus: 'verified_active',
    marketplaceCapability: 'live',
  },
  'solana:localnet': {
    networkId: 'solana:localnet',
    family: 'solana',
    displayName: 'Solana Local Validator',
    environment: 'localnet',
    nativeCurrency: {
      name: 'Solana SOL',
      symbol: 'SOL',
      decimals: 9,
    },
    rpcEndpoints: ['http://127.0.0.1:8899'],
    explorerUrl: 'https://explorer.solana.com/?cluster=custom&customUrl=http://127.0.0.1:8899',
    contracts: {},
    finalityConfig: {
      requiredConfirmations: 1,
      targetSlotCommitment: 'confirmed',
    },
    verificationStatus: 'in_development',
    marketplaceCapability: 'not_deployed',
  },
  'solana:mainnet': {
    networkId: 'solana:mainnet',
    family: 'solana',
    displayName: 'Solana Mainnet-Beta',
    environment: 'mainnet',
    nativeCurrency: {
      name: 'Solana SOL',
      symbol: 'SOL',
      decimals: 9,
    },
    rpcEndpoints: ['https://api.mainnet-beta.solana.com'],
    explorerUrl: 'https://explorer.solana.com',
    contracts: {},
    finalityConfig: {
      requiredConfirmations: 31,
      targetSlotCommitment: 'finalized',
    },
    verificationStatus: 'in_development',
    marketplaceCapability: 'not_deployed',
  },
};

export function getNetworkConfig(networkId: CanonicalNetworkId): NetworkConfig {
  const config = NETWORK_REGISTRY[networkId];
  if (!config) {
    throw new Error(`Unsupported network identifier: ${networkId}`);
  }
  return config;
}

export function isNetworkSupported(networkId: string): networkId is CanonicalNetworkId {
  return networkId in NETWORK_REGISTRY;
}

export function listSupportedNetworks(): NetworkConfig[] {
  return Object.values(NETWORK_REGISTRY);
}

export function listLiveMarketplaceNetworks(): NetworkConfig[] {
  return listSupportedNetworks().filter((network) => network.marketplaceCapability === 'live');
}
