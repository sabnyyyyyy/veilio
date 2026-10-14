// Lists one service exactly like app/services/create/page.tsx does, signing with TEST_SELLER_PRIVATE_KEY (BNB Testnet).
// Run from the project root with the dev server on :3000:
//   node --env-file=.env.local node_modules/jiti/lib/jiti-cli.mjs scripts/list-test-service.ts
// If the registry tx succeeded but the API sync failed, resync without a new transaction:
//   ... scripts/list-test-service.ts --resume <registryTxHash>
import { createWalletClient, createPublicClient, http, fallback, hexToString, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { VEIL_SERVICE_REGISTRY_ABI, getServiceRegistryAddress } from '../lib/serviceContract';
import { buildCanonicalMetadata, hashCanonicalMetadata, formatServiceRegistryId } from '../lib/serviceRegistry';
import { createServiceAuthMessage, generateAuthNonce } from '../lib/serviceAuth';

// 127.0.0.1, not localhost: Node resolves localhost to ::1 while `next dev` listens on IPv4.
const API = process.env.VEILIO_API_URL || 'http://127.0.0.1:3000/api/services';

const listing = {
  sellerType: 'human' as const,
  sellerName: 'VEILIO Test Seller',
  title: 'Dataset Cleaning & Schema Validation',
  description: 'Deduplicate, normalize and validate CSV/Parquet datasets up to 1M rows. Delivers a cleaned file plus a schema report.',
  category: 'Data Engineering',
  price: String(Number('0.001')),
  currency: 'BNB',
  deliveryTime: '3 Days',
  sampleDeliverables: ['Cleaned dataset (Parquet)', 'Schema & data-quality report (PDF)'],
};

const raw = process.env.TEST_SELLER_PRIVATE_KEY?.trim();
if (!raw) throw new Error('TEST_SELLER_PRIVATE_KEY missing');
const account = privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`);
const transport = fallback([http('https://bsc-testnet-rpc.publicnode.com'), http('https://data-seed-prebsc-2-s1.bnbchain.org:8545')]);
const wallet = createWalletClient({ account, chain: bscTestnet, transport });
const pub = createPublicClient({ chain: bscTestnet, transport });
const registry = getServiceRegistryAddress(97);

const hashFor = (id: string, createdAt: number) =>
  hashCanonicalMetadata(buildCanonicalMetadata({ id, seller: account.address, ...listing, createdAt }));

async function register() {
  const id = `srv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const createdAt = Date.now();
  const metadataHash = hashFor(id, createdAt);
  const metadataURI = `ipfs://QmServiceMeta-${id}`;
  console.log('service ', id);

  const txHash = await wallet.writeContract({
    address: registry,
    abi: VEIL_SERVICE_REGISTRY_ABI,
    functionName: 'registerService',
    args: [formatServiceRegistryId(id), metadataHash, metadataURI],
  });
  console.log('tx      ', txHash);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log('receipt ', receipt.status, 'block', receipt.blockNumber.toString());
  if (receipt.status !== 'success') throw new Error('registerService reverted');
  return { id, createdAt, metadataHash, metadataURI, txHash };
}

/** Rebuilds the submission from an already-mined registry tx (createdAt is recovered by matching the on-chain hash). */
async function recover(txHash: `0x${string}`) {
  const receipt = await pub.getTransactionReceipt({ hash: txHash });
  const [event] = parseEventLogs({ abi: VEIL_SERVICE_REGISTRY_ABI, logs: receipt.logs, eventName: 'ServiceRegistered' }) as any[];
  if (!event) throw new Error('No ServiceRegistered event in tx');
  const id = hexToString(event.args.serviceId, { size: 32 }).replace(/\0+$/, '');
  const metadataHash = String(event.args.metadataHash).toLowerCase();
  const idTs = Number(id.split('-')[1]);
  for (let createdAt = idTs - 5; createdAt <= idTs + 60_000; createdAt++) {
    if (hashFor(id, createdAt).toLowerCase() === metadataHash) {
      console.log('service ', id, '(recovered)');
      return { id, createdAt, metadataHash, metadataURI: String(event.args.metadataURI), txHash };
    }
  }
  throw new Error('Could not recover createdAt — listing fields differ from the registered metadata');
}

async function main() {
  console.log('seller  ', account.address);
  console.log('registry', registry);
  const resumeIdx = process.argv.indexOf('--resume');
  const reg = resumeIdx > -1 ? await recover(process.argv[resumeIdx + 1] as `0x${string}`) : await register();

  const timestamp = Date.now();
  const nonce = generateAuthNonce();
  const signature = await account.signMessage({
    message: createServiceAuthMessage({ action: 'create-service', orderId: reg.id, address: account.address, timestamp, nonce }),
  });

  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: reg.id, sellerId: account.address, ...listing, network: 'bnb:97', createdAt: reg.createdAt,
      txHash: reg.txHash, metadataHash: reg.metadataHash, metadataURI: reg.metadataURI,
      auth: { address: account.address, signature, timestamp, nonce },
    }),
  });
  const body = await res.json();
  console.log('api     ', res.status, JSON.stringify({ success: body.success, onChainVerified: body.onChainVerified, error: body.error, id: body.service?.id }));
}

main().catch((e) => {
  console.error('FAILED:', e?.shortMessage || e?.message || e);
  if (e?.details) console.error('details:', e.details);
  process.exit(1);
});
