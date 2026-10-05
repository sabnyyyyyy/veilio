# VEILIO Security Readiness

## Implemented in this repository

- Signed uploads bound to the wallet, BNB Testnet, contract, file properties, and a one-time nonce.
- File-type allowlists, filename sanitization, a 100 MB application limit, AES-256-GCM encryption, encrypted metadata/key database, and client-side SHA-256 integrity verification.
- Production upload fail-closed checks for an absolute private persistent volume, HTTPS Redis REST (shared rate limit and nonce consumption), a valid encryption key, and ClamAV scanning.
- Streamed encrypted downloads to avoid JSON/base64 expansion, with winner/completed-state checks before releasing the file key.
- Auction linking checks the on-chain seller and verifies that asset ID, hash, and type match the auction metadata.
- Redacted structured audit logs. File names, content, signatures, keys, and file hashes are excluded.
- Regression coverage for the zero-commitment accounting bug described below.

## Critical contract finding

The previous deployed V4 bytecode cannot be changed. It accepts `bytes32(0)` as a commitment even though zero is also used as the "no commitment" sentinel. A wallet can submit repeated zero commitments; the bidder list then contains duplicate addresses while the mapping keeps only the latest deposit. Settlement can credit refunds repeatedly against that one recorded deposit. The source now rejects zero commitments in VeilV2, VeilV3, and VeilNFTV4 through inheritance.

Do not run valuable auctions on an affected deployed address. Deploy the patched contract as a new address, verify it on BNB Testnet, switch the application address only after checking reviewer/fee-recipient configuration, and retain access to auctions on the old contract. A contract change needs fresh deployment and cannot be applied by a frontend release.

## Required deployment configuration

Set these in the hosting provider's secret/configuration system, not in the browser bundle:

- `ASSET_KEY_ENCRYPTION_KEY`: a stable random base64-encoded 32-byte key.
- `VEILIO_ASSET_STORAGE_DIR`: absolute path to a private durable mounted volume. Current file/database backend supports one persistent application instance only.
- `ASSET_REDIS_REST_URL` and `ASSET_REDIS_REST_TOKEN`: HTTPS Redis REST credentials used for shared rate limits and replay protection.
- `CLAMAV_HOST` and `CLAMAV_PORT`: reachable ClamAV daemon. Uploads fail closed in production if it is missing or unavailable.
- `PINATA_JWT` (or the Pinata API key pair): required for durable public auction metadata publication. Without it, the current metadata route falls back to a local URL unsuitable for a public listing.

Back up the encrypted volume and key separately. Verify a restore before production. Losing the key makes stored files unrecoverable. For multiple app instances/serverless, replace the local file/database backend with private object storage, shared database, and managed KMS key wrapping before enabling uploads.

## Verification status

- Local test suite: 78 passing, including contract regression tests, mock ClamAV behavior, Redis limiter behavior, asset encryption, and streamed-download bundle parsing.
- TypeScript check and Next.js production build passed before the final Solidity regression change; rerun the build after deployment-address changes.
- BNB Testnet read-only preflight confirmed chain ID 97, contract bytecode at the configured address, matching application/testnet contract settings, and funded seller/bidder test wallets.
- No Testnet transactions were sent in this pass. Pinata credentials are not configured, so the application would publish metadata to an instance-local URL; creating permanent public-chain test auctions with those URIs would be misleading.
- Independent contract audit, real configured Redis/ClamAV integration, restore/key-rotation drill, and full testnet upload-to-settlement E2E remain required before production.
