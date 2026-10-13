/**
 * Live Read-Only Solana Devnet RPC Connectivity Check
 * 
 * Verifies live connectivity, slot height, and cluster identity against Solana Devnet
 * without submitting any transactions or requiring private keys.
 */

import { SolanaChainAdapter } from '../lib/cross-chain/SolanaChainAdapter';

async function main() {
  console.log('--- VEILIO Live Solana Devnet Read-Only Check ---');
  const adapter = new SolanaChainAdapter({ networkId: 'solana:devnet' });

  console.log('Cluster:', adapter.getCluster());
  console.log('RPC Endpoint:', adapter.getRpcUrl());

  const health = await adapter.checkHealth();
  console.log('Health Check Status:', health.ok ? 'HEALTHY' : 'UNAVAILABLE');
  console.log('Live Finalized Slot:', health.slot.toString());

  if (!health.ok) {
    console.error('Failed to connect to live Solana Devnet RPC');
    process.exit(1);
  }

  console.log('Live Solana Devnet read-only verification succeeded.');
}

main().catch((err) => {
  console.error('Error during live Devnet check:', err);
  process.exit(1);
});
