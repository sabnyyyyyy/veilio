import fs from 'fs';
import path from 'path';
import { saveRefundEvidence, type RefundEvidence } from './refundDb';
import { computeCanonicalEvidenceHash, type CanonicalEvidencePackage } from './evidenceHash';
import type { GeminiValidationOutput } from './gemini';

export interface TransactionRecord {
  id: string; // Typically auctionId as string
  auctionId: string;
  buyerAddress: string;
  sellerAddress: string;
  assetType: string;
  paymentStatus: 'pending' | 'escrowed' | 'settled' | 'refunded';
  deliveryStatus:
    | 'pending_delivery'
    | 'delivery_submitted'
    | 'verification_required'
    | 'delivered'
    | 'access_granted'
    | 'delivery_disputed'
    | 'resolved';
  disputeStatus:
    | 'none'
    | 'draft'
    | 'submitted'
    | 'awaiting_seller_response'
    | 'awaiting_evidence'
    | 'under_review'
    | 'resolution_proposed'
    | 'resolved_for_buyer'
    | 'resolved_for_seller'
    | 'closed';
  inspectionDeadline?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TransactionMessage {
  id: string;
  transactionId: string;
  senderType: 'buyer' | 'seller' | 'ai_validator' | 'agent';
  senderAddress: string;
  messageType:
    | 'text'
    | 'evidence_submission'
    | 'ai_validation_report'
    | 'delivery_notice'
    | 'dispute_alert'
    | 'agent_structured';
  content: string;
  attachmentReferences?: string[];
  structuredPayload?: Record<string, unknown>;
  createdAt: number;
}

export interface DisputeRecord {
  id: string;
  transactionId: string;
  auctionId: string;
  openedBy: string;
  issueCategory: string;
  expectedCondition: string;
  actualCondition: string;
  description: string;
  evidenceReferences: string[];
  requestedResolution: string;
  status:
    | 'submitted'
    | 'awaiting_seller_response'
    | 'awaiting_evidence'
    | 'under_review'
    | 'resolution_proposed'
    | 'resolved_for_buyer'
    | 'resolved_for_seller'
    | 'closed';
  sellerResponse?: {
    respondedAt: number;
    statement: string;
    evidenceReferences?: string[];
  };
  aiAssessment?: GeminiValidationOutput;
  evidenceHash: string;
  finalDecision?: string;
  decidedBy?: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface DeliveryEvidenceRecord {
  id: string;
  transactionId: string;
  submittedBy: string;
  evidenceType: 'file_manifest' | 'access_endpoint' | 'license_document' | 'diagnostic_report' | 'nft_receipt';
  reference: string;
  verificationStatus: 'verified' | 'unverified' | 'rejected';
  metadata?: Record<string, unknown>;
  createdAt: number;
}

interface TransactionsDatabase {
  transactions: Record<string, TransactionRecord>;
  messages: Record<string, TransactionMessage[]>;
  disputes: Record<string, DisputeRecord>;
  evidence: Record<string, DeliveryEvidenceRecord[]>;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db', 'transactions.json');

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const dbDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
}

function readDb(): TransactionsDatabase {
  ensureDirectories();
  if (!fs.existsSync(DB_FILE)) {
    return { transactions: {}, messages: {}, disputes: {}, evidence: {} };
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      transactions: parsed.transactions || {},
      messages: parsed.messages || {},
      disputes: parsed.disputes || {},
      evidence: parsed.evidence || {},
    };
  } catch (err) {
    console.error('Error reading transactions DB:', err);
    return { transactions: {}, messages: {}, disputes: {}, evidence: {} };
  }
}

function writeDb(data: TransactionsDatabase) {
  ensureDirectories();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Gets or initializes a transaction record for an auction.
 */
export function getOrCreateTransaction(
  auctionId: string,
  defaults?: Partial<TransactionRecord>
): TransactionRecord {
  const db = readDb();
  if (db.transactions[auctionId]) {
    return db.transactions[auctionId];
  }

  const now = Date.now();
  const newTx: TransactionRecord = {
    id: auctionId,
    auctionId,
    buyerAddress: defaults?.buyerAddress || '',
    sellerAddress: defaults?.sellerAddress || '',
    assetType: defaults?.assetType || 'dataset',
    paymentStatus: defaults?.paymentStatus || 'escrowed',
    deliveryStatus: defaults?.deliveryStatus || 'pending_delivery',
    disputeStatus: 'none',
    inspectionDeadline: defaults?.inspectionDeadline,
    createdAt: now,
    updatedAt: now,
  };

  db.transactions[auctionId] = newTx;
  writeDb(db);
  return newTx;
}

export function updateTransaction(
  auctionId: string,
  updates: Partial<TransactionRecord>
): TransactionRecord | null {
  const db = readDb();
  const existing = db.transactions[auctionId];
  if (!existing) return null;

  const updated: TransactionRecord = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };

  db.transactions[auctionId] = updated;
  writeDb(db);
  return updated;
}

/**
 * Appends a message to the transaction chat room.
 */
export function addTransactionMessage(message: TransactionMessage): TransactionMessage {
  const db = readDb();
  const txId = message.transactionId;
  if (!db.messages[txId]) {
    db.messages[txId] = [];
  }
  db.messages[txId].push(message);
  writeDb(db);
  return message;
}

export function getTransactionMessages(transactionId: string): TransactionMessage[] {
  const db = readDb();
  return db.messages[transactionId] || [];
}

/**
 * Submits a dispute, computes canonical evidenceHash, and syncs with refundDb for reviewer compatibility.
 */
export function submitDispute(
  auctionId: string,
  payload: {
    buyerAddress: string;
    sellerAddress?: string;
    issueCategory: string;
    expectedCondition: string;
    actualCondition: string;
    description: string;
    evidenceReferences?: string[];
    requestedResolution?: string;
    aiAssessment?: GeminiValidationOutput;
  }
): DisputeRecord {
  const db = readDb();
  const now = Date.now();
  const evidenceReferences = payload.evidenceReferences || [];

  const evidencePkg: CanonicalEvidencePackage = {
    auctionId,
    buyerAddress: payload.buyerAddress,
    sellerAddress: payload.sellerAddress,
    issueCategory: payload.issueCategory,
    expectedCondition: payload.expectedCondition,
    actualCondition: payload.actualCondition,
    description: payload.description,
    evidenceReferences,
    requestedResolution: payload.requestedResolution || 'Full Refund',
    timestamp: now,
  };

  const evidenceHash = computeCanonicalEvidenceHash(evidencePkg);

  const dispute: DisputeRecord = {
    id: `dispute-${auctionId}-${now}`,
    transactionId: auctionId,
    auctionId,
    openedBy: payload.buyerAddress.toLowerCase(),
    issueCategory: payload.issueCategory,
    expectedCondition: payload.expectedCondition,
    actualCondition: payload.actualCondition,
    description: payload.description,
    evidenceReferences,
    requestedResolution: payload.requestedResolution || 'Full Refund',
    status: 'submitted',
    aiAssessment: payload.aiAssessment,
    evidenceHash,
    createdAt: now,
  };

  db.disputes[auctionId] = dispute;

  // Update transaction status
  if (db.transactions[auctionId]) {
    db.transactions[auctionId].disputeStatus = 'submitted';
    db.transactions[auctionId].deliveryStatus = 'delivery_disputed';
    db.transactions[auctionId].updatedAt = now;
  }

  writeDb(db);

  // Sync to refundDb for backwards-compatibility with Reviewer dashboard
  saveRefundEvidence({
    auctionId,
    buyer: payload.buyerAddress,
    disputedCriterion: payload.issueCategory,
    expectedValue: payload.expectedCondition,
    actualValue: payload.actualCondition,
    reason: payload.description,
    evidenceHash,
    timestamp: now,
  });

  return dispute;
}

export function getDispute(auctionId: string): DisputeRecord | null {
  const db = readDb();
  return db.disputes[auctionId] || null;
}

export function respondToDispute(
  auctionId: string,
  response: {
    statement: string;
    evidenceReferences?: string[];
  }
): DisputeRecord | null {
  const db = readDb();
  const dispute = db.disputes[auctionId];
  if (!dispute) return null;

  dispute.sellerResponse = {
    respondedAt: Date.now(),
    statement: response.statement,
    evidenceReferences: response.evidenceReferences || [],
  };
  dispute.status = 'under_review';

  if (db.transactions[auctionId]) {
    db.transactions[auctionId].disputeStatus = 'under_review';
    db.transactions[auctionId].updatedAt = Date.now();
  }

  writeDb(db);
  return dispute;
}
