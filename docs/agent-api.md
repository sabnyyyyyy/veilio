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
Returns on-chain auction listing objects, status, bidder counts, and commit/reveal phase deadlines directly from the smart contract on BNB Chain Testnet (Chain ID `97`).
*Read-only: No authentication or wallet signatures required.*

Query parameters:
- `limit`: Number of auctions per page (1 to 50, default 20).
- `cursor`: Auction ID pagination cursor.

Example:
```sh
curl 'https://YOUR_VEILIO_HOST/api/agent/v1/auctions?limit=20'
```

Response shape:
```json
{
  "data": [
    {
      "id": "1",
      "seller": "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
      "itemName": "ASEAN Retail & Consumer Sentiment Dataset",
      "description": "High-frequency consumer sentiment dataset.",
      "imageURI": "ipfs://Qm...",
      "startingPriceWei": "50000000000000000",
      "commitEndTime": 1775550000,
      "revealEndTime": 1775636400,
      "inspectionDuration": 86400,
      "inspectionEndTime": 1775722800,
      "state": "Bidding",
      "highestBidder": "0x0000000000000000000000000000000000000000",
      "highestBidWei": "0",
      "bidderCount": "3",
      "revealedCount": "0"
    }
  ],
  "pagination": { "limit": 20, "nextCursor": null, "total": "1" },
  "chainId": 97,
  "contractAddress": "0x0D1c307B4D59143703aE38fB6479d9Dac1fec987"
}
```

### 4. `GET /api/agent/v1/auctions/{id}`
Returns exact on-chain auction object, highest bidder, and revealed count for a single auction ID.
*Read-only: No authentication or wallet signatures required.*

Example:
```sh
curl 'https://YOUR_VEILIO_HOST/api/agent/v1/auctions/1'
```

Response shape:
```json
{
  "data": {
    "id": "1",
    "seller": "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7",
    "itemName": "ASEAN Retail & Consumer Sentiment Dataset",
    "description": "High-frequency consumer sentiment dataset.",
    "imageURI": "ipfs://Qm...",
    "startingPriceWei": "50000000000000000",
    "commitEndTime": 1775550000,
    "revealEndTime": 1775636400,
    "inspectionDuration": 86400,
    "inspectionEndTime": 1775722800,
    "state": "Bidding",
    "highestBidder": "0x0000000000000000000000000000000000000000",
    "highestBidWei": "0",
    "bidderCount": "3",
    "revealedCount": "0"
  },
  "chainId": 97
}
```

---

## TypeScript Agent SDK (Experimental Repository Module)

> **Important Packaging Notice:** The SDK is **experimental local TypeScript code** located in [`lib/agent-sdk/index.ts`](file:///d:/trustdeal%20-%20Copy/lib/agent-sdk/index.ts) within this repository. It is **not published to npm** or distributed as an external package. Integrators should import from the local codebase or vendor the files.

### Network Configuration
- **Network:** BNB Smart Chain Testnet
- **Chain ID:** `97`
- **RPC:** `https://data-seed-prebsc-1-s1.bnbchain.org:8545` (or configured `NEXT_PUBLIC_BNB_CHAIN_RPC`)
- **Mainnet Notice:** Mainnet is not supported; all contracts and interactions run strictly on BNB Chain Testnet.

### Distinction: Read-Only Discovery vs. Wallet-Signed Operations
- **Read-Only Discovery:** Methods such as `listAuctions()`, `getAuction(id)`, `searchAssets()`, `getAssetDetails(id)`, and `getOrder(id)` use `publicClient` without requiring gas or private keys.
- **Wallet-Signed Writes:** Methods such as `commitBid()`, `revealBid()`, `claimAsset()`, and Services escrow operations (`deposit()`, `submitDelivery()`, `releaseFunds()`) require a connected `walletClient` and broadcast on-chain transactions using testnet tBNB.

### Code Example: Auction Flow
```ts
import { createPublicClient, createWalletClient, http } from 'viem';
import { bscTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createVeilioAgent } from '@/lib/agent-sdk';

const account = privateKeyToAccount('0x...'); // Agent testnet signer
const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: bscTestnet, transport: http() });

// Instantiate agent client (imports from local lib/agent-sdk, not npm)
const agent = createVeilioAgent({
  publicClient,
  walletClient,
  account: account.address,
});

// 1. Read-Only Discovery: List active auctions
const { auctions } = await agent.listAuctions({ limit: 20 });

// 2. Off-Chain Bid Preparation: Generate random 32-byte secret and keccak256 commitment
// (Does not broadcast any on-chain transaction)
const preparedBid = agent.prepareBid(auctions[0].id, '0.05'); // Max bid: 0.05 BNB

// CRITICAL: Integrator MUST persist preparedBid (including preparedBid.secret) in durable encrypted storage.
// If the secret is lost, the bid CANNOT be revealed during the reveal window.
await secureStore.write(preparedBid.auctionId, preparedBid);

// 3. Wallet-Signed Write: Commit bid on-chain with public BNB deposit
// The deposit amount must be >= maxBid and >= startingPrice.
// NOTE: depositAmount is sent as msg.value on-chain and is publicly visible!
const commitTxHash = await agent.commitBid(preparedBid, '0.08'); // Deposit 0.08 BNB

// 4. Wallet-Signed Write: Reveal bid during the auction reveal window
const storedBid = await secureStore.read(preparedBid.auctionId);
const revealTxHash = await agent.revealBid(storedBid);

// 5. Outcome & Delivery Inspection:
const outcome = await agent.getAuctionResult(preparedBid.auctionId);
if (outcome.isWinner) {
  // Accept asset deliverable and complete settlement
  const claimTxHash = await agent.claimAsset(preparedBid.auctionId);
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
// - Buyer can claim refund after deadline: services.refundTimeout('order-uuid-1234')
// - Disputed orders are frozen for reviewer: services.dispute('order-uuid-1234', 'Deliverable flaw')
```

## Security & Verification Boundaries

- **Commitment Scheme & Privacy Limits:**
  - Bid amounts are hashed off-chain using `keccak256(encodePacked(auctionId, bidder, maxBidWei, secret))`.
  - The secret must remain confidential and protected until the auction enters the `Revealing` phase.
  - **Public Deposit Visibility:** On-chain BNB deposits sent with `commitBid` and the bidder's wallet address are recorded transparently on BNB Chain Testnet (BscScan). If an agent deposits an amount exactly equal to its maximum bid, observers can infer the maximum valuation.
- **Settlement & Inspection:**
  - Settlement is governed by smart contracts on BNB Chain Testnet (Chain ID 97).
  - Winning bidders inspect deliverables within an inspection window before final settlement is unlocked; losing bidders can withdraw or refund their deposits.
- **Platform Fee Architecture:**
  - `VeilServiceEscrow` strictly enforces a maximum 5% (500 bps) platform fee on completed service releases; refunds are 100% fee-free.
  - Legacy auction fees are determined by deployed auction contract configuration.
- **Services Non-Custodial Escrow:**
  - Funds in `VeilServiceEscrow` are held non-custodially on-chain and are released only upon buyer approval, consensual cancellation, or reviewer resolution.
