import fs from 'fs';
import path from 'path';
import { getDataDir } from './dataDir';
import { readJsonStore, writeJsonStore } from './jsonStore';

/**
 * Canonical network identifiers for Services listings, payment requests and orders.
 * The network of an order is fixed when the order is created from its payment request
 * and must never be taken from a client request body afterwards.
 */
export type ServiceNetworkId = 'bnb:97' | 'base:84532' | 'solana:devnet';

export const SERVICE_NETWORK_CURRENCY: Record<ServiceNetworkId, string> = {
  'bnb:97': 'BNB',
  'base:84532': 'ETH',
  'solana:devnet': 'SOL',
};

/**
 * Maps canonical ids and the legacy display labels stored by older payment requests
 * ('Base Sepolia', 'Solana Devnet', 'BNB Smart Chain Testnet') to a canonical id.
 */
export function normalizeServiceNetwork(value: unknown): ServiceNetworkId | null {
  if (value === 97 || value === 84532) return value === 97 ? 'bnb:97' : 'base:84532';
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v === 'bnb:97' || v === '97' || v === 'bnb' || v.includes('bnb') || v.includes('bsc')) return 'bnb:97';
  if (v === 'base:84532' || v === '84532' || v === 'base' || v.includes('base')) return 'base:84532';
  if (v === 'solana:devnet' || v === 'solana' || v.includes('solana')) return 'solana:devnet';
  return null;
}

export function isServiceNetworkSolana(network: ServiceNetworkId): boolean {
  return network === 'solana:devnet';
}

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/**
 * Normalizes a wallet address per chain family: EVM (0x) addresses are case-insensitive
 * and are lowercased; Solana base58 public keys are case-sensitive and kept verbatim.
 */
export function normalizeWalletAddress(address: string): string {
  const trimmed = String(address || '').trim();
  return EVM_ADDRESS_REGEX.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

export function sameWalletAddress(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return normalizeWalletAddress(a) === normalizeWalletAddress(b);
}

export interface ServiceListing {
  id: string;
  sellerId: string;
  sellerType: 'human' | 'agent';
  sellerName?: string;
  sellerAvatar?: string;
  title: string;
  description: string;
  category: string;
  price: string; // BNB
  currency: string;
  deliveryTime: string;
  sampleDeliverables: string[];
  status: 'active' | 'inactive';
  rating?: number;
  ordersCompleted?: number;
  onChainRegistered?: boolean;
  registryTxHash?: string;
  metadataHash?: string;
  metadataURI?: string;
  onChainServiceId?: string;
  /** Network the listing is registered on. Legacy listings without it are BNB Testnet. */
  network?: ServiceNetworkId;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  buyerId: string;
  sellerId: string;
  serviceId: string;
  serviceTitle: string;
  createdAt: number;
  lastMessageAt: number;
  lastMessageText: string;
  unreadBuyerCount?: number;
  unreadSellerCount?: number;
}

export interface ServiceMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: 'human' | 'agent';
  content: string;
  createdAt: number;
  readAt?: number;
  paymentRequestId?: string;
  /** Written by the server (escrow events, disputes, ...). User-typed messages never have it. */
  system?: boolean;
}

export interface PaymentRequest {
  id: string;
  conversationId: string;
  serviceId: string;
  buyerId: string;
  sellerId: string;
  description: string;
  scope: string;
  agreedPrice: string;
  currency: string;
  deadline: number;
  revisionTerms: string;
  escrowContract: string;
  network: string;
  status: 'pending' | 'accepted' | 'funded' | 'rejected' | 'expired';
  createdAt: number;
  expiresAt: number;
}

export type OrderStatus =
  | 'PendingSellerAcceptance'
  | 'AwaitingPayment'
  | 'Funded'
  | 'InProgress'
  | 'InReview'
  | 'RevisionRequested'
  | 'Completed'
  | 'Rejected'
  | 'Cancelled'
  | 'Disputed'
  | 'Refunded';

export type OrderPaymentStatus =
  | 'NotPaid'
  | 'PendingConfirmation'
  | 'Funded'
  | 'Released'
  | 'Refunded'
  | 'Disputed'
  | 'Failed';

export interface ServiceOrder {
  id: string;
  serviceId: string;
  paymentRequestId: string;
  buyerId: string;
  sellerId: string;
  conversationId: string;
  serviceTitle: string;
  scopeSnapshot: string;
  priceSnapshot: string;
  currency: string;
  deadline: number;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  escrowReference?: string;
  escrowTxHash?: string;
  /** Settlement network, copied from the payment request when the order is created. */
  network?: ServiceNetworkId;
  /** Price at funding time; set on the first seller price reduction (`priceSnapshot` then tracks the escrowed amount). */
  originalPriceSnapshot?: string;
  /** Seller partial refunds (renegotiated price), oldest first. */
  priceReductions?: OrderPriceReduction[];
  createdAt: number;
  updatedAt: number;
}

