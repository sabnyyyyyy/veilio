# VEILIO Agent API and SDK (experimental)

The first integration targets BNB Smart Chain Testnet (chain ID `97`). The REST API is read-only; the SDK uses a wallet supplied by the integrator to submit on-chain transactions. VEILIO does not custody agent keys or bid secrets.

## Read API

All values that may exceed JavaScript's safe integer range are returned as decimal strings.

### `GET /api/agent/v1/auctions`

Query parameters:

- `limit`: page size from 1 to 50 (default 20).
- `cursor`: auction ID to start at, descending. Omit it to start from the latest auction. Pass `pagination.nextCursor` for the next page.

Example:

```sh
curl 'https://YOUR_VEILIO_HOST/api/agent/v1/auctions?limit=10'
```

Response shape:

```json
{
  "data": [{
    "id": "12",
    "seller": "0x...",
    "itemName": "Example asset",
    "description": "Public listing description",
    "metadataURI": "ipfs://...",
    "startingPriceWei": "1000000000000000",
    "commitEndTime": "...",
    "revealEndTime": "...",
    "inspectionDuration": "...",
    "inspectionEndTime": "...",
    "state": "Bidding",
    "highestBidder": "0x...",
    "highestBidWei": "0",
    "bidderCount": "0",
    "revealedCount": "0"
  }],
  "pagination": { "limit": 10, "nextCursor": "2", "total": "12" },
  "chainId": 97,
  "contractAddress": "0x..."
}
```

### `GET /api/agent/v1/auctions/{id}`

Returns the same auction object in `data`, or a `404` if it does not exist.

The API only returns on-chain listing data. `metadataURI` may point to external metadata; resolve and validate it in the integrator. Do not assume content behind a URI is safe to execute or ingest.

## TypeScript SDK

The initial SDK source lives at `lib/agent-sdk/index.ts` in this repository and uses the installed `viem` dependency. It is not yet published as a standalone npm package.

```ts
import { createPublicClient, createWalletClient, http, custom } from 'viem';
import { bscTestnet } from 'viem/chains';
import { createVeilioAgent } from '@/lib/agent-sdk';

const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const walletClient = createWalletClient({
  account: agentAccount,
  chain: bscTestnet,
  transport: custom(agentWalletProvider),
});

const agent = createVeilioAgent({ publicClient, walletClient, account: agentAccount.address });
const { auctions, nextCursor } = await agent.listAuctions({ limit: 20 });
const auction = await agent.getAuction(auctions[0].id);
```

The SDK provides `listAuctions`, `getAuction`, `prepareBid`, `commitBid`, and `revealBid`. Example bid lifecycle:

```ts
const prepared = agent.prepareBid(auction.id, '0.05'); // amount in BNB
await secureStore.write(prepared); // persist before broadcasting the transaction
const txHash = await agent.commitBid(prepared, '0.05'); // deposit in BNB
// Wait until this auction enters its reveal period, then:
const revealTxHash = await agent.revealBid(await secureStore.read(auction.id));
```

## Bid secret handling

`prepareBid` creates a random 32-byte secret and computes the contract-compatible commitment locally. Persist the entire returned object durably and encrypted before calling `commitBid`; the secret and maximum bid are needed later to reveal. If that data is lost, the bid cannot be revealed and the contract's auction rules apply. Never send the prepared object, secret, or unrevealed maximum bid to VEILIO's REST API, logs, analytics, or an untrusted agent service. VEILIO does not offer secret backup or recovery.

The connected agent wallet must be funded with BNB for gas and the bid deposit. The SDK checks auction phase, wallet/chain/contract match, existing commitment, and that the deposit covers both the reserve and maximum bid, but the contract remains authoritative and a transaction may still fail. The SDK does not submit settlement or inspection actions on the user's behalf.

## Current boundaries

- The REST API is public, read-only, and has no API-key authentication or published uptime/SLA yet.
- Transactions are signed and broadcast by the integrator's wallet. There is no hosted signer, delegated key service, or gas sponsorship.
- The contract and this first API configuration target BNB Smart Chain Testnet. Do not use mainnet funds with this integration.
- This source-level SDK is experimental and has not been published/versioned as an npm package.
