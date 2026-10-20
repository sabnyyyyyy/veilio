/**
 * Framework-neutral function tools for VEILIO auction bidders and service buyers.
 * Wallet clients and SDK instances are supplied by the integrator; secrets never
 * need to be returned to the model.
 */

export type JsonSchema = {
  type: 'object';
  properties: Record<string, { type: string; description?: string; enum?: string[]; minimum?: number; maximum?: number }>;
  required?: string[];
  additionalProperties?: boolean;
};

export type VeilioToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** OpenAI-compatible function tool representation. */
  toOpenAIFunction(): { type: 'function'; name: string; description: string; parameters: JsonSchema; strict: false };
};

export type VeilioNetwork = 'bnb-testnet' | 'base-sepolia' | 'solana-devnet';
export type WriteAction = 'start_service_conversation' | 'send_service_message' | 'commit_bid' | 'reveal_bid' | 'settle_auction' | 'claim_auction_asset' | 'dispute_auction_asset' | 'withdraw_auction_refund' | 'fund_service_order' | 'submit_service_delivery' | 'release_service_funds' | 'refund_service_order' | 'dispute_service_order';

export interface VeilioBidVault {
  /** Persist encrypted, wallet-scoped bid material. Never implement this as plaintext storage. */
  save(input: { wallet: string; network: VeilioNetwork; auctionId: string; bid: unknown }): Promise<string>;
  load(input: { wallet: string; network: VeilioNetwork; auctionId: string; bidRef: string }): Promise<unknown | null>;
  remove?(input: { wallet: string; network: VeilioNetwork; auctionId: string; bidRef: string }): Promise<void>;
}

/** Normalized operations the SDK adapter supplies. Use only methods supported on the configured network. */
export interface VeilioAgentOperations {
  listAuctions(input: { network: VeilioNetwork; query?: string; limit?: number }): Promise<unknown>;
  getAuction(input: { network: VeilioNetwork; auctionId: string }): Promise<unknown>;
  listServices(input: { network: VeilioNetwork; query?: string; category?: string; limit?: number }): Promise<unknown>;
  getService?(input: { network: VeilioNetwork; serviceId: string }): Promise<unknown>;
  startServiceConversation(input: { network: VeilioNetwork; serviceId: string }): Promise<unknown>;
  sendServiceMessage(input: { network: VeilioNetwork; conversationId: string; content: string }): Promise<unknown>;
  prepareBid(input: { network: VeilioNetwork; auctionId: string; maxBid: string }): Promise<{ bid: unknown; commitment: string }>;
  commitBid(input: { network: VeilioNetwork; auctionId: string; bid: unknown; deposit: string }): Promise<unknown>;
  revealBid(input: { network: VeilioNetwork; auctionId: string; bid: unknown }): Promise<unknown>;
  settleAuction(input: { network: VeilioNetwork; auctionId: string }): Promise<unknown>;
  getAuctionResult(input: { network: VeilioNetwork; auctionId: string }): Promise<unknown>;
  /** Adapter should derive the seller from the auction when the underlying chain instruction requires it. */
  claimAuctionAsset(input: { network: VeilioNetwork; auctionId: string }): Promise<unknown>;
  disputeAuctionAsset(input: { network: VeilioNetwork; auctionId: string; evidenceReference: string }): Promise<unknown>;
  withdrawAuctionRefund(input: { network: VeilioNetwork }): Promise<unknown>;
  getServiceOrder(input: { network: VeilioNetwork; orderId: string }): Promise<unknown>;
  fundServiceOrder(input: { network: VeilioNetwork; orderId: string; seller: string; amount: string; deadline: number }): Promise<unknown>;
  submitServiceDelivery(input: { network: VeilioNetwork; orderId: string; deliverableReference: string }): Promise<unknown>;
  releaseServiceFunds(input: { network: VeilioNetwork; orderId: string }): Promise<unknown>;
  refundServiceOrder(input: { network: VeilioNetwork; orderId: string; reason: string }): Promise<unknown>;
  disputeServiceOrder(input: { network: VeilioNetwork; orderId: string; reason: string }): Promise<unknown>;
}

export interface VeilioAgentToolsOptions {
  network: VeilioNetwork;
  /** Public wallet address for ownership checks and bid-vault scoping. */
  walletAddress: string;
  operations: VeilioAgentOperations;
  bidVault: VeilioBidVault;
  /** Must present a human-visible confirmation and return true only after approval. */
  confirmWrite: (request: { action: WriteAction; network: VeilioNetwork; summary: string; details: Record<string, unknown> }) => Promise<boolean>;
}

