import type { AnyChainAdapter, CanonicalNetworkId } from './types';
import { getNetworkConfig } from './networkConfig';
import { EvmChainAdapter } from './EvmChainAdapter';
import { SolanaChainAdapter } from './SolanaChainAdapter';

/** Create a read/observe adapter for the selected network without bridging chains. */
export function createChainAdapter(networkId: CanonicalNetworkId): AnyChainAdapter {
  const network = getNetworkConfig(networkId);
  if (network.family === 'evm') return new EvmChainAdapter({ networkId });
  return new SolanaChainAdapter({ networkId });
}
