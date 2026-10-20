# veilio-agent-tools

Framework-neutral tool schemas and guarded handlers for VEILIO auction bidders and service buyers. Install alongside the SDK:

```sh
npm install veilio-agent-tools veilioexchange
```

The package is separate from `veilioexchange`: the SDK remains the chain/API client, while this package exposes agent-facing tools and a human approval hook. `openAIFunctions` can be adapted to OpenAI-compatible function calling; `tools` and `execute()` can be adapted to other agent frameworks. An MCP transport can be added as an adapter without changing the SDK or these tool semantics.

## Security requirements

- Provide a wallet address and SDK-backed `operations` for exactly one configured network. Create a separate toolset for each network the user may select.
- Implement `confirmWrite` in the host application so the user sees the action, network, amount/recipient/details, and explicitly approves before the wallet sends a transaction or a message is sent.
- Implement `VeilioBidVault` with encrypted, durable storage scoped to both wallet and network. Never use plaintext files or expose the stored `bid` in tool results. Losing the bid secret makes reveal impossible.
- Keep signing keys in the wallet/signer layer. Never pass private keys to the model or this tool package.
- This package does not claim a chain is supported merely because its schema lists the network. Only wire operations backed by the matching published SDK and deployment; reject unsupported actions in the adapter.

## Integrator contract

`VeilioAgentOperations` is the small bridge to SDK clients. Map auction reads and bid methods to `createVeilioAgent()` for BNB/Base or `createVeilioSolanaClient()` for Solana. Map service discovery/chat to `createVeilioServicesApi()` and escrow actions to the matching EVM or Solana escrow client. The network is fixed when constructing the toolset, so the model cannot redirect a transaction to a different chain. Normalize SDK return values to JSON-serializable objects in the bridge.

```ts
import { createVeilioAgentTools } from 'veilio-agent-tools';

const tools = createVeilioAgentTools({
  network: 'base-sepolia',
  walletAddress: wallet.address,
  operations: sdkBridge, // adapter around veilioexchange clients
  bidVault: encryptedBidVault, // backed by OS keychain/KMS/encrypted DB
  confirmWrite: async (request) => showWalletConfirmation(request),
});

// Give tools.openAIFunctions to a compatible model API. When the model requests a call:
const result = await tools.execute(toolCall.name, toolCall.arguments);
```

This package defines bidder and service-buyer capabilities. Seller publication tools are not included in this initial surface.
