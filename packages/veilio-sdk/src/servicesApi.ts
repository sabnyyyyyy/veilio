import { VeilioSdkError } from './errors.js';
import { pad, parseEventLogs, sha256, stringToHex, toHex, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { VEILIO_DEPLOYMENTS } from './deployments.js';
import {
  encodeServiceAuthHeader,
  isServiceSessionFresh,
  signServiceAuth,
  signServiceSession,
  type MessageSigner,
  type ServiceAuthPayload,
} from './auth.js';

/**
 * Off-chain VEILIO Services API helper.
 *
 * The on-chain escrow (`createVeilioServicesClient`, or the Solana client) moves funds, but the
 * order status shown in the VEILIO app (`InProgress`, `InReview`, `Completed`, ...) only changes
 * when the API is told about it. Call the matching method here after each on-chain step.
 *
 * State-changing calls are signed per request with `signServiceAuth` (EIP-191 or Solana Ed25519,
 * nonce consumed by the server). Reads use a reusable 30-minute session (`signServiceSession`)
 * sent in the `x-veilio-auth` header; it is signed once and cached. The server derives the
 * network from the order itself, so no `network` field is ever sent.
 */
export interface VeilioServicesApiOptions {
  /** e.g. "https://veilio.example". Trailing slashes are ignored. */
  apiBaseUrl: string;
  /** EVM LocalAccount or Solana message signer. Must be the order/conversation participant. */
  signer: MessageSigner;
  /** Custom fetch (defaults to globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
  /** Required only for publishService; use clients on the same chain as the signer. */
  publicClient?: PublicClient;
  walletClient?: WalletClient;
  /** 97 (BNB Testnet) or 84532 (Base Sepolia). Defaults to the wallet chain, then 97. */
  chainId?: 97 | 84532;
  /** Override the service registry deployment. */
  registryAddress?: Address;
  /** Solana client returned by createVeilioSolanaClient; required only for publishSolanaService. */
  solanaClient?: {
    address?: string;
    registerService(input: PublishServiceInput): Promise<{ signature: string; createdAt: number; metadataURI: string; metadataHash: Hex }>;
  };
}

export interface PublishServiceInput {
  id: string;
  sellerType: 'human' | 'agent';
  sellerName: string;
  title: string;
  description: string;
  category: string;
  price: string;
  deliveryTime: string;
  sampleDeliverables?: string[];
  /** Optional URI to metadata; default is a stable VEILIO URI. */
  metadataURI?: string;
}

const serviceRegistryAbi = [
  { type: 'function', name: 'registerService', stateMutability: 'nonpayable', inputs: [
    { name: 'serviceId', type: 'bytes32' }, { name: 'metadataHash', type: 'bytes32' }, { name: 'metadataURI', type: 'string' },
  ], outputs: [] },
  { type: 'event', name: 'ServiceRegistered', anonymous: false, inputs: [
    { name: 'serviceId', type: 'bytes32', indexed: true }, { name: 'seller', type: 'address', indexed: true },
    { name: 'metadataHash', type: 'bytes32', indexed: false }, { name: 'metadataURI', type: 'string', indexed: false },
    { name: 'timestamp', type: 'uint256', indexed: false },
  ] },
] as const;

export interface NotifyDepositInput {
  /** VEILIO order ID (the `id` in /api/orders/{id}). */
  orderId: string;
  /** Deposit transaction hash (EVM) or signature (Solana). */
  txHash: string;
  /** bytes32 order ID used on-chain, if it differs from the default derived from the order. */
  onChainOrderId?: string;
}

export interface SubmitDeliveryApiInput {
  orderId: string;
  /**
   * Required: the on-chain `submitDelivery` transaction hash (EVM, must emit DeliverySubmitted by
   * the seller) or `submit_delivery` signature (Solana). Send the on-chain tx first.
   */
  deliveryTxHash: string;
  /** At least 5 characters. */
  description: string;
  /** Up to 500 characters each. */
  deliverableReferences?: string[];
}

export interface ApproveOrderApiInput {
  orderId: string;
  /** `releaseFunds` transaction hash (EVM) or signature (Solana). */
  releaseTxHash: string;
}

export interface CancelOrderApiInput {
  orderId: string;
  reason?: string;
  /** Required once the order is funded: the on-chain cancel/refund transaction. */
  txHash?: string;
}

export interface PartialRefundApiInput {
  orderId: string;
  /** The seller's confirmed on-chain `partialRefund` transaction. */
  txHash: string;
  reason?: string;
}

export interface RequestRevisionApiInput {
  orderId: string;
  /** At least 5 characters. */
  feedback: string;
}

export function createVeilioServicesApi(options: VeilioServicesApiOptions) {
  const base = String(options.apiBaseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) {
    throw new VeilioSdkError({ code: 'INVALID_CONFIG', message: 'apiBaseUrl must be an absolute http(s) URL.' });
  }
  if (!options.signer?.address || typeof options.signer.signMessage !== 'function') {
    throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'A signer with address and signMessage() is required.' });
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new VeilioSdkError({ code: 'INVALID_CONFIG', message: 'No fetch implementation available; pass options.fetch.' });
  }
  const signer = options.signer;

  function requireOrderId(orderId: string): string {
    const id = String(orderId ?? '').trim();
    if (!id) throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'orderId is required.' });
    return id;
  }

  async function parse<T>(res: Response, route: string, id: string): Promise<T> {
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // Non-JSON response; handled below.
    }
    if (!res.ok) {
      throw new VeilioSdkError({
        code: res.status === 401 || res.status === 403 ? 'UNAUTHORIZED' : res.status === 404 ? 'NOT_FOUND' : 'INVALID_INPUT',
        message: `VEILIO API ${route} failed (${res.status}): ${json?.error || res.statusText || 'unknown error'}`,
        retryable: res.status >= 500,
        context: { status: res.status, id, route },
      });
    }
    return json as T;
  }

  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, init);
    } catch (cause) {
      throw new VeilioSdkError({ code: 'RPC_ERROR', message: `VEILIO API request failed: ${url}`, retryable: true, cause });
    }
  }

  // ------------------------------------------------------------- read session
  let session: ServiceAuthPayload | null = null;
  let pendingSession: Promise<ServiceAuthPayload> | null = null;

  /** Cached read/chat session; signs a new one when missing or within a minute of expiry. */
  async function getSession(): Promise<ServiceAuthPayload> {
    if (session && isServiceSessionFresh(session, signer.address)) return session;
    if (!pendingSession) {
      pendingSession = signServiceSession(signer).finally(() => {
        pendingSession = null;
      });
    }
    session = await pendingSession;
    return session;
  }

  /** `x-veilio-auth` header map for custom GET requests. */
  async function getSessionHeaders(): Promise<Record<string, string>> {
    return encodeServiceAuthHeader(await getSession());
  }

  async function get<T = unknown>(path: string, label: string, id: string): Promise<T> {
    const res = await request(`${base}${path}`, { method: 'GET', headers: await getSessionHeaders() });
    return parse<T>(res, label, id);
  }

  /** Order as seen by the VEILIO app (status, paymentStatus, network...). Buyer or seller only. */
  async function getOrder(orderId: string) {
    const id = requireOrderId(orderId);
    return get<{ success: boolean; order: Record<string, unknown> }>(`/api/orders/${encodeURIComponent(id)}`, 'get-order', id);
  }

  /** Payment request detail (participants only). */
  async function getPaymentRequest(paymentRequestId: string) {
    const id = requireOrderId(paymentRequestId);
    return get<{ success: boolean; paymentRequest: Record<string, unknown> }>(
      `/api/payment-requests/${encodeURIComponent(id)}`,
      'get-payment-request',
      id
    );
  }

  /** Conversations of the signer's wallet. */
  async function listConversations() {
    return get<{ success: boolean; conversations: unknown[] }>(
      `/api/conversations?userAddress=${encodeURIComponent(signer.address)}`,
      'list-conversations',
      signer.address
    );
  }

  /** Conversation + messages (participants only). */
  async function getConversationMessages(conversationId: string) {
    const id = requireOrderId(conversationId);
    return get<{ success: boolean; conversation: unknown; messages: unknown[] }>(
      `/api/conversations/${encodeURIComponent(id)}/messages`,
      'get-messages',
      id
    );
  }

  /** Public/verified catalog discovery for agent tool implementations. */
  async function listServices(input: { query?: string; category?: string; sellerType?: 'human' | 'agent' | 'all'; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (input.query) params.set('query', input.query);
    if (input.category) params.set('category', input.category);
    if (input.sellerType) params.set('sellerType', input.sellerType);
    params.set('status', 'active');
    const res = await request(`${base}/api/services?${params.toString()}`, { method: 'GET' });
    const result = await parse<{ success: boolean; services?: unknown[]; metrics?: unknown }>(res, 'list-services', 'catalog');
    const limit = input.limit === undefined ? undefined : Math.min(Math.max(Math.trunc(input.limit), 1), 100);
    return limit && result.services ? { ...result, services: result.services.slice(0, limit) } : result;
  }

  /** Buyer opens a conversation with the seller of a service. */
  async function startConversation(serviceId: string) {
    const id = requireOrderId(serviceId);
    const res = await request(`${base}/api/conversations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: id, buyerAddress: signer.address, auth: await getSession() }),
    });
    return parse<{ success: boolean; conversation: unknown }>(res, 'start-conversation', id);
  }

  /** Replies as the authenticated participant; server enforces participant identity and agent badge rules. */
  async function sendMessage(conversationId: string, content: string, input: { senderType?: 'human' | 'agent'; paymentRequestId?: string } = {}) {
    const id = requireOrderId(conversationId);
    const message = String(content ?? '').trim();
    if (!message) throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Chat message cannot be empty.' });
    const res = await request(`${base}/api/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message, senderId: signer.address, senderType: input.senderType ?? 'agent', ...(input.paymentRequestId ? { paymentRequestId: input.paymentRequestId } : {}), auth: await getSession() }),
    });
    return parse<{ success: boolean; message: unknown }>(res, 'send-message', id);
  }

  async function syncServiceListing(input: PublishServiceInput, txHash: Hex, createdAt: number, metadataURI?: string) {
    const chainId = options.chainId ?? options.walletClient?.chain?.id ?? 97;
    if (chainId !== 97 && chainId !== 84532) throw new VeilioSdkError({ code: 'CHAIN_MISMATCH', message: 'Service sync supports BNB Testnet (97) and Base Sepolia (84532).' });
    const id = input.id.trim();
    const uri = metadataURI?.trim() || input.metadataURI?.trim() || `veilio://services/${encodeURIComponent(id)}`;
    const metadata = {
      category: input.category.trim(), createdAt, currency: chainId === 97 ? 'BNB' : 'ETH',
      deliveryTime: input.deliveryTime.trim(), description: input.description.trim(), id,
      price: String(Number(input.price)), sampleDeliverables: (input.sampleDeliverables ?? []).map((x) => x.trim()).filter(Boolean),
      seller: signer.address.toLowerCase(), sellerName: input.sellerName.trim(), sellerType: input.sellerType,
      title: input.title.trim(), version: '1.0.0',
    };
    const metadataHash = sha256(toHex(JSON.stringify(metadata)));
    const auth = await signServiceAuth(signer, 'create-service', id);
    const res = await request(`${base}/api/services`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      ...metadata, sellerId: signer.address, txHash, metadataURI: uri, metadataHash, network: chainId === 97 ? 'bnb:97' : 'base:84532', auth,
    }) });
    try {
      return { ...(await parse<Record<string, unknown>>(res, 'publish-service', id)), txHash, serviceId: id };
    } catch (cause) {
      if (cause instanceof VeilioSdkError) throw new VeilioSdkError({
        code: cause.code,
        message: `${cause.message} The registry transaction is already confirmed; retry syncServiceListing with the same input, txHash, createdAt, and metadataURI.`,
        context: { ...cause.context, txHash, serviceId: id, createdAt, metadataURI: uri, metadataHash, network: chainId === 97 ? 'bnb:97' : 'base:84532' },
        cause,
      });
      throw cause;
    }
  }

  async function syncSolanaServiceListing(input: PublishServiceInput, signature: string, createdAt: number, metadataURI?: string) {
    const id = input.id.trim();
    const uri = metadataURI?.trim() || input.metadataURI?.trim() || `ipfs://QmServiceMeta-${id}`;
    const metadata = {
      category: input.category.trim(), createdAt, currency: 'SOL',
      deliveryTime: input.deliveryTime.trim(), description: input.description.trim(), id,
      price: String(Number(input.price)), sampleDeliverables: (input.sampleDeliverables ?? []).map((x) => x.trim()).filter(Boolean),
      seller: signer.address, sellerName: input.sellerName.trim(), sellerType: input.sellerType,
      title: input.title.trim(), version: '1.0.0',
    };
    const metadataHash = sha256(toHex(JSON.stringify(metadata)));
    const auth = await signServiceAuth(signer, 'create-service', id);
    const res = await request(`${base}/api/services`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      ...metadata, sellerId: signer.address, txHash: signature, metadataURI: uri, metadataHash, network: 'solana:devnet', auth,
    }) });
    try {
      return { ...(await parse<Record<string, unknown>>(res, 'publish-solana-service', id)), txHash: signature, serviceId: id };
    } catch (cause) {
      if (cause instanceof VeilioSdkError) throw new VeilioSdkError({
        code: cause.code,
        message: `${cause.message} Solana registry transaction is already confirmed; retry syncSolanaServiceListing with the same input, signature, createdAt, and metadataURI.`,
        context: { ...cause.context, txHash: signature, serviceId: id, createdAt, metadataURI: uri, metadataHash, network: 'solana:devnet' },
        cause,
      });
      throw cause;
    }
  }

  async function publishSolanaService(input: PublishServiceInput) {
    const client = options.solanaClient;
    if (!client) throw new VeilioSdkError({ code: 'INVALID_CONFIG', message: 'publishSolanaService requires a Solana client with a connected wallet signer.' });
    if (!client.address || client.address !== signer.address) throw new VeilioSdkError({ code: 'UNAUTHORIZED', message: 'Solana registry signer and Services API message signer must be the same wallet.' });
    const registered = await client.registerService(input);
    return syncSolanaServiceListing(input, registered.signature, registered.createdAt, registered.metadataURI);
  }

  /** Registers a verified EVM service listing on-chain, waits for its event, then syncs it to VEILIO. */
  async function publishService(input: PublishServiceInput) {
    const wallet = options.walletClient;
    const publicClient = options.publicClient;
    if (!wallet || !publicClient) throw new VeilioSdkError({ code: 'WALLET_REQUIRED', message: 'publishService requires walletClient and publicClient.' });
    const chainId = options.chainId ?? wallet.chain?.id;
    if (chainId !== 97 && chainId !== 84532) throw new VeilioSdkError({ code: 'CHAIN_MISMATCH', message: 'publishService supports BNB Testnet (97) and Base Sepolia (84532).' });
    if (wallet.chain && wallet.chain.id !== chainId) throw new VeilioSdkError({ code: 'CHAIN_MISMATCH', message: `Wallet chain ${wallet.chain.id} does not match Services registry chain ${chainId}.` });
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(input.id)) throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Service id must be 3-32 characters: letters, numbers, _ or -.' });
    if (input.title.trim().length < 5 || input.description.trim().length < 15 || !Number.isFinite(Number(input.price)) || Number(input.price) <= 0 || !input.category.trim() || !input.sellerName.trim() || !input.deliveryTime.trim()) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'Service requires sellerName, deliveryTime, title (5+ chars), description (15+ chars), category, and positive price.' });
    }
    const createdAt = Date.now();
    const seller = signer.address;
    const metadata = {
      category: input.category.trim(), createdAt, currency: chainId === 97 ? 'BNB' : 'ETH',
      deliveryTime: input.deliveryTime.trim(), description: input.description.trim(), id: input.id.trim(),
      price: String(Number(input.price)), sampleDeliverables: (input.sampleDeliverables ?? []).map((x) => x.trim()).filter(Boolean),
      seller: seller.toLowerCase(), sellerName: input.sellerName.trim(), sellerType: input.sellerType,
      title: input.title.trim(), version: '1.0.0',
    };
    const metadataHash = sha256(toHex(JSON.stringify(metadata)));
    const metadataURI = input.metadataURI?.trim() || `veilio://services/${encodeURIComponent(input.id)}`;
    const serviceId = pad(stringToHex(input.id), { size: 32, dir: 'right' });
    const registry = options.registryAddress ?? (chainId === 97 ? VEILIO_DEPLOYMENTS.bnbTestnet.serviceRegistry : VEILIO_DEPLOYMENTS.baseSepolia.serviceRegistry);
    const account = typeof wallet.account === 'string' ? wallet.account : wallet.account?.address;
    if (!account || account.toLowerCase() !== seller.toLowerCase()) throw new VeilioSdkError({ code: 'UNAUTHORIZED', message: 'Registry transaction wallet must match the Services API signer.' });
    const txHash = await wallet.writeContract({ address: registry, abi: serviceRegistryAbi, functionName: 'registerService', args: [serviceId, metadataHash, metadataURI], account: wallet.account, chain: wallet.chain } as Parameters<WalletClient['writeContract']>[0]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new VeilioSdkError({ code: 'TRANSACTION_REVERTED', message: `Service registry transaction ${txHash} reverted.`, context: { txHash, serviceId: input.id } });
    const event = parseEventLogs({ abi: serviceRegistryAbi, logs: receipt.logs, eventName: 'ServiceRegistered' }).find((log) => log.args.serviceId.toLowerCase() === serviceId.toLowerCase() && log.args.seller.toLowerCase() === seller.toLowerCase() && log.args.metadataHash.toLowerCase() === metadataHash.toLowerCase() && log.args.metadataURI === metadataURI);
    if (!event) throw new VeilioSdkError({ code: 'CONTRACT_ERROR', message: `Confirmed registry transaction ${txHash} did not emit the expected ServiceRegistered event.`, context: { txHash, serviceId: input.id } });
    return syncServiceListing(input, txHash, createdAt, metadataURI);
  }

  // ------------------------------------------------------- signed order actions
  async function post<T = unknown>(
    action: string,
    orderId: string,
    route: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const id = requireOrderId(orderId);
    const auth: ServiceAuthPayload = await signServiceAuth(signer, action, id);
    const res = await request(`${base}/api/orders/${encodeURIComponent(id)}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, auth }),
    });
    return parse<T>(res, route, id);
  }

  /** Buyer: report a confirmed escrow deposit so the order moves out of AwaitingPayment. */
  async function notifyDeposit(input: NotifyDepositInput) {
    if (!input.txHash) throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'txHash is required.' });
    return post('verify-deposit', input.orderId, 'verify-deposit', {
      txHash: input.txHash,
      ...(input.onChainOrderId ? { onChainOrderId: input.onChainOrderId } : {}),
      buyerAddress: signer.address,
    });
  }

  /** Seller: record the delivery off-chain. Requires the confirmed on-chain `submitDelivery` tx. */
  async function submit(input: SubmitDeliveryApiInput) {
    if (!input.deliveryTxHash || typeof input.deliveryTxHash !== 'string') {
      throw new VeilioSdkError({
        code: 'INVALID_INPUT',
        message: 'deliveryTxHash (the on-chain submitDelivery transaction) is required.',
      });
    }
    if (!input.description || input.description.trim().length < 5) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'description must be at least 5 characters.' });
    }
    return post('submit', input.orderId, 'submit', {
      sellerAddress: signer.address,
      deliveryTxHash: input.deliveryTxHash,
      description: input.description.trim(),
      deliverableReferences: input.deliverableReferences ?? [],
    });
  }

  /** Buyer: ask the seller for changes. */
  async function requestRevision(input: RequestRevisionApiInput) {
    if (!input.feedback || input.feedback.trim().length < 5) {
      throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'feedback must be at least 5 characters.' });
    }
    return post('revision', input.orderId, 'revision', {
      buyerAddress: signer.address,
      feedback: input.feedback.trim(),
    });
  }

  /** Buyer: mark the order Completed (call after the on-chain `releaseFunds`). */
  async function approve(input: ApproveOrderApiInput) {
    if (!input.releaseTxHash) throw new VeilioSdkError({ code: 'INVALID_INPUT', message: 'releaseTxHash is required.' });
    return post('approve', input.orderId, 'approve', {
      buyerAddress: signer.address,
      releaseTxHash: input.releaseTxHash,
    });
  }

  /** Buyer (after deadline) or seller: cancel. Funded orders need the on-chain cancel/refund `txHash`. */
  async function cancel(input: CancelOrderApiInput) {
    return post('cancel', input.orderId, 'cancel', {
      callerAddress: signer.address,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.txHash ? { txHash: input.txHash } : {}),
    });
  }

  /** Seller: record an on-chain `partialRefund` (lower agreed price). The server reads the new escrowed amount. */
  async function partialRefund(input: PartialRefundApiInput) {
    return post('partial-refund', input.orderId, 'partial-refund', {
      callerAddress: signer.address,
      txHash: input.txHash,
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  return {
    apiBaseUrl: base,
    address: signer.address,
    // signed, state-changing order actions
    notifyDeposit,
    submit,
    requestRevision,
    approve,
    cancel,
    partialRefund,
    // session-authenticated reads
    getSession,
    getSessionHeaders,
    getOrder,
    getPaymentRequest,
    listConversations,
    getConversationMessages,
    listServices,
    startConversation,
    sendMessage,
    publishService,
    syncServiceListing,
    syncSolanaServiceListing,
    publishSolanaService,
  };
}
