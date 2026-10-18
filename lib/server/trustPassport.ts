import { createHash } from 'node:crypto';
import { getOrderNetwork, type OrderSubmission, type ServiceDispute, type ServiceOrder, type TrustPassportRecord } from './servicesDb';

export function hashOrderEvidence(submissions: OrderSubmission[]): string {
  const canonical = submissions.map((submission) => ({
    id: submission.id,
    submittedBy: submission.submittedBy,
    description: submission.description,
    deliverableReferences: submission.deliverableReferences,
    submittedAt: submission.submittedAt,
  }));
  return `0x${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export function makeTrustPassportSnapshot(order: ServiceOrder, dispute: ServiceDispute | null, evidenceHash: string, recordedAt = Date.now()): TrustPassportRecord['snapshot'] {
  return {
    schema: 'veilio-trust-passport-v1',
    orderId: order.id,
    serviceId: order.serviceId,
    serviceTitle: order.serviceTitle,
    buyer: order.buyerId,
    seller: order.sellerId,
    network: getOrderNetwork(order),
    completion: 'completed',
    payment: 'released',
    settlementReference: order.escrowTxHash || '',
    evidenceHash,
    dispute: dispute?.status === 'resolved' ? 'resolved' : dispute?.status === 'cancelled' ? 'cancelled' : 'none',
    ...(dispute?.reviewDecision ? { disputeOutcome: dispute.reviewDecision.decision } : {}),
    recordedAt,
  };
}

export function hashTrustPassportSnapshot(snapshot: TrustPassportRecord['snapshot']): string {
  const canonical = {
    schema: snapshot.schema,
    orderId: snapshot.orderId,
    serviceId: snapshot.serviceId,
    serviceTitle: snapshot.serviceTitle,
    buyer: snapshot.buyer,
    seller: snapshot.seller,
    network: snapshot.network,
    completion: snapshot.completion,
    payment: snapshot.payment,
    settlementReference: snapshot.settlementReference,
    evidenceHash: snapshot.evidenceHash,
    dispute: snapshot.dispute,
    disputeOutcome: snapshot.disputeOutcome || null,
  };
  return `0x${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

/** Small deterministic public payload: no uploaded files, descriptions, or signatures go on-chain. */
export function makeTrustPassportAnchorPayload(record: TrustPassportRecord): string {
  if (!record.buyerApproval || !record.sellerApproval) throw new Error('Both parties must approve before anchoring.');
  return JSON.stringify({
    schema: 'veilio-trust-passport-anchor-v1',
    network: record.snapshot.network,
    orderId: record.orderId,
    proofHash: record.proofHash,
    evidenceHash: record.snapshot.evidenceHash,
    settlementReference: record.snapshot.settlementReference,
    buyer: { address: record.buyerApproval.address, signature: record.buyerApproval.signature, signedAt: record.buyerApproval.signedAt, nonce: record.buyerApproval.nonce },
    seller: { address: record.sellerApproval.address, signature: record.sellerApproval.signature, signedAt: record.sellerApproval.signedAt, nonce: record.sellerApproval.nonce },
  });
}
