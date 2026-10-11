import fs from 'fs';
import path from 'path';

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
  createdAt: number;
  updatedAt: number;
}

export interface OrderSubmission {
  id: string;
  orderId: string;
  submittedBy: string;
  description: string;
  deliverableReferences: string[];
  submittedAt: number;
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
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db', 'services.json');

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


function ensureDb(): ServicesDatabase {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
    };
  }
}

function writeDb(data: ServicesDatabase): void {
  try {
    ensureDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Services DB] Error writing db file:', err);
  }
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

export function createService(input: Omit<ServiceListing, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): ServiceListing {
  const db = ensureDb();
  const id = input.id || `srv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const newService: ServiceListing = {
    ...input,
    id,
    createdAt: now,
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

  if (current.sellerId.toLowerCase() !== sellerAddress.toLowerCase()) {
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
  const normalizedBuyer = buyerAddress.toLowerCase();
  const normalizedSeller = sellerAddress.toLowerCase();

  // Find existing conversation
  const existing = Object.values(db.conversations).find(
    (c) =>
      c.serviceId === serviceId &&
      c.buyerId.toLowerCase() === normalizedBuyer &&
      c.sellerId.toLowerCase() === normalizedSeller
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
  const addr = userAddress.toLowerCase();
  return Object.values(db.conversations)
    .filter((c) => c.buyerId.toLowerCase() === addr || c.sellerId.toLowerCase() === addr)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

export function getConversationMessages(conversationId: string): ServiceMessage[] {
  const db = ensureDb();
  return db.messages[conversationId] || [];
}

export function addServiceMessage(message: Omit<ServiceMessage, 'id' | 'createdAt'>): ServiceMessage {
  const db = ensureDb();
  const conversation = db.conversations[message.conversationId];
  if (!conversation) throw new Error('Conversation not found');

  const id = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const newMsg: ServiceMessage = {
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

  const pr: PaymentRequest = {
    ...input,
    id,
    status: 'pending',
    createdAt: now,
  };

  db.paymentRequests[id] = pr;

  // Append a structured message into the conversation
  addServiceMessage({
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

  if (pr.buyerId.toLowerCase() !== buyerAddress.toLowerCase()) {
    throw new Error('Unauthorized: only designated buyer can accept this payment request');
  }

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
    buyerId: pr.buyerId.toLowerCase(),
    sellerId: pr.sellerId.toLowerCase(),
    conversationId: pr.conversationId,
    serviceTitle: service?.title || 'Custom Service Order',
    scopeSnapshot: pr.scope,
    priceSnapshot: pr.agreedPrice,
    currency: pr.currency,
    deadline: pr.deadline,
    status: 'AwaitingPayment',
    paymentStatus: 'NotPaid',
    createdAt: now,
    updatedAt: now,
  };

  db.orders[orderId] = order;
  pr.status = 'accepted';

  addServiceMessage({
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

export function getUserOrders(userAddress: string): { asBuyer: ServiceOrder[]; asSeller: ServiceOrder[] } {
  const db = ensureDb();
  const addr = userAddress.toLowerCase();
  const all = Object.values(db.orders);
  return {
    asBuyer: all.filter((o) => o.buyerId === addr).sort((a, b) => b.createdAt - a.createdAt),
    asSeller: all.filter((o) => o.sellerId === addr).sort((a, b) => b.createdAt - a.createdAt),
  };
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

  if (order.sellerId.toLowerCase() !== submittedBy.toLowerCase()) {
    throw new Error('Unauthorized: only seller can submit deliverables');
  }

  const subId = `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const submission: OrderSubmission = {
    id: subId,
    orderId,
    submittedBy: submittedBy.toLowerCase(),
    description,
    deliverableReferences,
    submittedAt: Date.now(),
  };

  if (!db.submissions[orderId]) db.submissions[orderId] = [];
  db.submissions[orderId].push(submission);

  order.status = 'InReview';
  order.updatedAt = Date.now();

  addServiceMessage({
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

  if (order.buyerId.toLowerCase() !== buyerAddress.toLowerCase()) {
    throw new Error('Unauthorized: only buyer can request revision');
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

  addServiceMessage({
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

  const isBuyer = order.buyerId.toLowerCase() === params.initiatorAddress.toLowerCase();
  const isSeller = order.sellerId.toLowerCase() === params.initiatorAddress.toLowerCase();
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
      submittedBy: params.initiatorAddress.toLowerCase(),
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
    initiatorAddress: params.initiatorAddress.toLowerCase(),
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

  addServiceMessage({
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

  const subAddr = params.submittedBy.toLowerCase();
  let partyRole: 'buyer' | 'seller' | 'reviewer' | 'system' = 'system';
  if (subAddr === order.buyerId.toLowerCase()) {
    partyRole = 'buyer';
  } else if (subAddr === order.sellerId.toLowerCase()) {
    partyRole = 'seller';
  } else if (
    process.env.REVIEWER_ADDRESS &&
    subAddr === process.env.REVIEWER_ADDRESS.toLowerCase()
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

  addServiceMessage({
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
    addServiceMessage({
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

  const decision: DisputeReviewDecision = {
    reviewerAddress: params.reviewerAddress.toLowerCase(),
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

    addServiceMessage({
      conversationId: order.conversationId,
      senderId: params.reviewerAddress,
      senderType: 'human',
      content: `[DISPUTE RESOLVED & SETTLED] Reviewer executed on-chain settlement: Buyer Refund ${params.buyerRefundPercent}%, Seller Award ${params.sellerGrossAwardPercent}%. TxHash: ${params.settlementTxHash}`,
    });
  }

  writeDb(db);
  return dispute;
}