export interface TrustPassportApproval {
  address: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

export interface TrustPassportRecord {
  orderId: string;
  proofHash: string;
  snapshot: {
    schema: 'veilio-trust-passport-v1';
    orderId: string;
    serviceId: string;
    serviceTitle: string;
    buyer: string;
    seller: string;
    network: ServiceNetworkId;
    completion: 'completed';
    payment: 'released';
    settlementReference: string;
    evidenceHash: string;
    dispute: 'none' | 'resolved' | 'cancelled';
    disputeOutcome?: string;
    recordedAt: number;
  };
  buyerApproval?: TrustPassportApproval;
  sellerApproval?: TrustPassportApproval;
  anchor?: {
    network: ServiceNetworkId;
    transaction: string;
    anchoredAt: number;
  };
}

export type TrustPassportAnchor = NonNullable<TrustPassportRecord['anchor']>;

export interface OrderPriceReduction {
  refundAmount: string;
  newPrice: string;
  txHash: string;
  reason?: string;
  createdAt: number;
}

export interface OrderSubmission {
  id: string;
  orderId: string;
  submittedBy: string;
  description: string;
  deliverableReferences: string[];
  evidenceFiles?: Array<{ id: string; fileName: string; sha256: string }>;
  submittedAt: number;
}

export interface ServiceEvidenceFile {
  id: string;
  orderId: string;
  uploadedBy: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  storage: 'blob' | 'local';
  storagePath: string;
  uploadedAt: number;
}

export interface OrderRevision {
  id: string;
  orderId: string;
  submissionId?: string;
  feedback: string;
  createdAt: number;
}

export interface DisputeFinding {
  claim: string;
  assessment: 'supported' | 'unsupported' | 'inconclusive';
  evidenceReferences: string[];
  explanation: string;
}

export interface DisputeCancellationAssessment {
  validity: 'valid' | 'invalid' | 'partially_valid' | 'inconclusive';
  reason: string;
}

export interface DisputeRecommendedDistribution {
  buyerRefundPercent: number;
  sellerGrossAwardPercent: number;
  platformFeePercent: 5;
  sellerNetPayoutCalculation: string;
}

export interface DisputeConfidence {
  level: 'low' | 'medium' | 'high';
  explanation: string;
  isCalibratedProbability: false;
}

export interface DisputeEscalation {
  required: boolean;
  reason: string;
}

export interface DisputeAiRecommendation {
  disputeId: string;
  orderId: string;
  policyVersion: string;
  summary: string;
  findings: DisputeFinding[];
  cancellationAssessment: DisputeCancellationAssessment;
  recommendedDistribution: DisputeRecommendedDistribution;
  confidence: DisputeConfidence;
  missingEvidence: string[];
  escalation: DisputeEscalation;
  limitations: string[];
  evaluatedAt: number;
  engineUsed: 'gemini' | 'rule_engine';
}

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  submittedBy: string;
  partyRole: 'buyer' | 'seller' | 'reviewer' | 'system';
  evidenceType: 'claim' | 'file_url' | 'milestone_proof' | 'contract_log' | 'chat_excerpt';
  title: string;
  description: string;
  references: string[];
  submittedAt: number;
}

export interface DisputeReviewDecision {
  reviewerAddress: string;
  decision: 'approved_as_recommended' | 'revised_and_approved' | 'rejected' | 'escalated';
  buyerRefundPercent: number;
  sellerGrossAwardPercent: number;
  reason: string;
  settlementTxHash?: string;
  decidedAt: number;
}

export interface ServiceDispute {
  id: string;
  orderId: string;
  initiatorAddress: string;
  initiatorRole: 'buyer' | 'seller';
  reason: string;
  status: 'initiated' | 'evidence_gathering' | 'under_review' | 'resolved' | 'cancelled';
  cancellationPolicySnapshot: string;
  evidence: DisputeEvidence[];
  disputeTxHash?: string;
  recommendation?: DisputeAiRecommendation;
  reviewDecision?: DisputeReviewDecision;
  createdAt: number;
  updatedAt: number;
}

interface ServicesDatabase {
  services: Record<string, ServiceListing>;
  conversations: Record<string, Conversation>;
  messages: Record<string, ServiceMessage[]>;
  paymentRequests: Record<string, PaymentRequest>;
  orders: Record<string, ServiceOrder>;
  submissions: Record<string, OrderSubmission[]>;
  revisions: Record<string, OrderRevision[]>;
  disputes: Record<string, ServiceDispute>;
  orderDisputeMap: Record<string, string>;
  trustPassport: Record<string, TrustPassportRecord>;
  serviceEvidence: Record<string, ServiceEvidenceFile>;
}

const DATA_DIR = getDataDir();
// VEILIO_SERVICES_DB_FILE lets tests (or a mounted volume) point at an isolated file.
const DB_FILE = process.env.VEILIO_SERVICES_DB_FILE
  ? path.resolve(process.env.VEILIO_SERVICES_DB_FILE)
  : path.join(DATA_DIR, 'db', 'services.json');

/**
 * Production initial services list is empty by default.
 * Services must be explicitly created by users or verified on-chain.
 */
const INITIAL_SERVICES: ServiceListing[] = [];

/**
 * Isolated test fixture services for automated test suites only.
 */
export const TEST_FIXTURE_SERVICES: ServiceListing[] = [
  {
    id: 'test-fixture-audit-01',
    sellerId: '0x999999cf1046e68e36e1aa2e0e07105eddd7f5e1',
    sellerType: 'agent',
    sellerName: 'SentinEL Security Agent (Fixture)',
    title: 'Test Fixture: Smart Contract Security Audit',
    description: 'Automated vulnerability scan for test fixture isolation.',
    category: 'Smart Contract Audit',
    price: '0.25',
    currency: 'BNB',
    deliveryTime: '2 Hours',
    sampleDeliverables: ['Sample Audit Report'],
    status: 'active',
    createdAt: 1775550000000,
    updatedAt: 1775550000000,
  },
];


