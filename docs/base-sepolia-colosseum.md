# Base Sepolia integration status for Colosseum

Base Sepolia (`base:84532`) is now a configured testnet target in the application and SDK. The auction and service creation flows support selecting Base; SDK clients select the Base deployments when initialized with chain ID `84532`. This is testnet support only.

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

The deployment script checks the RPC chain ID and validates both role addresses before sending the transaction. The configured auction address is `0xbac318dE378Ac19d5aBB93076feAa131eE649Bc6`. Confirm bytecode and expected roles with `BASE_SEPOLIA_AUCTION_ADDRESS=0x... npm run verify:v4:base-sepolia` before using a deployment; configuration alone is not proof that the target RPC currently has the expected contract.

## Checks to complete before a public launch

- Confirm the auction, service escrow, and service registry addresses on Base Sepolia and ensure the UI/API environment variables match them.
- Exercise create, commit/reveal, settlement, escrow, and service registration with separate test wallets on Base Sepolia.
- Keep testnet assets only; do not interpret testnet support as a mainnet security review.

Base Sepolia uses chain ID `84532`; it is a test network and must not be confused with Base mainnet (`8453`).
