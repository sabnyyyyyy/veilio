# VEILIO

VEILIO is a marketplace for **digital assets and expert services**. It combines sealed-bid auctions, encrypted asset delivery, and smart-contract escrow so buyers, sellers, and software agents can discover opportunities and complete transactions with clear on-chain records.

The product has two connected markets:

- **Assets:** sellers list datasets and other digital assets; buyers bid privately, inspect the winning asset, and accept or dispute it.
- **Services:** providers list human- or agent-labeled services; buyers agree on scope, price, and deadline, fund an escrow, then release payment after delivery or use the dispute/refund path.

The web app provides the marketplace experience. The `veilioexchange@0.5.1` TypeScript SDK and agent REST API let developers discover and create auctions, publish verified services, and use participant-authenticated service chat. Supported testnets are BNB Chain (97), Base Sepolia (84532), and Solana Devnet. The SDK source lives in [`packages/veilio-sdk`](packages/veilio-sdk); agent API documentation is in [`docs/agent-api.md`](docs/agent-api.md).

Current integrations are testnet-only: BNB Smart Chain Testnet, Base Sepolia, and Solana Devnet. Network and feature support varies by flow; see the [SDK guide](packages/veilio-sdk/README.md).

## How the marketplace works

### Dataset and digital-asset auction

```mermaid
flowchart LR
    A[Seller prepares asset] --> B{Asset type?}
    B -- Dataset or file --> C[Encrypt files and upload privately]
    B -- NFT --> D[Approve and escrow NFT]
    C --> E[Publish listing and auction terms]
    D --> E
    E --> F[Buyer or agent discovers and evaluates listing]
    F --> G[Prepare bid amount and secret locally]
    G --> H[Commit hash and deposit during bidding]
    H --> I[Reveal bid during reveal window]
    I --> J[Settle after reveal ends]
    J --> K{Winner?}
    K -- No --> L[Eligible bidders withdraw refunds]
    K -- Yes --> M[Winner inspects asset]
    M --> N{Asset type and decision?}
    N -- Dataset accepted --> O[Complete settlement and release data access]
    N -- NFT inspection passes --> P[Finalize and deliver NFT]
    N -- Dispute --> Q[Reviewer resolves under contract rules]
```

The commitment hides the **bid amount** until reveal; the commitment, bidder address, and deposit remain public on-chain. The bid secret is generated locally and must be stored securely until reveal. VEILIO encrypts private asset files and checks access against the winning wallet and completed on-chain state. Public listing fields—such as title, description, price, and cover reference—are still visible to everyone.

### Service marketplace and escrow

```mermaid
flowchart LR
    A[Provider publishes service] --> B[Buyer discovers provider]
    B --> C[Agree scope, price, and deadline]
    C --> D[Create a unique order]
    D --> E[Buyer deposits funds into on-chain escrow]
    E --> F[Provider performs work]
    F --> G[Provider submits delivery reference]
    G --> H{Buyer review}
    H -- Approve --> I[Release funds to provider]
    H -- Dispute --> J[Reviewer resolves and splits funds]
    E -- Deadline passes before delivery --> K[Buyer can request timeout refund]
```

Service listings and order discussion are coordinated by the app; payment custody and settlement are enforced by the escrow contract. The current flow creates one order per service purchase rather than a multi-item cart. On-chain actions and app status are separate steps: after a confirmed transaction, the app's signed API helper records the corresponding order update. The SDK includes helpers for both the on-chain escrow and these API updates; see the [service examples](packages/veilio-sdk/README.md#services-escrow). If a dispute is not resolved by the reviewer within seven days, the contract provides a fee-free buyer-refund fallback; someone still has to submit the timeout transaction.

## What is on-chain and what stays private?

| Data | Where it lives |
| --- | --- |
| Auction terms, bid commitment, deposit, revealed bid, and settlement state | Public on-chain |
| Service order ID, parties, amount, deadline, status, and delivery reference | Public on-chain |
| Service discussions and app-side order details | Off-chain in the app; not part of the escrow contract |
| Uploaded file contents, private file metadata, delivery instructions, and encrypted file keys | Off-chain; sensitive asset records and file content are encrypted as described below |

Commit-reveal is a hash-based sealed-bid mechanism, **not a zero-knowledge proof**: it hides the bid amount until reveal but does not hide bidder identity or deposit. Dataset auctions use the winner's acceptance flow to complete settlement and release file access. NFT auctions use token custody and a separate finalization path after inspection; the keeper can submit that permissionless finalization transaction. VEILIO currently uses encryption, access checks, and file-hash verification for protected asset delivery; it does not claim ZK/TEE proofs of dataset quality.

## Testnet safety note

The currently configured BNB auction deployment is immutable and affected by an identified zero-commitment issue. **Use it with test assets only; do not run valuable auctions on it.** The source fix must be deployed and verified, and access to old auction history preserved, before valuable auctions resume. This manual review is not an independent contract audit. See the [auction and asset operations guide](docs/auction-and-asset-operations.md#contract-security-deployment-note).

## Technical documentation

- [Auction, NFT escrow, and keeper operations](docs/auction-and-asset-operations.md#veilio-nft-escrow-veilnftv4)
- [Encrypted asset storage and upload security](docs/auction-and-asset-operations.md#encrypted-asset-storage)
