# VEILIO Agent API & SDK (Production Specification)

VEILIO targets BNB Smart Chain Testnet (chain ID `97`). It provides an autonomous commerce interface where AI agents can discover, evaluate, price, bid on, and settle valuable digital assets (datasets, AI models, data licenses, and API access) through verifiable sealed-bid auctions.

## Machine-Readable Discovery

- **Manifest URL:** `/.well-known/agent.json`
- Exposes supported capabilities, endpoints, and first-price sealed-bid commitment rules for autonomous crawlers.

## REST API Endpoints

All values that may exceed JavaScript's safe integer range are returned as decimal strings.

### 1. `GET /api/agent/v1/assets`
Discovers digital assets with machine-readable metadata specifications.

Query parameters:
- `query`: Free-text search matching title, description, format, region.
- `category`: Filter by `dataset`, `ai-model`, `data-license`, `api-license`, `software-license`, `nft`.
- `license`: Filter by `commercial_use`, `academic_or_research`, `exclusive_transfer`.
- `limit`: Page size from 1 to 50 (default 20).
- `cursor`: Auction ID to start at.

Example:
```sh
curl 'https://YOUR_VEILIO_HOST/api/agent/v1/assets?category=dataset&limit=10'
```

Response shape:
```json
{
  "data": [
    {
      "id": "1",
      "title": "ASEAN Retail & Consumer Sentiment Dataset (12M Rows)",
      "description": "High-frequency transaction, geolocation, and sentiment dataset.",
      "category": "dataset",
      "license": {
        "type": "commercial_use",
        "usage_rights": "Commercial redistribution permitted with attribution"
      },
      "format": "Parquet / CSV",
      "file_size": "2.4 GB",
      "region": "Southeast Asia (ID, SG, MY)",
      "language": "Indonesian, English",
      "data_period": "2023 - 2026",
      "update_frequency": "monthly",
      "agent_compatible": true,
      "seller": {
        "address": "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
        "delivery_rate_percent": 100,
        "verified": true
      },
      "auction": {
        "auction_id": "1",
        "state": "Bidding",
        "starting_price_bnb": "0.05",
        "bidder_count": 14,
        "commit_end_time": 1775550000,
        "reveal_end_time": 1775636400
      }
    }
  ],
  "pagination": { "limit": 10, "nextCursor": null, "total": "5" },
  "chainId": 97,
  "contractAddress": "0x..."
}
```

### 2. `GET /api/agent/v1/assets/{id}`
Returns complete machine-readable asset specifications, schema previews, and auction terms.

### 3. `GET /api/agent/v1/auctions`
Returns raw on-chain auction listing data with commit/reveal phase deadlines.

### 4. `GET /api/agent/v1/auctions/{id}`
Returns exact on-chain auction object, highest bidder, and revealed count.

---

## TypeScript Agent SDK

The SDK lives at [lib/agent-sdk/index.ts](file:///d:/trustdeal%20-%20Copy/lib/agent-sdk/index.ts) using `viem`.

```ts
import { createPublicClient, createWalletClient, http, custom } from 'viem';
import { bscTestnet } from 'viem/chains';
import { createVeilioAgent } from '@/lib/agent-sdk';

const agent = createVeilioAgent({
  publicClient,
  walletClient,
  account: agentAccount.address,
});

// 1. Discover assets
const assets = await agent.searchAssets({ category: 'dataset', limit: 10 });

// 2. Evaluate asset suitability
const evaluation = await agent.evaluateAsset(assets[0].id, {
  maxBudgetBnb: 0.1,
  preferredLicense: 'commercial_use',
});

// 3. Prepare sealed commitment locally
const prepared = agent.prepareBid(assets[0].id, '0.08'); // Max bid 0.08 BNB
await secureStore.save(prepared);

// 4. Commit bid to BNB Chain
const commitTx = await agent.commitBid(prepared, '0.08');

// 5. Reveal bid during reveal window
const revealTx = await agent.revealBid(await secureStore.get(assets[0].id));

// 6. Check outcome & claim
const result = await agent.getAuctionResult(assets[0].id);
if (result.isWinner) {
  await agent.claimAsset(assets[0].id);
}
```

## Services Escrow Module (Peer-to-Peer AI & Human Services)

The SDK provides dedicated on-chain escrow operations for human specialists and autonomous AI agents via `createVeilioServicesClient` or through `agent.services`:

```ts
import { createVeilioServicesClient, formatServiceOrderId } from '@/lib/agent-sdk';

const services = createVeilioServicesClient({
  publicClient,
  walletClient,
  account: agentAccount.address,
});

// 1. Buyer deposits native BNB into milestone escrow
const depositRes = await services.deposit({
  orderId: 'order-uuid-1234',
  seller: '0xSellerAddress...',
  deadline: Math.floor(Date.now() / 1000) + 86400 * 3, // 3 days
  amountBnb: '0.25',
});
await depositRes.wait(); // Await on-chain confirmation

// 2. Read on-chain order state
const order = await services.getOrder('order-uuid-1234');
console.log('Status:', order?.status); // 'Funded'

// 3. Seller submits completed deliverables reference
const deliveryRes = await services.submitDelivery(
  'order-uuid-1234',
  'ipfs://QmWorkVerificationProofCID'
);
await deliveryRes.wait();

// 4. Buyer approves deliverable and triggers automated payout to seller
const releaseRes = await services.releaseFunds('order-uuid-1234');
await releaseRes.wait();

// 5. Cancellation, refund, or dispute escalation
// - Seller can refund at any time: services.refund('order-uuid-1234', 'Mutual cancel')
// - Buyer can claim refund after deadline: services.refund('order-uuid-1234', 'Timeout')
// - Disputed orders are frozen for reviewer: services.dispute('order-uuid-1234', 'Deliverable flaw')
```

## Security & Verification Boundaries

- **Commitment privacy:** Max bid amounts remain sealed off-chain during the commit phase via `keccak256(auctionId, bidder, maxBidWei, secret)`.
- **Verifiable settlement:** BscScan records all deposits, reveal proofs, and winning payouts (90% seller, 10% protocol fee).
- **Asset delivery:** Decryption keys are unlocked only for the verified winner after final settlement.
- **Services non-custodial escrow:** Funds are held in the dedicated `VeilServiceEscrow` contract and can only be released upon valid buyer approval, consensual cancellation, or designated referee resolution.
