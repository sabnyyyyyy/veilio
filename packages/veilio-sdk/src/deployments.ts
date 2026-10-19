import type { Address } from 'viem';

/**
 * Known VEILIO testnet deployments. Every client accepts an explicit
 * `contractAddress`, so these are defaults only; override them when you
 * point the SDK at your own deployment.
 */
export const VEILIO_DEPLOYMENTS = {
  bnbTestnet: {
    chainId: 97,
    auction: '0x9e2d9Dcc76192b54eBF0106da09787428eAF3EE7' as Address,
    serviceEscrow: '0xEd83D9f97c01a94d235927704638d6e765501f50' as Address,
    serviceRegistry: '0x016A23A069180587d5D8B09413e97E1e78ccD702' as Address,
  },
  baseSepolia: {
    chainId: 84532,
    auction: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1' as Address,
    serviceEscrow: '0x9679f83560076921f364574Ff341c37B7fcFd9A4' as Address,
    serviceRegistry: '0x74a6Bf3ed462898F7b3E13e7F4d1c444570bCb88' as Address,
  },
} as const;