function emptyServicesDb(): ServicesDatabase {
  const initial: ServicesDatabase = {
    services: {},
    conversations: {},
    messages: {},
    paymentRequests: {},
    orders: {},
    submissions: {},
    revisions: {},
    disputes: {},
    orderDisputeMap: {},
    trustPassport: {},
    serviceEvidence: {},
  };
  for (const s of INITIAL_SERVICES) {
    initial.services[s.id] = s;
  }
  return initial;
}

function ensureDb(): ServicesDatabase {
  // Production: the request's snapshot from Redis (lib/server/jsonStore.ts).
  const stored = readJsonStore<Partial<ServicesDatabase>>('services');
  if (stored !== undefined) {
    return stored === null ? emptyServicesDb() : { ...emptyServicesDb(), ...stored };
  }

  const dbDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  if (!fs.existsSync(DB_FILE)) {
    const initial: ServicesDatabase = {
      services: {},
      conversations: {},
      messages: {},
      paymentRequests: {},
      orders: {},
      submissions: {},
      revisions: {},
      disputes: {},
      orderDisputeMap: {},
      trustPassport: {},
      serviceEvidence: {},
    };
    for (const s of INITIAL_SERVICES) {
      initial.services[s.id] = s;
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as ServicesDatabase;
    return {
      services: parsed.services || {},
      conversations: parsed.conversations || {},
      messages: parsed.messages || {},
      paymentRequests: parsed.paymentRequests || {},
      orders: parsed.orders || {},
      submissions: parsed.submissions || {},
      revisions: parsed.revisions || {},
      disputes: parsed.disputes || {},
      orderDisputeMap: parsed.orderDisputeMap || {},
      trustPassport: parsed.trustPassport || {},
      serviceEvidence: parsed.serviceEvidence || {},
    };
  } catch (err) {
    console.error('[Services DB] Failed to parse db file, reinitializing', err);
    return {
      services: {},
      conversations: {},
      messages: {},
      paymentRequests: {},
      orders: {},
      submissions: {},
      revisions: {},
      disputes: {},
      orderDisputeMap: {},
      trustPassport: {},
      serviceEvidence: {},
    };
  }
}

export function saveServiceEvidenceFile(file: ServiceEvidenceFile): void {
  const db = ensureDb();
  if (!db.orders[file.orderId]) throw new Error('Order not found for evidence attachment.');
  db.serviceEvidence[file.id] = file;
  writeDb(db);
}

export function getServiceEvidenceFile(id: string): ServiceEvidenceFile | null {
  return ensureDb().serviceEvidence[id] || null;
}

export function getServiceEvidenceFiles(orderId: string): ServiceEvidenceFile[] {
  return Object.values(ensureDb().serviceEvidence).filter((file) => file.orderId === orderId).sort((a, b) => a.uploadedAt - b.uploadedAt);
}

/**
 * Persists the whole database. Errors are surfaced to the caller (and therefore to the
 * API response) instead of being swallowed, so a route never reports success for a
 * state change that was not stored. The write goes through a temp file + rename so a
 * crash mid-write cannot leave a truncated JSON file behind.
 */
function writeDb(data: ServicesDatabase): void {
  if (writeJsonStore('services', data)) return;

  const dbDir = path.dirname(DB_FILE);
  try {
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    const tmpFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('[Services DB] Error writing db file:', err);
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Services database write failed: ${reason}`);
  }
}

/**
 * Appends a message to the given in-memory database object WITHOUT persisting it.
 * Every operation that both changes state and posts a system message must use this on
 * the same `db` object and then call writeDb(db) once; calling the persisting
 * addServiceMessage() in the middle of an operation would be overwritten by the outer
 * stale writeDb(db) (lost-write).
 */
function appendServiceMessage(
  db: ServicesDatabase,
  message: Omit<ServiceMessage, 'id' | 'createdAt'>
): ServiceMessage {
  const conversation = db.conversations[message.conversationId];
  if (!conversation) throw new Error('Conversation not found');

  const id = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const newMsg: ServiceMessage = {
    // Notices posted by state-changing operations are system messages unless stated otherwise.
    system: true,
    ...message,
    id,
    createdAt: now,
  };

  if (!db.messages[message.conversationId]) {
    db.messages[message.conversationId] = [];
  }
  db.messages[message.conversationId].push(newMsg);

  // Update conversation last message preview
  conversation.lastMessageAt = now;
  conversation.lastMessageText = message.content.slice(0, 120);
  return newMsg;
}

// ==========================================
// SERVICE LISTING FUNCTIONS
// ==========================================

export function getAllServices(filter?: {
  query?: string;
  category?: string;
  sellerType?: 'human' | 'agent' | 'all';
  status?: 'active' | 'inactive' | 'all';
}): ServiceListing[] {
  const db = ensureDb();
  let list = Object.values(db.services);

  if (filter?.status && filter.status !== 'all') {
    list = list.filter((s) => s.status === filter.status);
  } else if (!filter?.status) {
    list = list.filter((s) => s.status === 'active');
  }

  if (filter?.sellerType && filter.sellerType !== 'all') {
    list = list.filter((s) => s.sellerType === filter.sellerType);
  }

  if (filter?.category && filter.category !== 'all') {
    const cat = filter.category.toLowerCase();
    list = list.filter((s) => s.category.toLowerCase() === cat);
  }

  if (filter?.query && filter.query.trim()) {
    const q = filter.query.toLowerCase().trim();
    list = list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.sellerName && s.sellerName.toLowerCase().includes(q))
    );
  }

  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export function getServiceById(id: string): ServiceListing | null {
  const db = ensureDb();
  return db.services[id] || null;
}

/**
 * Creates a listing. `createdAt` must be the exact value that was hashed into the
 * on-chain metadata hash (see lib/serviceRegistry.ts); it is stored verbatim so later
 * verification recomputes the same hash.
 */
export function createService(
  input: Omit<ServiceListing, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: number }
): ServiceListing {
  const db = ensureDb();
  const id = input.id || `srv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  if (db.services[id]) {
    throw new Error(`Service ${id} already exists`);
  }
  const now = Date.now();
  const createdAt = Number.isSafeInteger(input.createdAt) && (input.createdAt as number) > 0
    ? (input.createdAt as number)
    : now;
  const newService: ServiceListing = {
    ...input,
    id,
    sellerId: normalizeWalletAddress(input.sellerId),
    createdAt,
    updatedAt: now,
  };
  db.services[id] = newService;
  writeDb(db);
  return newService;
}

export function updateService(
  id: string,
  sellerAddress: string,
  updates: Partial<Omit<ServiceListing, 'id' | 'sellerId' | 'sellerType' | 'createdAt'>>
): ServiceListing | null {
  const db = ensureDb();
  const current = db.services[id];
  if (!current) return null;

  if (!sameWalletAddress(current.sellerId, sellerAddress)) {
    throw new Error('Unauthorized: only the service seller can edit this listing');
  }

  const updated: ServiceListing = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
  };

  db.services[id] = updated;
  writeDb(db);
  return updated;
}

// ==========================================
// CONVERSATIONS & MESSAGING FUNCTIONS
// ==========================================

export function getOrCreateConversation(buyerAddress: string, sellerAddress: string, serviceId: string, serviceTitle: string): Conversation {
  const db = ensureDb();
  const normalizedBuyer = normalizeWalletAddress(buyerAddress);
  const normalizedSeller = normalizeWalletAddress(sellerAddress);

  // Find existing conversation
  const existing = Object.values(db.conversations).find(
    (c) =>
      c.serviceId === serviceId &&
      sameWalletAddress(c.buyerId, normalizedBuyer) &&
      sameWalletAddress(c.sellerId, normalizedSeller)
  );

  if (existing) return existing;

  const id = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const newConv: Conversation = {
    id,
    buyerId: normalizedBuyer,
    sellerId: normalizedSeller,
    serviceId,
    serviceTitle,
    createdAt: now,
    lastMessageAt: now,
    lastMessageText: 'Conversation started',
    unreadBuyerCount: 0,
    unreadSellerCount: 0,
  };

  db.conversations[id] = newConv;
  if (!db.messages[id]) db.messages[id] = [];
  writeDb(db);
  return newConv;
}

export function getConversationById(id: string): Conversation | null {
  const db = ensureDb();
  return db.conversations[id] || null;
}

export function getUserConversations(userAddress: string): Conversation[] {
  const db = ensureDb();
  return Object.values(db.conversations)
    .filter((c) => sameWalletAddress(c.buyerId, userAddress) || sameWalletAddress(c.sellerId, userAddress))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function getConversationMessages(conversationId: string): ServiceMessage[] {
  const db = ensureDb();
  return db.messages[conversationId] || [];
}

/**
 * Standalone (persisting) message append. Only for callers that do not otherwise
 * modify the database in the same operation (e.g. a plain chat message).
 */
export function addServiceMessage(message: Omit<ServiceMessage, 'id' | 'createdAt'>): ServiceMessage {
  const db = ensureDb();
  // Only the chat route posts through here: these are always user-typed messages.
  const newMsg = appendServiceMessage(db, { ...message, system: false });
  writeDb(db);
  return newMsg;
}

// ==========================================
// PAYMENT REQUEST FUNCTIONS
// ==========================================

export function createPaymentRequest(input: Omit<PaymentRequest, 'id' | 'status' | 'createdAt'>): PaymentRequest {
  const db = ensureDb();
  const id = `pr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  if (!db.conversations[input.conversationId]) {
    throw new Error('Conversation not found');
  }

  const pr: PaymentRequest = {
    ...input,
    buyerId: normalizeWalletAddress(input.buyerId),
    sellerId: normalizeWalletAddress(input.sellerId),
    id,
    status: 'pending',
    createdAt: now,
  };

  db.paymentRequests[id] = pr;

  // Append a structured message into the conversation (same db object, single write)
  appendServiceMessage(db, {
    conversationId: input.conversationId,
    senderId: input.sellerId,
    senderType: 'human',
    content: `[PAYMENT REQUEST] ${input.description} - Amount: ${input.agreedPrice} ${input.currency}`,
    paymentRequestId: id,
  });

  writeDb(db);
  return pr;
}

export function getPaymentRequest(id: string): PaymentRequest | null {
  const db = ensureDb();
  return db.paymentRequests[id] || null;
}

export function updatePaymentRequestStatus(id: string, status: PaymentRequest['status']): PaymentRequest | null {
  const db = ensureDb();
  const pr = db.paymentRequests[id];
  if (!pr) return null;
  pr.status = status;
  writeDb(db);
  return pr;
}

// ==========================================
// SERVICE ORDERS FUNCTIONS
// ==========================================

export function createOrderFromPaymentRequest(paymentRequestId: string, buyerAddress: string): ServiceOrder {
  const db = ensureDb();
  const pr = db.paymentRequests[paymentRequestId];
  if (!pr) throw new Error('Payment request not found');

  if (pr.status !== 'pending') {
    // If order already exists for this payment request, prevent duplicate order creation (SEC-NEW-02)
    const existingOrder = Object.values(db.orders).find((o) => o.paymentRequestId === paymentRequestId);
    if (existingOrder) {
      return existingOrder;
    }
    throw new Error(`Payment request is already ${pr.status}`);
  }

  if (!sameWalletAddress(pr.buyerId, buyerAddress)) {
    throw new Error('Unauthorized: only designated buyer can accept this payment request');
  }

  if (pr.expiresAt && Date.now() > pr.expiresAt) {
    throw new Error('Payment request has expired; ask the seller to issue a new one');
  }

  const network = normalizeServiceNetwork(pr.network) || networkFromCurrency(pr.currency);

  // Prevent duplicate order creation if an order already exists for this payment request
  const existingOrder = Object.values(db.orders).find((o) => o.paymentRequestId === paymentRequestId);
  if (existingOrder) {
    return existingOrder;
  }

  const orderId = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  const service = db.services[pr.serviceId];

  const order: ServiceOrder = {
    id: orderId,
    serviceId: pr.serviceId,
    paymentRequestId: pr.id,
    buyerId: normalizeWalletAddress(pr.buyerId),
    sellerId: normalizeWalletAddress(pr.sellerId),
    conversationId: pr.conversationId,
    serviceTitle: service?.title || 'Custom Service Order',
    scopeSnapshot: pr.scope,
    priceSnapshot: pr.agreedPrice,
    currency: pr.currency,
    deadline: pr.deadline,
    status: 'AwaitingPayment',
    paymentStatus: 'NotPaid',
    network,
    createdAt: now,
    updatedAt: now,
  };

  db.orders[orderId] = order;
  pr.status = 'accepted';

  appendServiceMessage(db, {
    conversationId: pr.conversationId,
    senderId: buyerAddress,
    senderType: 'human',
    content: `[ORDER CREATED] Order #${orderId} created from Payment Request. Awaiting on-chain escrow deposit of ${pr.agreedPrice} ${pr.currency}.`,
  });

  writeDb(db);
  return order;
}

