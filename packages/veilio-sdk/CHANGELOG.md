# Changelog

## 0.4.0

### Added
- **Price reductions after funding:** `services.partialRefund(orderId, amount, reason)` (EVM) and
  `solana.partialRefund(orderId, amountSol, reason)` let the seller return part of a funded order to the
  buyer after agreeing a lower price; the order stays active and the platform fee applies to the reduced
  amount at release. `createVeilioServicesApi().partialRefund({ orderId, txHash, reason? })` records it with
  the VEILIO API. New exports: `createPartialRefundInstruction`, ABI entries `partialRefund` and
  `OrderPartiallyRefunded`.

### Changed
- **Redeployed Services escrow:** `VEILIO_DEPLOYMENTS` now points `serviceEscrow` at the contract with
  `partialRefund`: BNB Testnet `0xEd83D9f97c01a94d235927704638d6e765501f50`, Base Sepolia
  `0x9679f83560076921f364574Ff341c37B7fcFd9A4`. Deposits to the previous escrow are no longer accepted
  by the VEILIO API; pass `contractAddress` explicitly only to manage orders funded on the old contract.
- Signed-message purpose lines now state plainly that signing moves no funds and costs no gas. The API
  still accepts signatures over the previous wording, so older SDK versions keep working.

## 0.3.0

### Added
- **Auction lifecycle (EVM, VeilNFTV4):** `settleAuction`, `finalizeSettlement`, `requestRefund(auctionId, evidenceHash)`,
  `withdrawRefund`, `getPendingRefund`, `isNftAuction`, `waitForTransaction`. `finalizeSettlement` is the
  completion path for NFT auctions (`acceptDataset` is blocked on-chain for NFTs); `claimAsset` now throws a
  clear error for NFT auctions instead of sending a transaction that reverts.
- **Base Sepolia auctions:** `createVeilioAgent({ chainId: 84532 })` picks the Base Sepolia auction and Services
  escrow defaults from `VEILIO_DEPLOYMENTS`. New exports: `VEILIO_SUPPORTED_CHAIN_IDS`, `getVeilioDeployment`,
  `assertVeilioChainId`, `veilAuctionAbi`.
- **Off-chain Services API helper:** `createVeilioServicesApi({ apiBaseUrl, signer })` with `notifyDeposit`,
  `submit` (requires `deliveryTxHash`, the on-chain `submitDelivery` tx), `requestRevision`, `approve`,
  `cancel`, each signed with `signServiceAuth`. It never sends a `network` field; the server derives the
  chain from the order. Session-authenticated reads: `getOrder`, `getPaymentRequest`, `listConversations`,
  `getConversationMessages`, `getSession`, `getSessionHeaders`.
- **Read session auth:** `signServiceSession`, `isServiceSessionFresh`, `encodeServiceAuthHeader`,
  `SERVICE_AUTH_HEADER` (`x-veilio-auth`), `SERVICE_SESSION_MAX_AGE_MS` (30 min).
- **Solana auction client:** `settleAuction`, `requestRefund`, `finalizeInspectionTimeout`, `finalizeRefundTimeout`.
- **Solana escrow:** `platformReviewer` / `platformFeeRecipient` client options used as defaults by `deposit()`.

### Changed
- Every agent write (`commitBid`, `revealBid`, lifecycle calls) now checks `walletClient.chain` against the
  agent's `chainId` and throws `CHAIN_MISMATCH` before sending.
- `PreparedBid.chainId` is the agent's actual chain (was always 97).
- `createVeilioAgent().services` uses the agent's `chainId` (was always 97).
- `revealBid` rejects reveals after `revealEndTime` with a hint to call `settleAuction`.
- `getAuctionResult` adds `chainId` and `winningBid`; `winningBidBnb` is kept as a deprecated alias.
- Solana `deposit()`: `reviewer` / `feeRecipient` are now optional (default to the platform options) and a
  reviewer equal to the buyer or seller is rejected. The deployed program still accepts any buyer-chosen
  reviewer; see the README security note.
- Solana `reveal_bid` instruction marks the bidder account writable (it receives the over-deposit refund).

## 0.2.0

- Previous published release.
