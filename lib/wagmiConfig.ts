import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { bnbChain } from './chain';

export const wagmiConfig = createConfig({
  chains: [bnbChain],
  connectors: [
    injected({ shimDisconnect: true }),
  ],
  transports: {
    // Keep wallet reads (including native balance) on the same BNB Testnet RPC
    // used by the app's contract clients. A different chain here can return a
    // plausible balance while the UI incorrectly labels it as BNB Testnet.
    [bnbChain.id]: http(bnbChain.rpcUrls.default.http[0]),
  },
});
