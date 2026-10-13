import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { baseSepoliaChain, bnbChain } from './chain';

export const wagmiConfig = createConfig({
  chains: [bnbChain, baseSepoliaChain],
  connectors: [
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [bnbChain.id]: http(bnbChain.rpcUrls.default.http[0]),
    [baseSepoliaChain.id]: http(baseSepoliaChain.rpcUrls.default.http[0]),
  },
});