type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

const string = (description: string) => ({ type: 'string', description });
const networkProperty = { type: 'string', description: 'Target VEILIO network.', enum: ['bnb-testnet', 'base-sepolia', 'solana-devnet'] };

function definition(name: string, description: string, properties: JsonSchema['properties'], required: string[] = []): VeilioToolDefinition {
  const inputSchema: JsonSchema = { type: 'object', properties, required, additionalProperties: false };
  return {
    name,
    description,
    inputSchema,
    toOpenAIFunction: () => ({ type: 'function', name, description, parameters: inputSchema, strict: false }),
  };
}

function asString(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalString(input: Record<string, unknown>, name: string): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
  return value.trim() || undefined;
}

function positiveLimit(input: Record<string, unknown>): number | undefined {
  const value = input.limit;
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100) throw new TypeError('limit must be an integer from 1 to 100.');
  return Number(value);
}

/** Create tool schemas and guarded handlers for an agent framework of your choice. */
export function createVeilioAgentTools(options: VeilioAgentToolsOptions) {
  if (!options.network || !options.walletAddress || !options.operations || !options.bidVault || !options.confirmWrite) {
    throw new TypeError('network, walletAddress, operations, bidVault, and confirmWrite are required.');
  }
  const wallet = options.walletAddress;
  const network = options.network;
  const { operations, bidVault } = options;

  async function approve(action: WriteAction, summary: string, details: Record<string, unknown>) {
    if (!(await options.confirmWrite({ action, network, summary, details }))) {
      return { status: 'approval_denied', action, network };
    }
    return null;
  }

  const tools: VeilioToolDefinition[] = [
    definition('veilio_list_auctions', 'Search VEILIO auctions on the configured network.', { network: networkProperty, query: string('Optional text search.'), limit: { type: 'integer', description: 'Maximum results (1-100).', minimum: 1, maximum: 100 } }),
    definition('veilio_get_auction', 'Read auction details and current phase before deciding whether to bid.', { network: networkProperty, auctionId: string('Auction identifier.') }, ['auctionId']),
    definition('veilio_list_services', 'Search services available on the configured network.', { network: networkProperty, query: string('Optional text search.'), category: string('Optional category.'), limit: { type: 'integer', description: 'Maximum results (1-100).', minimum: 1, maximum: 100 } }),
    definition('veilio_start_service_conversation', 'Open a service conversation. Requires user approval because it contacts a seller.', { network: networkProperty, serviceId: string('Service identifier.') }, ['serviceId']),
    definition('veilio_send_service_message', 'Send a message to a service seller. Requires user approval before sending.', { network: networkProperty, conversationId: string('Conversation identifier.'), content: string('Message text.') }, ['conversationId', 'content']),
    definition('veilio_prepare_bid', 'Prepare a sealed bid locally and store its reveal secret in the configured encrypted bid vault. The secret is never returned.', { network: networkProperty, auctionId: string('Auction identifier.'), maxBid: string('Maximum bid in the auction native token.') }, ['auctionId', 'maxBid']),
    definition('veilio_commit_bid', 'Commit a previously prepared bid and lock the chosen public deposit. Requires wallet approval.', { network: networkProperty, auctionId: string('Auction identifier.'), bidRef: string('Reference returned by veilio_prepare_bid.'), deposit: string('Public deposit; must cover the maximum bid.') }, ['auctionId', 'bidRef', 'deposit']),
    definition('veilio_reveal_bid', 'Reveal a committed bid during the reveal window. Requires wallet approval and the encrypted bid secret.', { network: networkProperty, auctionId: string('Auction identifier.'), bidRef: string('Reference returned by veilio_prepare_bid.') }, ['auctionId', 'bidRef']),
    definition('veilio_settle_auction', 'Settle an auction after its reveal period. Requires wallet approval.', { network: networkProperty, auctionId: string('Auction identifier.') }, ['auctionId']),
    definition('veilio_get_auction_result', 'Read the settled outcome and whether the configured wallet won.', { network: networkProperty, auctionId: string('Auction identifier.') }, ['auctionId']),
    definition('veilio_claim_auction_asset', 'Accept a won dataset/asset during the inspection window. Requires wallet approval.', { network: networkProperty, auctionId: string('Auction identifier.') }, ['auctionId']),
    definition('veilio_dispute_auction_asset', 'Request a refund for a won asset during inspection with an evidence reference. Requires wallet approval.', { network: networkProperty, auctionId: string('Auction identifier.'), evidenceReference: string('URI or content hash for dispute evidence.') }, ['auctionId', 'evidenceReference']),
    definition('veilio_withdraw_auction_refund', 'Withdraw the connected wallet’s available auction refund balance. Requires wallet approval.', { network: networkProperty }),
    definition('veilio_get_service_order', 'Read service order status and terms before taking an action.', { network: networkProperty, orderId: string('Service order identifier.') }, ['orderId']),
    definition('veilio_fund_service_order', 'Fund a service escrow using agreed terms. Requires wallet approval.', { network: networkProperty, orderId: string('Service order identifier.'), seller: string('Seller wallet address.'), amount: string('Amount in the network native token.'), deadline: { type: 'integer', description: 'Unix timestamp deadline.' } }, ['orderId', 'seller', 'amount', 'deadline']),
    definition('veilio_submit_service_delivery', 'Submit a delivery reference to a funded service order. Requires wallet approval.', { network: networkProperty, orderId: string('Service order identifier.'), deliverableReference: string('URI or content hash for the deliverable.') }, ['orderId', 'deliverableReference']),
    definition('veilio_release_service_funds', 'Release escrow to the seller after reviewing delivery. Requires buyer approval and wallet confirmation.', { network: networkProperty, orderId: string('Service order identifier.') }, ['orderId']),
    definition('veilio_refund_service_order', 'Request a service escrow refund. Requires wallet approval and contract eligibility.', { network: networkProperty, orderId: string('Service order identifier.'), reason: string('Reason for refund.') }, ['orderId', 'reason']),
    definition('veilio_dispute_service_order', 'Open a service escrow dispute. Requires wallet approval.', { network: networkProperty, orderId: string('Service order identifier.'), reason: string('Dispute summary.') }, ['orderId', 'reason']),
  ];

  const handlers: Record<string, ToolHandler> = {
    veilio_list_auctions: async (i) => operations.listAuctions({ network, query: optionalString(i, 'query'), limit: positiveLimit(i) }),
    veilio_get_auction: async (i) => operations.getAuction({ network, auctionId: asString(i, 'auctionId') }),
    veilio_list_services: async (i) => operations.listServices({ network, query: optionalString(i, 'query'), category: optionalString(i, 'category'), limit: positiveLimit(i) }),
    veilio_start_service_conversation: async (i) => {
      const serviceId = asString(i, 'serviceId');
      const denied = await approve('start_service_conversation', `Start a conversation for service ${serviceId}`, { serviceId });
      return denied ?? operations.startServiceConversation({ network, serviceId });
    },
    veilio_send_service_message: async (i) => {
      const conversationId = asString(i, 'conversationId'); const content = asString(i, 'content');
      const denied = await approve('send_service_message', `Send a message in conversation ${conversationId}`, { conversationId, content });
      return denied ?? operations.sendServiceMessage({ network, conversationId, content });
    },
    veilio_prepare_bid: async (i) => {
      const auctionId = asString(i, 'auctionId'); const maxBid = asString(i, 'maxBid');
      const prepared = await operations.prepareBid({ network, auctionId, maxBid });
      const bidRef = await bidVault.save({ wallet, network, auctionId, bid: prepared.bid });
      return { status: 'prepared', network, auctionId, maxBid, commitment: prepared.commitment, bidRef, note: 'Reveal secret saved in protected bid vault and withheld from model output.' };
    },
    veilio_commit_bid: async (i) => {
      const auctionId = asString(i, 'auctionId'); const bidRef = asString(i, 'bidRef'); const deposit = asString(i, 'deposit');
      const bid = await bidVault.load({ wallet, network, auctionId, bidRef });
      if (bid === null) throw new Error('Prepared bid is missing from the protected bid vault; it cannot be committed/revealed safely.');
      const denied = await approve('commit_bid', `Commit bid on auction ${auctionId} with public deposit ${deposit}`, { auctionId, deposit, bidRef });
      return denied ?? operations.commitBid({ network, auctionId, bid, deposit });
    },
    veilio_reveal_bid: async (i) => {
      const auctionId = asString(i, 'auctionId'); const bidRef = asString(i, 'bidRef');
      const bid = await bidVault.load({ wallet, network, auctionId, bidRef });
      if (bid === null) throw new Error('Prepared bid is missing from the protected bid vault; reveal cannot be reconstructed.');
      const denied = await approve('reveal_bid', `Reveal bid on auction ${auctionId}`, { auctionId, bidRef });
      // Keep the secret until the host has independently confirmed finality. The
      // SDK call may return a signature/hash before the transaction is finalized.
      return denied ?? operations.revealBid({ network, auctionId, bid });
    },
    veilio_settle_auction: async (i) => {
      const auctionId = asString(i, 'auctionId'); const denied = await approve('settle_auction', `Settle auction ${auctionId}`, { auctionId });
      return denied ?? operations.settleAuction({ network, auctionId });
    },
    veilio_get_auction_result: async (i) => operations.getAuctionResult({ network, auctionId: asString(i, 'auctionId') }),
    veilio_claim_auction_asset: async (i) => {
      const auctionId = asString(i, 'auctionId'); const denied = await approve('claim_auction_asset', `Accept the asset won in auction ${auctionId}`, { auctionId });
      return denied ?? operations.claimAuctionAsset({ network, auctionId });
    },
    veilio_dispute_auction_asset: async (i) => {
      const auctionId = asString(i, 'auctionId'); const evidenceReference = asString(i, 'evidenceReference');
      const denied = await approve('dispute_auction_asset', `Request a refund for auction ${auctionId}`, { auctionId, evidenceReference });
      return denied ?? operations.disputeAuctionAsset({ network, auctionId, evidenceReference });
    },
    veilio_withdraw_auction_refund: async () => {
      const denied = await approve('withdraw_auction_refund', 'Withdraw the connected wallet’s available auction refund balance', { wallet });
      return denied ?? operations.withdrawAuctionRefund({ network });
    },
    veilio_get_service_order: async (i) => operations.getServiceOrder({ network, orderId: asString(i, 'orderId') }),
    veilio_fund_service_order: async (i) => {
      const orderId = asString(i, 'orderId'); const seller = asString(i, 'seller'); const amount = asString(i, 'amount'); const deadline = i.deadline;
      if (!Number.isSafeInteger(deadline) || Number(deadline) <= Math.floor(Date.now() / 1000)) throw new TypeError('deadline must be a future Unix timestamp in seconds.');
      const details = { orderId, seller, amount, deadline: Number(deadline) };
      const denied = await approve('fund_service_order', `Fund service order ${orderId} with ${amount}`, details);
      return denied ?? operations.fundServiceOrder({ network, ...details });
    },
    veilio_submit_service_delivery: async (i) => {
      const orderId = asString(i, 'orderId'); const deliverableReference = asString(i, 'deliverableReference');
      const denied = await approve('submit_service_delivery', `Submit delivery for order ${orderId}`, { orderId, deliverableReference });
      return denied ?? operations.submitServiceDelivery({ network, orderId, deliverableReference });
    },
    veilio_release_service_funds: async (i) => {
      const orderId = asString(i, 'orderId'); const denied = await approve('release_service_funds', `Release escrow for service order ${orderId}`, { orderId });
      return denied ?? operations.releaseServiceFunds({ network, orderId });
    },
    veilio_refund_service_order: async (i) => {
      const orderId = asString(i, 'orderId'); const reason = asString(i, 'reason'); const denied = await approve('refund_service_order', `Request refund for service order ${orderId}`, { orderId, reason });
      return denied ?? operations.refundServiceOrder({ network, orderId, reason });
    },
    veilio_dispute_service_order: async (i) => {
      const orderId = asString(i, 'orderId'); const reason = asString(i, 'reason'); const denied = await approve('dispute_service_order', `Dispute service order ${orderId}`, { orderId, reason });
      return denied ?? operations.disputeServiceOrder({ network, orderId, reason });
    },
  };

  return {
    network,
    walletAddress: wallet,
    tools,
    openAIFunctions: tools.map((tool) => tool.toOpenAIFunction()),
    async execute(name: string, input: Record<string, unknown>): Promise<unknown> {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown VEILIO tool: ${name}`);
      if (input.network !== undefined && input.network !== network) throw new Error(`Tool requested ${String(input.network)} but this toolset is configured for ${network}.`);
      return handler(input);
    },
  };
}