export function getOrderById(id: string): ServiceOrder | null {
  const db = ensureDb();
  return db.orders[id] || null;
}

function networkFromCurrency(currency: string | undefined): ServiceNetworkId {
  const c = String(currency || '').toUpperCase();
  if (c === 'ETH') return 'base:84532';
  if (c === 'SOL') return 'solana:devnet';
  return 'bnb:97';
}

/**
 * Server-authoritative settlement network of an order: the stored order.network, else
 * the network of its payment request, else (legacy rows) derived from the currency.
 * Routes must use this and reject a request body whose `network` disagrees.
 */
export function getOrderNetwork(order: ServiceOrder): ServiceNetworkId {
  const stored = normalizeServiceNetwork(order.network);
  if (stored) return stored;
  if (order.paymentRequestId) {
    const pr = getPaymentRequest(order.paymentRequestId);
    const fromPr = pr ? normalizeServiceNetwork(pr.network) : null;
    if (fromPr) return fromPr;
  }
  return networkFromCurrency(order.currency);
}

/** All orders where `sellerAddress` is the provider (used for reputation). */
export function getOrdersBySeller(sellerAddress: string): ServiceOrder[] {
  const db = ensureDb();
  return Object.values(db.orders).filter((o) => sameWalletAddress(o.sellerId, sellerAddress));
}

