import type { Chain } from 'viem';
import { baseSepoliaChain, bnbChain } from '../chain';
import type { CanonicalNetworkId } from './types';
import { getNetworkConfig } from './networkConfig';

/** Returns the exact Viem chain definition for an EVM network in the registry. */
export function getEvmChain(networkId: CanonicalNetworkId): Chain {
  const network = getNetworkConfig(networkId);
  if (network.family !== 'evm') {
    throw new Error(`Network ${networkId} is not an EVM network`);
  }

  switch (networkId) {
    // Preserve the original BNB chain definition used by the submitted deployment.
    case 'bnb:97':
      return bnbChain;
    case 'base:84532':
      return baseSepoliaChain;
    default:
      throw new Error(`No EVM client definition is available for ${networkId}`);
  }
}
