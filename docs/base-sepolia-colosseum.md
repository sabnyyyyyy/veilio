# Base Sepolia preparation for Colosseum

Base is configured as a testnet deployment target (`base:84532`). The current VEILIO auction and Services UI still execute against BNB Chain Testnet; do not switch those pages to Base until the Base deployments and chain-aware transaction paths are in place.

## Deploy the auction contract to Base Sepolia

Use a disposable testnet deployer key stored locally in `.env.testnet` or `.env.local`. Never paste a private key into chat or commit an env file.

Required local variables:

```dotenv
DEPLOYER_PRIVATE_KEY=0x...
REVIEWER_ADDRESS=0x...
FEE_RECIPIENT_ADDRESS=0x...
BASE_SEPOLIA_RPC=https://sepolia.base.org
```

Then deploy the same `VeilNFTV4` implementation used by the current auction app:

```sh
npm run deploy:v4:base-sepolia
```

The deployment script checks the RPC chain ID and validates both role addresses before sending the transaction. The current testnet deployment is `0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1`. It is registered as the Base Sepolia auction address; the app's marketplace capability remains disabled until chain-aware UI and integration tests are complete. Verify this or a future deployment with `BASE_SEPOLIA_AUCTION_ADDRESS=0x... npm run verify:v4:base-sepolia`.

## Remaining before Base marketplace activation

- Verify the auction contract and separately decide whether Services escrow and registry contracts are in this Colosseum scope.
- Add chain-aware contract registries and read clients; existing auction/detail pages still contain BNB-specific addresses and assumptions.
- Add explicit chain guards to every BNB transaction path before exposing Base in the wallet's supported-chain list.
- Add Base Sepolia integration tests for create, commit/reveal, settlement, and access to the correct chain's activity.

Base Sepolia uses chain ID `84532`; it is a test network and must not be confused with Base mainnet (`8453`).