export function getUserOrders(userAddress: string): { asBuyer: ServiceOrder[]; asSeller: ServiceOrder[] } {
  const db = ensureDb();
  const all = Object.values(db.orders);
  return {
    asBuyer: all.filter((o) => sameWalletAddress(o.buyerId, userAddress)).sort((a, b) => b.createdAt - a.createdAt),
    asSeller: all.filter((o) => sameWalletAddress(o.sellerId, userAddress)).sort((a, b) => b.createdAt - a.createdAt),
  };
}

/** Returns signed trust-passport records for one vendor wallet (public profile data). */
export function getTrustPassportRecords(sellerAddress: string): TrustPassportRecord[] {
  const db = ensureDb();
  return Object.values(db.trustPassport)
    .filter((record) => sameWalletAddress(record.snapshot.seller, sellerAddress) && record.buyerApproval && record.sellerApproval)
    .sort((a, b) => b.snapshot.recordedAt - a.snapshot.recordedAt);
}

export function getTrustPassportRecordByOrder(orderId: string): TrustPassportRecord | null {
  return ensureDb().trustPassport[orderId] || null;
}

/** Stores a participant's approval of one immutable, server-derived outcome snapshot. */
export function saveTrustPassportApproval(
  record: TrustPassportRecord,
  role: 'buyer' | 'seller',
  approval: TrustPassportApproval,
): TrustPassportRecord {
  const db = ensureDb();
  const current = db.trustPassport[record.orderId];
  if (current && current.proofHash !== record.proofHash) throw new OrderStateConflictError('Passport proof changed; request a fresh signature.');
  const next: TrustPassportRecord = current || record;
  next[role === 'buyer' ? 'buyerApproval' : 'sellerApproval'] = approval;
  db.trustPassport[record.orderId] = next;
  writeDb(db);
  return next;
}

/** Attaches the verified public-chain transaction to a mutually approved record. */
export function saveTrustPassportAnchor(orderId: string, proofHash: string, anchor: TrustPassportAnchor): TrustPassportRecord {
  const db = ensureDb();
  const current = db.trustPassport[orderId];
  if (!current || current.proofHash !== proofHash || !current.buyerApproval || !current.sellerApproval) {
    throw new OrderStateConflictError('Both participants must approve the same passport proof before it can be anchored.');
  }
  if (current.anchor && (current.anchor.transaction !== anchor?.transaction || current.anchor.network !== anchor.network)) {
    throw new OrderStateConflictError('This passport proof is already anchored on-chain.');
  }
  current.anchor = anchor;
  db.trustPassport[orderId] = current;
  writeDb(db);
  return current;
}

