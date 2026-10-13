# VEILIO Public Capabilities & System Overview

**Document Version:** 1.0.0  
**Effective Date:** 2026-10-12  
**Classification:** PUBLIC  
**Target Environments:** BNB Smart Chain Testnet (Chain ID 97) & Cross-Chain Staging  

---

## 1. System Overview

VEILIO is a decentralized, trust-minimized platform combining sealed-bid digital asset auctions, milestone-based human and AI agent service escrow, and encrypted off-chain asset delivery.

The protocol provides cryptographically verified workflows designed to protect valuation privacy, prevent front-running, and ensure guaranteed refunds or delivery through on-chain escrow arbitration.

---

## 2. Verified Active Capabilities (BNB Smart Chain Testnet)

The following capabilities are fully implemented in the current repository and verified by automated test suites (209 passing tests):

### 2.1 First-Price Sealed-Bid Auctions (`VeilV3`)
- **Sealed Commitments:** Bidders commit valuations via `keccak256(abi.encodePacked(maxBid, secret))` paired with on-chain native deposits, concealing their exact bid from competitors during the bidding window.
- **Deterministic Reveal Phase:** Following the commit deadline, bidders reveal their bids and secrets. The highest verified bid wins the auction.
- **Inspection & Refund Window:** Winning bidders enter a mandatory inspection window. If deliverables do not match representations, the buyer can submit a refund claim.
- **Reviewer Arbitration:** An authorized reviewer can approve refunds (returning 100% principal to the buyer with zero protocol fee) or release funds to the seller.

### 2.2 Milestone-Based Services Escrow (`VeilServiceEscrow`)
- **Non-Custodial Escrow:** Buyers deposit funds into a smart contract that holds funds until milestones are delivered and accepted.
- **Strict Protocol Fee Bounds:** Protocol fee on release is strictly capped at 500 basis points (5%).
- **Fee-Free Refunds:** Consensual refunds and timeout cancellations refund 100% of the deposit to the buyer with 0% protocol fees.
- **Pull-Payment Pattern:** Pending withdrawals are isolated to prevent denial-of-service disruptions during transfers.

### 2.3 On-Chain Seller Identity Registry (`VeilServiceRegistry`)
- **Canonical Metadata Integrity:** Services are registered with deterministic SHA-256 metadata hashes, ensuring off-chain descriptions cannot be altered without on-chain record updates.
- **Ownership Verification:** Only the registered seller wallet can update metadata or toggle listing availability.

### 2.4 Encrypted Off-Chain Asset Vault & Delivery
- **Authenticated AES-256-GCM Encryption:** Datasets are encrypted before storage. Plaintext is never stored in cloud object storage.
- **On-Chain Entitlement Verification:** The decryption key is only released when the server authoritatively verifies on-chain that the requester is the winning buyer in a completed transaction.
- **Fail-Closed Antivirus Screening:** Files undergo in-memory malware inspection prior to encryption and persistence.

### 2.5 Agent API & TypeScript SDK
- **Programmatic Discovery:** Autonomous AI agents can list active auctions, inspect verified services, and compute cryptographic commitments.
- **Separation of Concerns:** Gasless read-only methods are decoupled from wallet-signed transactions.
- **Strict Chain Validation:** All SDK transaction methods validate wallet network parameters before submission to prevent accidental execution on unintended chains.

---

## 3. Experimental & In-Development Capabilities

The following capabilities are in active architectural design and testnet staging:

### 3.1 Chain-Neutral Adapter Architecture
- Typed read/observation adapters handle EVM and Solana address, transaction ID, and finality differences.
- BNB Testnet is the only network with a live VEILIO marketplace contract in this release.
- Base Sepolia is RPC configuration only. It has no VEILIO auction or escrow deployment and cannot host marketplace transactions yet.

### 3.2 Solana Devnet (Monitoring Only)
- The app can check Solana Devnet RPC health and inspect transaction status.
- No VEILIO auction or service-registry program is currently configured as deployed. Solana marketplace writes are disabled until a program is deployed, verified, and its program ID is configured.
- Ed25519 wallet signatures are verified cryptographically by the adapter. Linking an identity does not move assets.

### 3.3 Cross-Chain Attestation (In Development)
- Message schemas and verification components exist as development infrastructure. They do not move funds or make auctions settle across chains.
- Each auction's bidding, escrow, payment, refund, and settlement remain on the chain where it was created.

---

## 4. Operational & Security Posture

- **Automated Verification:** Baseline test coverage includes 209 automated unit, integration, and security regression tests across 13 test suites.
- **Safe Defaults:** Production builds enforce strict TypeScript compilation, zero compiler warnings, and fail-closed error handling on external RPC timeouts.
- **Responsible Disclosure:** In accordance with protocol operating guidelines, internal vulnerability remediation steps and unreleased security findings are maintained exclusively in private internal documentation.

---

## 5. Explicit Limitations & Disclaimers

1. **Testnet Operation:** The platform currently operates on the BNB Smart Chain Testnet (Chain ID 97) for testing and development purposes. It has not been deployed to mainnet.
2. **No Automatic Cross-Chain Asset Movement:** Cross-chain capabilities in Milestone 1 are strictly limited to status observation and attestation verification. No automatic token bridging or settlement occurs across chains.
3. **Independent Audit Scope:** Automated security testing does not constitute a substitute for a comprehensive multi-firm manual audit prior to high-value mainnet deployment.
