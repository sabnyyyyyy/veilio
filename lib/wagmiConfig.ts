import { createConfig, fallback, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { baseSepoliaChain, bnbChain } from './chain';

export const wagmiConfig = createConfig({
  chains: [bnbChain, baseSepoliaChain],
  connectors: [
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [bnbChain.id]: fallback([
      http(bnbChain.rpcUrls.default.http[0]),
      http('https://bsc-testnet-rpc.publicnode.com'),
      http('https://data-seed-prebsc-2-s1.bnbchain.org:8545'),
      http('https://data-seed-prebsc-1-s1.bnbchain.org:8545'),
    ]),
    [baseSepoliaChain.id]: fallback([
      http(baseSepoliaChain.rpcUrls.default.http[0]),
      http('https://sepolia.base.org'),
    ]),
  },
});
