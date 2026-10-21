import type { Address } from 'viem';

/**
 * Known VEILIO testnet deployments. Every client accepts an explicit
 * `contractAddress`, so these are defaults only; override them when you
 * point the SDK at your own deployment.
 */
export const VEILIO_DEPLOYMENTS = {
  bnbTestnet: {
    chainId: 97,
    auction: '0xae24bceed5f7BFb662AE170CA4C8bB4Fd4209FEf' as Address,
    serviceEscrow: '0x16121bD0CA81867aF5395430C1d640154C7cB36A' as Address,
    serviceRegistry: '0x016A23A069180587d5D8B09413e97E1e78ccD702' as Address,
  },
  baseSepolia: {
    chainId: 84532,
    auction: '0xbac318dE378Ac19d5aBB93076feAa131eE649Bc6' as Address,
    serviceEscrow: '0xcF7364F64a161f2460cFbFC707dDa51baFb8131F' as Address,
    serviceRegistry: '0x74a6Bf3ed462898F7b3E13e7F4d1c444570bCb88' as Address,
  },
} as const;