/** Statuses in which escrow funds are locked on-chain and not under dispute. */
export const FUNDED_ACTIVE_ORDER_STATUSES: OrderStatus[] = ['Funded', 'InProgress', 'InReview', 'RevisionRequested'];

export class OrderStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderStateConflictError';
  }
}

/**
 * Atomically (single read-modify-write) moves an order to a new status, but only if it
 * is currently in one of `from`. Optionally syncs the payment request status and posts a
 * system message in the same write. Throws OrderStateConflictError on a bad transition.
 */
export function transitionOrderStatus(params: {
  orderId: string;
  from: OrderStatus[];
  to: OrderStatus;
  paymentStatus?: OrderPaymentStatus;
  escrowReference?: string;
  txHash?: string;
  paymentRequestStatus?: PaymentRequest['status'];
  message?: Omit<ServiceMessage, 'id' | 'createdAt' | 'conversationId'>;
}): ServiceOrder {
  const db = ensureDb();
  const order = db.orders[params.orderId];
  if (!order) throw new Error('Order not found');

  if (!params.from.includes(order.status)) {
    throw new OrderStateConflictError(
      `Invalid order state transition: '${order.status}' -> '${params.to}' (allowed from: ${params.from.join(', ')})`
    );
  }

  order.status = params.to;
  if (params.paymentStatus) order.paymentStatus = params.paymentStatus;
  if (params.escrowReference) order.escrowReference = params.escrowReference;
  if (params.txHash) order.escrowTxHash = params.txHash;
  order.updatedAt = Date.now();

  if (params.paymentRequestStatus && order.paymentRequestId) {
    const pr = db.paymentRequests[order.paymentRequestId];
    if (pr) pr.status = params.paymentRequestStatus;
  }

  if (params.message) {
    appendServiceMessage(db, { ...params.message, conversationId: order.conversationId });
  }

  writeDb(db);
  return order;
}

/**
 * Records a verified on-chain partial refund: `priceSnapshot` becomes the amount still escrowed.
 * The order must still be funded and active, and each tx can only be applied once.
 */
export function applyOrderPriceReduction(params: {
  orderId: string;
  refundAmount: string;
  newPrice: string;
  txHash: string;
  reason?: string;
  message?: Omit<ServiceMessage, 'id' | 'createdAt' | 'conversationId'>;
}): ServiceOrder {
  const db = ensureDb();
  const order = db.orders[params.orderId];
  if (!order) throw new Error('Order not found');

  if (!FUNDED_ACTIVE_ORDER_STATUSES.includes(order.status) || order.paymentStatus !== 'Funded') {
    throw new OrderStateConflictError(`Price can only be reduced on a funded, active order (current: ${order.status})`);
  }
  const txHash = params.txHash.toLowerCase();
  if ((order.priceReductions ?? []).some((r) => r.txHash.toLowerCase() === txHash)) {
    throw new OrderStateConflictError('This partial refund transaction was already recorded');
  }

  order.originalPriceSnapshot ??= order.priceSnapshot;
  order.priceSnapshot = params.newPrice;
  order.priceReductions = [
    ...(order.priceReductions ?? []),
    { refundAmount: params.refundAmount, newPrice: params.newPrice, txHash: params.txHash, reason: params.reason, createdAt: Date.now() },
  ];
  order.updatedAt = Date.now();

  if (params.message) {
    appendServiceMessage(db, { ...params.message, conversationId: order.conversationId });
  }

  writeDb(db);
  return order;
}

export function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  paymentStatus?: OrderPaymentStatus,
  escrowReference?: string,
  txHash?: string
): ServiceOrder | null {
  const db = ensureDb();
  const order = db.orders[orderId];
  if (!order) return null;

  order.status = status;
  if (paymentStatus) order.paymentStatus = paymentStatus;
  if (escrowReference) order.escrowReference = escrowReference;
  if (txHash) order.escrowTxHash = txHash;
  order.updatedAt = Date.now();

  writeDb(db);
  return order;
}

// Submissions
export function addOrderSubmission(
  orderId: string,
  submittedBy: string,
  description: string,
  deliverableReferences: string[]
): OrderSubmission {
  const db = ensureDb();
  const order = db.orders[orderId];
  if (!order) throw new Error('Order not found');

  if (!sameWalletAddress(order.sellerId, submittedBy)) {
    throw new Error('Unauthorized: only seller can submit deliverables');
  }

  // Deliverables can only be submitted (or re-submitted) while escrow is funded and the
  // order is not disputed / settled.
  const submittable: OrderStatus[] = ['Funded', 'InProgress', 'RevisionRequested', 'InReview'];
  if (!submittable.includes(order.status) || order.paymentStatus !== 'Funded') {
    throw new OrderStateConflictError(
      `Cannot submit deliverables while order is '${order.status}' (payment: ${order.paymentStatus})`
    );
  }

  const subId = `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const submission: OrderSubmission = {
    id: subId,
    orderId,
    submittedBy: normalizeWalletAddress(submittedBy),
    description,
    deliverableReferences,
    submittedAt: Date.now(),
  };

  if (!db.submissions[orderId]) db.submissions[orderId] = [];
  db.submissions[orderId].push(submission);

  order.status = 'InReview';
  order.updatedAt = Date.now();

  appendServiceMessage(db, {
    conversationId: order.conversationId,
    senderId: submittedBy,
    senderType: 'human',
    content: `[WORK SUBMITTED] Seller submitted deliverables for review for Order #${orderId}.`,
  });

  writeDb(db);
  return submission;
}

