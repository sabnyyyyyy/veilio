import { VeilioSdkError } from './errors.js';
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
 * State-changing calls are signed per request with `signServiceAuth` (EIP-191 personal_sign,
 * nonce consumed by the server). Reads use a reusable 30-minute session (`signServiceSession`)
 * sent in the `x-veilio-auth` header; it is signed once and cached. The server derives the
 * network from the order itself, so no `network` field is ever sent.
 */
export interface VeilioServicesApiOptions {
  /** e.g. "https://veilio.example". Trailing slashes are ignored. */
  apiBaseUrl: string;
  /** Wallet that signs the auth message (a viem LocalAccount works). Must be the order's buyer/seller. */
  signer: MessageSigner;
  /** Custom fetch (defaults to globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
}

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

  return {
    apiBaseUrl: base,
    address: signer.address,
    // signed, state-changing order actions
    notifyDeposit,
    submit,
    requestRevision,
    approve,
    cancel,
    // session-authenticated reads
    getSession,
    getSessionHeaders,
    getOrder,
    getPaymentRequest,
    listConversations,
    getConversationMessages,
  };
}
