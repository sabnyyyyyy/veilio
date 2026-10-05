# VEILIO Security Readiness

## Implemented in this repository

- Signed uploads bound to the wallet, BNB Testnet, contract, file properties, and a one-time nonce.
- File-type allowlists, filename sanitization, a 100 MB application limit, AES-256-GCM encryption, encrypted metadata/key database, and client-side SHA-256 integrity verification.
- Production upload fail-closed checks for a private Vercel Blob store, HTTPS Redis REST (encrypted metadata, shared rate limit, and nonce consumption), a valid encryption key, and a reachable ClamAV scanner.
- Browser-side AES-256-GCM encryption and direct private Blob multipart uploads, bypassing Vercel Function request-size limits. The server scans decrypted bytes in memory and persists only ciphertext.
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
- `BLOB_READ_WRITE_TOKEN`: automatically added when a private Vercel Blob store is connected to the project. The store must be created with **Private** access.
- `ASSET_REDIS_REST_URL` and `ASSET_REDIS_REST_TOKEN`: HTTPS Redis REST credentials used for shared rate limits and replay protection.
- `CLAMAV_HOST` and `CLAMAV_PORT`: reachable ClamAV daemon. Uploads fail closed in production if it is missing or unavailable.
- `PINATA_JWT` (or the Pinata API key pair): required for durable public auction metadata publication. Without it, the current metadata route falls back to a local URL unsuitable for a public listing.

Keep the Redis database and encryption key available across deploys. Losing the key makes stored asset metadata and per-file keys unrecoverable. The private Blob objects contain ciphertext only; Redis holds AES-256-GCM encrypted records. Configure backups and a restore procedure for Redis and the encryption key before accepting valuable assets.

## Vercel production setup

1. Create a Vercel Blob store with **Private** access and connect it to the production project. Vercel supplies `BLOB_READ_WRITE_TOKEN` to the selected environment.
2. Connect an HTTPS Redis REST database and set `ASSET_REDIS_REST_URL` and `ASSET_REDIS_REST_TOKEN` for Production.
3. Generate one stable key with `openssl rand -base64 32`; save it as `ASSET_KEY_ENCRYPTION_KEY` in Vercel Production. Keep a protected backup and never use a `NEXT_PUBLIC_` name.
4. Provide `CLAMAV_HOST` and `CLAMAV_PORT` for a trusted scanner reachable from the Vercel Function. ClamAV's daemon protocol is not encrypted or authenticated by default; keep it on a private or otherwise network-restricted connection and do not expose an unauthenticated daemon publicly.
5. Keep the Pinata configuration for publishing auction metadata. Redeploy after configuring the variables, then test upload, inspection, and download with dummy assets before accepting valuable files.

Do not set `VEILIO_ASSET_STORAGE_DIR` on Vercel; the production asset path uses private Blob plus Redis instead of the Function's ephemeral filesystem.

## Verification status

- Local test suite: 81 passing, including contract regression tests, upload authorization/storage configuration, mock ClamAV behavior, Redis limiter behavior, asset encryption, and streamed-download bundle parsing.
- TypeScript check and Next.js production build passed for the Vercel Blob upload changes.
- BNB Testnet read-only preflight confirmed chain ID 97, contract bytecode at the configured address, matching application/testnet contract settings, and funded seller/bidder test wallets.
- No Testnet transactions were sent in this pass. Pinata credentials are not configured, so the application would publish metadata to an instance-local URL; creating permanent public-chain test auctions with those URIs would be misleading.
- The real Vercel Blob callback path, production Redis, reachable ClamAV service, restore/key-rotation drill, independent contract audit, and full testnet upload-to-settlement E2E still need verification after the required production services are connected.