export function getOrderSubmissions(orderId: string): OrderSubmission[] {
  const db = ensureDb();
  return db.submissions[orderId] || [];
}

// Revisions
export function addOrderRevision(orderId: string, buyerAddress: string, feedback: string): OrderRevision {
  const db = ensureDb();
  const order = db.orders[orderId];
  if (!order) throw new Error('Order not found');

  if (!sameWalletAddress(order.buyerId, buyerAddress)) {
    throw new Error('Unauthorized: only buyer can request revision');
  }

  // A revision can only be requested on submitted work that is under review.
  if (order.status !== 'InReview') {
    throw new OrderStateConflictError(
      `Cannot request a revision while order is '${order.status}' (expected 'InReview')`
    );
  }

  const revId = `rev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const revision: OrderRevision = {
    id: revId,
    orderId,
    feedback,
    createdAt: Date.now(),
  };

  if (!db.revisions[orderId]) db.revisions[orderId] = [];
  db.revisions[orderId].push(revision);

  order.status = 'RevisionRequested';
  order.updatedAt = Date.now();

  appendServiceMessage(db, {
    conversationId: order.conversationId,
    senderId: buyerAddress,
    senderType: 'human',
    content: `[REVISION REQUESTED] Buyer requested revisions for Order #${orderId}: "${feedback}"`,
  });

  writeDb(db);
  return revision;
}

export function getOrderRevisions(orderId: string): OrderRevision[] {
  const db = ensureDb();
  return db.revisions[orderId] || [];
}

// ============================================================================
// Service Disputes Management
// ============================================================================

export function createServiceDispute(params: {
  orderId: string;
  initiatorAddress: string;
  reason: string;
  evidenceTitle?: string;
  evidenceDescription?: string;
  evidenceReferences?: string[];
  disputeTxHash?: string;
}): ServiceDispute {
  const db = ensureDb();
  const order = db.orders[params.orderId];
  if (!order) {
    throw new Error('Order not found');
  }

  const isBuyer = sameWalletAddress(order.buyerId, params.initiatorAddress);
  const isSeller = sameWalletAddress(order.sellerId, params.initiatorAddress);
  if (!isBuyer && !isSeller) {
    throw new Error('Unauthorized: only the buyer or seller can dispute this order');
  }

  // Prevent duplicate active dispute
  const existingDisputeId = db.orderDisputeMap[params.orderId];
  if (existingDisputeId) {
    const existing = db.disputes[existingDisputeId];
    if (existing && existing.status !== 'resolved' && existing.status !== 'cancelled') {
      throw new Error(`An active dispute already exists for this order (#${existingDisputeId})`);
    }
  }

  const eligibleStatuses: OrderStatus[] = ['Funded', 'InProgress', 'InReview', 'RevisionRequested'];
  if (!eligibleStatuses.includes(order.status)) {
    throw new Error(`Order cannot be disputed in its current status: ${order.status}`);
  }

  const disputeId = `disp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const role: 'buyer' | 'seller' = isBuyer ? 'buyer' : 'seller';

  const initialEvidence: DisputeEvidence[] = [
    {
      id: `ev-${Date.now()}-init`,
      disputeId,
      submittedBy: normalizeWalletAddress(params.initiatorAddress),
      partyRole: role,
      evidenceType: 'claim',
      title: params.evidenceTitle || `Initial Dispute Claim by ${role.toUpperCase()}`,
      description: params.evidenceDescription || params.reason,
      references: params.evidenceReferences || [],
      submittedAt: Date.now(),
    },
  ];

  const dispute: ServiceDispute = {
    id: disputeId,
    orderId: params.orderId,
    initiatorAddress: normalizeWalletAddress(params.initiatorAddress),
    initiatorRole: role,
    reason: params.reason,
    status: 'initiated',
    cancellationPolicySnapshot:
      'VEILIO Dispute Policy v1: Escrow fund split is evaluated against agreed scope, milestone delivery proof, deadline compliance, and mutual evidence. 5% platform fee applies to seller gross payout only. AI provides explainable recommendation; human reviewer approval required before on-chain settlement.',
    evidence: initialEvidence,
    disputeTxHash: params.disputeTxHash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  db.disputes[disputeId] = dispute;
  db.orderDisputeMap[params.orderId] = disputeId;

  // Transition order status
  order.status = 'Disputed';
  order.paymentStatus = 'Disputed';
  order.updatedAt = Date.now();

  appendServiceMessage(db, {
    conversationId: order.conversationId,
    senderId: params.initiatorAddress,
    senderType: 'human',
    content: `[DISPUTE OPENED] Order #${order.id} was flagged for dispute resolution by ${role.toUpperCase()}: "${params.reason}". Evidence gathering initiated.`,
  });

  writeDb(db);
  return dispute;
}

export function getDisputeById(disputeId: string): ServiceDispute | null {
  const db = ensureDb();
  return db.disputes[disputeId] || null;
}

export function getDisputeByOrderId(orderId: string): ServiceDispute | null {
  const db = ensureDb();
  const disputeId = db.orderDisputeMap[orderId];
  if (!disputeId) return null;
  return db.disputes[disputeId] || null;
}

