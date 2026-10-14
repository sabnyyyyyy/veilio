# veilioexchange

TypeScript SDK for **VEILIO**: sealed-bid auctions for digital assets and milestone service escrow, built on [viem](https://viem.sh).

- **Networks:** BNB Smart Chain Testnet (97), Base Sepolia (84532) and Solana Devnet. Testnet only.
- **Formats:** ESM and CommonJS, with TypeScript types.
- **Runtime:** Node.js 18+ or any modern browser.

```sh
npm install veilioexchange viem
```

`viem` is a peer dependency, so your app and the SDK share one copy.

## Auctions

```ts
import { createPublicClient, createWalletClient, http } from 'viem';
import { bscTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createVeilioAgent } from 'veilioexchange';

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: bscTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: bscTestnet, transport: http() });

const agent = createVeilioAgent({
  publicClient,
  walletClient,
  account: account.address,
  chainId: 97, // default; 84532 = Base Sepolia (use viem's baseSepolia clients)
  apiBaseUrl: 'https://your-veilio-host', // needed for searchAssets / getAssetDetails
});

const { auctions } = await agent.listAuctions({ limit: 20 });
const auctionId = auctions[0].id;

// Sealed bid: random 32-byte secret + keccak256 commitment, computed locally.
const bid = agent.prepareBid(auctionId, '0.05'); // max bid in BNB
// Store `bid` (including bid.secret) somewhere durable and encrypted.
// If the secret is lost the bid can never be revealed.

await agent.commitBid(bid, '0.08');   // deposit >= max bid; over-deposit to hide your ceiling
await agent.revealBid(bid);           // during the Revealing window

// After revealEndTime anyone can settle; a winner moves the auction into Inspection.
await agent.waitForTransaction(await agent.settleAuction(auctionId));

const result = await agent.getAuctionResult(auctionId);
if (result.isWinner) {
  if (await agent.isNftAuction(auctionId)) {
    // NFT auctions: acceptDataset is blocked on-chain. Once inspection ends,
    // finalizeSettlement() delivers the NFT and pays the seller (anyone can call it).
    await agent.finalizeSettlement(auctionId);
  } else {
    await agent.claimAsset(auctionId);                          // acceptDataset
    // or dispute during inspection: agent.requestRefund(auctionId, 'ipfs://QmEvidence')
  }
}

// Losing deposits, over-deposits, seller proceeds and approved refunds are pull payments:
if ((await agent.getPendingRefund()) > 0n) await agent.withdrawRefund();
```

### Auction lifecycle (VeilNFTV4)

| Step | Method | Who | When |
|---|---|---|---|
| Commit | `commitBid(bid, deposit)` | bidder | Bidding |
| Reveal | `revealBid(bid)` | bidder | Revealing, before `revealEndTime` |
| Settle | `settleAuction(id)` | anyone | after `revealEndTime` |
| Accept (datasets only) | `claimAsset(id)` | winner | Inspection, before `inspectionEndTime` |
| Dispute | `requestRefund(id, evidenceHash)` | winner | Inspection, before `inspectionEndTime` |
| Complete (required for NFTs) | `finalizeSettlement(id)` | anyone | Inspection, after `inspectionEndTime` |
| Withdraw | `withdrawRefund()` | anyone with `getPendingRefund() > 0` | any time |

All write methods return the transaction hash; `waitForTransaction(hash)` waits and throws `TRANSACTION_REVERTED` on failure.
Every write checks that `walletClient.chain` matches the agent's `chainId` and throws `CHAIN_MISMATCH` before sending otherwise.
A refund request on the EVM contracts has no timeout: it stays open until the VEILIO reviewer resolves it.

## Services escrow

```ts
import { createVeilioServicesClient, signServiceAuth } from 'veilioexchange';

const services = createVeilioServicesClient({
  publicClient,
  walletClient,
  account: account.address,
  chainId: 97, // or 84532 for Base Sepolia (use matching viem clients)
});

const orderId = 'srv-order-uuid-101';

const deposit = await services.deposit({
  orderId,
  seller: '0xSeller...',
  deadline: Math.floor(Date.now() / 1000) + 3 * 86400,
  amount: '0.25',
});
await deposit.wait();

const order = await services.getOrder(orderId);      // status: 'Funded'
await (await services.submitDelivery(orderId, 'ipfs://QmProof')).wait(); // seller
await (await services.releaseFunds(orderId)).wait(); // buyer; 5% fee on release

// Fee-free exits: services.refund(orderId, reason), services.refundTimeout(orderId),
// services.dispute(orderId, reason)
// Seller agreed a lower price after funding: return the difference, the order keeps running
// await services.partialRefund(orderId, '0.03', 'Agreed lower price')  // amount refunded, not the new price
```

### Keeping the VEILIO app in sync (off-chain API)

The escrow contract moves funds, but the order status in the VEILIO app only changes when the API
is told about each step. `createVeilioServicesApi` signs every call with `signServiceAuth` (EIP-191):

```ts
import { createVeilioServicesApi } from 'veilioexchange';

const api = createVeilioServicesApi({ apiBaseUrl: 'https://your-veilio-host', signer: account });

await api.notifyDeposit({ orderId, txHash: deposit.txHash });              // buyer -> InProgress
const delivery = await services.submitDelivery(orderId, 'ipfs://QmProof');  // seller, on-chain first
await delivery.wait();
await api.submit({ orderId, deliveryTxHash: delivery.txHash, description: 'v1 delivered', deliverableReferences: ['ipfs://QmProof'] });
await api.requestRevision({ orderId, feedback: 'Please add the appendix' }); // buyer
await api.approve({ orderId, releaseTxHash: release.txHash });            // buyer -> Completed
await api.cancel({ orderId, reason: 'Mutual cancellation', txHash });     // funded orders need the refund tx
await api.partialRefund({ orderId, txHash: partial.txHash });               // seller, after services.partialRefund
```

No `network` field is sent: the server derives the chain from the order. `submit` requires the
confirmed on-chain `submitDelivery` transaction (`deliveryTxHash`); the server checks its
`DeliverySubmitted` event. For custom requests, `signServiceAuth(account, action, orderId)` returns
the `{ address, signature, timestamp, nonce }` payload.

Reads use a 30-minute session signed once (`signServiceSession`) and sent in the `x-veilio-auth`
header; the helper caches it and re-signs a minute before expiry. It never authorizes state changes.

```ts
const { order } = await api.getOrder(orderId);        // status, paymentStatus, network
const { conversations } = await api.listConversations();
await api.getPaymentRequest(paymentRequestId);
await api.getConversationMessages(conversationId);
const headers = await api.getSessionHeaders();        // for your own GET requests
```

## Solana Devnet

Solana lives in its own entry point so EVM-only users never load `@solana/web3.js`:

```sh
npm install veilioexchange @solana/web3.js
```

```ts
import { Connection, Keypair, clusterApiUrl } from '@solana/web3.js';
import { createVeilioSolanaClient, keypairSigner } from 'veilioexchange/solana';

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
const agentKey = Keypair.fromSecretKey(/* load your devnet key from a secret store */);

const solana = createVeilioSolanaClient({
  connection,
  signer: keypairSigner(agentKey), // or a Phantom provider: window.phantom.solana
  platformReviewer: 'VeilioReviewerWallet...',  // default dispute reviewer for deposit()
  platformFeeRecipient: 'VeilioFeeWallet...',   // default fee recipient for deposit()
});

// Sealed-bid auction
const auctions = await solana.listAuctions();
const bid = solana.prepareBid(auctions[0].auctionId, '0.25'); // max bid in SOL
// Store `bid` (salt included) in encrypted storage before committing.
await solana.commitBid(bid, '0.3');
await solana.revealBid(bid);
await solana.settleAuction(bid.auctionId);              // anyone, after reveal_end_time
// Winner during inspection: solana.acceptDataset(id, seller) or solana.requestRefund(id, sha256Hex)
// Anyone after inspection:  solana.finalizeInspectionTimeout(id)  (pays the seller)
// Winner, reviewer silent for 7 days: solana.finalizeRefundTimeout(id)
await solana.claimRefund(bid.auctionId);                // losing bidders reclaim deposits

// Service escrow (reviewer / feeRecipient default to the platform options above)
await solana.deposit({
  orderId: 'ord-1739-abc12',     // up to 32 bytes, or 32-byte hex
  seller: 'SellerBase58...',
  amountSol: '1.5',
  deadline: Math.floor(Date.now() / 1000) + 3 * 86400,
});
await solana.submitDelivery('ord-1739-abc12', 'ipfs://QmProof'); // seller
await solana.releaseFunds('ord-1739-abc12');                     // buyer
```

Solana support needs Node.js 18+ (it uses `node:crypto`). Base58 addresses are case-sensitive; never lowercase them.

> **Reviewer risk (Solana escrow).** The deployed escrow program stores whatever `reviewer` and
> `feeRecipient` the buyer passes to `deposit`; there is no on-chain platform config yet. A reviewer
> controlled by one party can resolve a dispute 100% in its favour. The SDK defaults both to
> `platformReviewer` / `platformFeeRecipient` and rejects a reviewer equal to the buyer or seller,
> but a buyer using another client can still pick any wallet. Sellers should check
> `(await solana.getEscrowOrder(id))?.reviewer` before starting work.

| Program (Devnet) | ID |
|---|---|
| Auction | `5Tw1iJGN1hhyRzepbD5eLoaRoZTEiKcqrh2HoZYhYEta` |
| Service escrow | `5Vj4y8BT74PDe5VwLuDp9agTR5ak4vtZdwxnBfRW3R8s` |

## Contract addresses

Defaults live in `VEILIO_DEPLOYMENTS` (also `getVeilioDeployment(chainId)`) and are picked by `chainId`. Every client takes a `contractAddress` option to point at your own deployment. Both EVM auction addresses are `VeilNFTV4`.

| Network | Auction | Service escrow |
|---|---|---|
| BNB Testnet (97) | `0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1` | `0x794f1610B5588a55B19D8c82e4381448a388C965` |
| Base Sepolia (84532) | `0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1` | `0x794f1610B5588a55B19D8c82e4381448a388C965` |

## Errors

Failures are thrown as `VeilioSdkError` with a typed `code` (`INVALID_INPUT`, `CHAIN_MISMATCH`, `WALLET_REQUIRED`, `TRANSACTION_REVERTED`, ...) and a `retryable` flag.

## Security

- Use a dedicated testnet wallet for agents and load its key from the environment. Never commit it.
- Bid deposits and bidder addresses are public on-chain; only the bid value is sealed until reveal.

## License

MIT
