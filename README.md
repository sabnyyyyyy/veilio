# VEILIO

VEILIO's experimental agent integration is documented in [docs/agent-api.md](docs/agent-api.md). It includes a read-only auction API and a source-level TypeScript SDK for wallet-signed bids.

VEILIO is a sealed-bid marketplace for datasets and other digital assets, with BNB Chain auctions and encrypted off-chain asset delivery.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Contract security deployment note

The current on-chain contract is immutable. A manual review found that it accepts `bytes32(0)` as a bid commitment. Because zero is also the mapping's "no commitment" sentinel, a wallet could be added to the bidder list repeatedly and distort refund accounting. The source fix rejects zero commitments in V2, V3, and V4's inherited logic, and has regression tests. **Do not use the already-deployed affected address for valuable auctions.** Deploy the patched contract to testnet, verify it, update `NEXT_PUBLIC_V4_CONTRACT_ADDRESS`, and preserve access to old auction history before resuming. This review is not an independent contract audit.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
# VEILIO NFT escrow (VeilNFTV4)

NFT auctions support ERC-721 and ERC-1155 custody. Listing creation first asks the seller to approve VEILIO as an operator, then transfers the token into the contract in the same transaction that creates the auction. At settlement, the contract verifies the token is in escrow, transfers it to the winning bidder, verifies the recipient ownership/balance, and records delivery before releasing seller proceeds. If VEILIO approves a refund request, the NFT is returned to the seller and the winning bid becomes withdrawable by the bidder.

The chain does not execute transactions when a timer expires. Run the keeper continuously: it starts settlement after the reveal period, returns an NFT to its seller when there is no winner, and delivers an NFT to the winner after inspection expires. These contract calls are permissionless, so any funded account can also call `settleAuction` or `finalizeSettlement`. The keeper account needs BNB for gas. The web app shows escrow/delivery status from the contract and refreshes it while an NFT auction is in inspection. Refund requests pause automatic completion until VEILIO reviews them.

Deployment outline (BNB testnet):

1. Set `REVIEWER_ADDRESS`, `FEE_RECIPIENT_ADDRESS`, `DEPLOYER_PRIVATE_KEY`, and `NEXT_PUBLIC_BNB_CHAIN_RPC` in the server environment. Never prefix private keys with `NEXT_PUBLIC_`.
2. Run `npm run deploy:v4` and set the printed address as `NEXT_PUBLIC_V4_CONTRACT_ADDRESS` for the web app and keeper.
3. Restart/redeploy the web app so it loads the VeilNFTV4 ABI and address.
4. Fund a separate keeper wallet with test BNB, set `NFT_KEEPER_PRIVATE_KEY`, then run `npm run keeper:nft` as a persistent process.

VeilNFTV4 is a new deployment; it cannot add escrow code to an existing V3 address. Setting the V4 address makes it the active contract for the app, so existing V3 auction history needs an explicit migration or dual-contract history support before replacing a live V3 deployment.

## Encrypted asset storage

File-backed asset uploads require a server-only `ASSET_KEY_ENCRYPTION_KEY`, generated with `openssl rand -base64 32`. Keep the same secret across restarts and back it up securely; rotating or losing it without migrating the encrypted database makes stored assets inaccessible. The encrypted file bytes are stored under `data/encrypted/`; the database containing file keys and private metadata is AES-256-GCM encrypted at rest. The `data/` directory and `.env.testnet` are ignored by Git.

The upload API requires a short-lived off-chain wallet signature bound to the BNB Testnet chain, contract, filename, size, asset type, dataset ID, file hash, and one-time nonce. This message signature is verified by VEILIO's API; it is not broadcast to the blockchain. Auction titles, descriptions, prices, cover image references, and NFT token references are public listing data. File names, file hashes, dataset IDs, file sizes, manifests, and delivery instructions stay in the encrypted server-side asset record and are excluded from public IPFS metadata. Download releases the decryption key only after checking the signed wallet, auction winner, and on-chain `Completed` state; the client checks the decrypted SHA-256 hash before saving.

On Vercel, product files are encrypted in the browser with AES-256-GCM and uploaded directly to a **private Vercel Blob store**, bypassing the 4.5 MB Function request-body limit. The server decrypts bytes only in memory to scan them with ClamAV and build the dataset manifest; it keeps the encrypted object and never stores a plaintext copy. Asset metadata, per-file keys, upload nonces, and rate limits are persisted in Redis REST; each asset record is AES-256-GCM encrypted at rest. Configure `BLOB_READ_WRITE_TOKEN` by connecting a private Blob store, `ASSET_REDIS_REST_URL`, `ASSET_REDIS_REST_TOKEN`, `ASSET_KEY_ENCRYPTION_KEY`, and a network-reachable ClamAV daemon using `CLAMAV_HOST` and `CLAMAV_PORT`. Uploads fail closed if any required service is missing. Structured audit events omit filenames, signatures, file contents, hashes, and encryption keys and should be forwarded to the hosting provider's protected log service.

The encrypted local database and files still require one persistent application instance. For horizontal scaling or serverless hosting, move files to private durable object storage and move the database and key wrapping to a shared database/KMS before enabling uploads. Production operations also need monitored backups and a tested restore/key-rotation procedure. Non-dataset categories are still treated as opaque files after malware scanning: the app does not execute AI models, fully parse CAD/media formats, or issue/revoke third-party software licenses. Malware scanning reduces a risk; it is not a guarantee that a file is safe.

Before production, run the full BNB Testnet flow with dummy assets: upload, create an auction with only public listing metadata, link the private asset record server-side, bid/reveal/settle, inspect as winner, download/decrypt, and verify the hash. Repeat for all file-backed types and test no-winner/refund paths. Contract code still needs an independent security audit; the repository test suite is not a substitute for one.