export function addDisputeEvidence(params: {
  disputeId: string;
  submittedBy: string;
  evidenceType: 'claim' | 'file_url' | 'milestone_proof' | 'contract_log' | 'chat_excerpt';
  title: string;
  description: string;
  references?: string[];
}): DisputeEvidence {
  const db = ensureDb();
  const dispute = db.disputes[params.disputeId];
  if (!dispute) {
    throw new Error('Dispute not found');
  }

  if (dispute.status === 'resolved' || dispute.status === 'cancelled') {
    throw new Error(`Cannot add evidence to a dispute in status: ${dispute.status}`);
  }

  const order = db.orders[dispute.orderId];
  if (!order) {
    throw new Error('Associated order not found');
  }

  const subAddr = normalizeWalletAddress(params.submittedBy);
  let partyRole: 'buyer' | 'seller' | 'reviewer' | 'system' = 'system';
  if (sameWalletAddress(subAddr, order.buyerId)) {
    partyRole = 'buyer';
  } else if (sameWalletAddress(subAddr, order.sellerId)) {
    partyRole = 'seller';
  } else if (
    sameWalletAddress(subAddr, process.env.REVIEWER_ADDRESS) ||
    sameWalletAddress(subAddr, process.env.NEXT_PUBLIC_SOLANA_SERVICE_REVIEWER)
  ) {
    partyRole = 'reviewer';
  } else {
    // Unrelated user check
    throw new Error('Unauthorized: only dispute participants or authorized reviewer can submit evidence');
  }

  const evidenceItem: DisputeEvidence = {
    id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    disputeId: params.disputeId,
    submittedBy: subAddr,
    partyRole,
    evidenceType: params.evidenceType,
    title: params.title,
    description: params.description,
    references: params.references || [],
    submittedAt: Date.now(),
  };

  dispute.evidence.push(evidenceItem);
  if (dispute.status === 'initiated') {
    dispute.status = 'evidence_gathering';
  }
  dispute.updatedAt = Date.now();

  appendServiceMessage(db, {
    conversationId: order.conversationId,
    senderId: params.submittedBy,
    senderType: 'human',
    content: `[EVIDENCE SUBMITTED] ${partyRole.toUpperCase()} submitted evidence: "${params.title}"`,
  });

  writeDb(db);
  return evidenceItem;
}

export function saveDisputeRecommendation(
  disputeId: string,
  recommendation: DisputeAiRecommendation
): ServiceDispute {
  const db = ensureDb();
  const dispute = db.disputes[disputeId];
  if (!dispute) {
    throw new Error('Dispute not found');
  }

  dispute.recommendation = recommendation;
  dispute.status = 'under_review';
  dispute.updatedAt = Date.now();

  const order = db.orders[dispute.orderId];
  if (order) {
    appendServiceMessage(db, {
      conversationId: order.conversationId,
      senderId: 'ai-evaluator',
      senderType: 'agent',
      content: `[AI EVALUATION COMPLETE] Recommended Split: Buyer ${recommendation.recommendedDistribution.buyerRefundPercent}% / Seller ${recommendation.recommendedDistribution.sellerGrossAwardPercent}%. Pending designated human reviewer approval.`,
    });
  }

  writeDb(db);
  return dispute;
}

export function recordReviewerDecision(params: {
  disputeId: string;
  reviewerAddress: string;
  decision: 'approved_as_recommended' | 'revised_and_approved' | 'rejected' | 'escalated';
  buyerRefundPercent: number;
  sellerGrossAwardPercent: number;
  reason: string;
  settlementTxHash?: string;
}): ServiceDispute {
  const db = ensureDb();
  const dispute = db.disputes[params.disputeId];
  if (!dispute) {
    throw new Error('Dispute not found');
  }

  if (params.buyerRefundPercent + params.sellerGrossAwardPercent !== 100) {
    throw new Error('Buyer refund percent and seller gross award percent must sum to exactly 100%');
  }

  const order = db.orders[dispute.orderId];
  if (!order) {
    throw new Error('Associated order not found');
  }

  if (params.settlementTxHash && (order.status !== 'Disputed' || dispute.status === 'resolved')) {
    throw new OrderStateConflictError(
      `Cannot settle dispute: order is '${order.status}' and dispute is '${dispute.status}'`
    );
  }

  const decision: DisputeReviewDecision = {
    reviewerAddress: normalizeWalletAddress(params.reviewerAddress),
    decision: params.decision,
    buyerRefundPercent: params.buyerRefundPercent,
    sellerGrossAwardPercent: params.sellerGrossAwardPercent,
    reason: params.reason,
    settlementTxHash: params.settlementTxHash,
    decidedAt: Date.now(),
  };

  dispute.reviewDecision = decision;
  dispute.updatedAt = Date.now();

  if (params.settlementTxHash) {
    dispute.status = 'resolved';
    order.status = params.buyerRefundPercent === 100 ? 'Refunded' : 'Completed';
    order.paymentStatus = params.buyerRefundPercent === 100 ? 'Refunded' : 'Released';
    order.escrowTxHash = params.settlementTxHash;
    order.updatedAt = Date.now();

    appendServiceMessage(db, {
      conversationId: order.conversationId,
      senderId: params.reviewerAddress,
      senderType: 'human',
      content: `[DISPUTE RESOLVED & SETTLED] Reviewer executed on-chain settlement: Buyer Refund ${params.buyerRefundPercent}%, Seller Award ${params.sellerGrossAwardPercent}%. TxHash: ${params.settlementTxHash}`,
    });
  }

  writeDb(db);
  return dispute;
}
