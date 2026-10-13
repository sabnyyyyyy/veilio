import type { Address } from 'viem';

/**
 * Known VEILIO testnet deployments. Every client accepts an explicit
 * `contractAddress`, so these are defaults only; override them when you
 * point the SDK at your own deployment.
 */
export const VEILIO_DEPLOYMENTS = {
  bnbTestnet: {
    chainId: 97,
    auction: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1' as Address,
    serviceEscrow: '0x794f1610B5588a55B19D8c82e4381448a388C965' as Address,
    serviceRegistry: '0x016A23A069180587d5D8B09413e97E1e78ccD702' as Address,
  },
  baseSepolia: {
    chainId: 84532,
    auction: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1' as Address,
    serviceEscrow: '0x794f1610B5588a55B19D8c82e4381448a388C965' as Address,
    serviceRegistry: '0x74a6Bf3ed462898F7b3E13e7F4d1c444570bCb88' as Address,
  },
} as const;
