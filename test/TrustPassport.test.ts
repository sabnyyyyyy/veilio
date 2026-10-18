import { expect } from 'chai';
import { hashTrustPassportSnapshot, makeTrustPassportSnapshot } from '../lib/server/trustPassport';
import type { ServiceOrder } from '../lib/server/servicesDb';

describe('AI Vendor Trust Passport proof snapshots', () => {
  const order: ServiceOrder = {
    id: 'ord-passport-test', serviceId: 'srv-passport-test', paymentRequestId: 'pr-passport-test',
    buyerId: '0x1111111111111111111111111111111111111111', sellerId: '0x2222222222222222222222222222222222222222',
    conversationId: 'conv-test', serviceTitle: 'Dataset quality audit', scopeSnapshot: 'Review and report',
    priceSnapshot: '0.5', currency: 'ETH', deadline: 1, status: 'Completed', paymentStatus: 'Released',
    escrowTxHash: `0x${'a'.repeat(64)}`, network: 'base:84532', createdAt: 1, updatedAt: 2,
  };

  it('creates a deterministic approval hash that excludes only the recording timestamp', () => {
    const evidenceHash = `0x${'c'.repeat(64)}`;
    const one = makeTrustPassportSnapshot(order, null, evidenceHash, 100);
    const two = makeTrustPassportSnapshot(order, null, evidenceHash, 200);
    expect(one.network).to.equal('base:84532');
    expect(one.settlementReference).to.equal(order.escrowTxHash);
    expect(hashTrustPassportSnapshot(one)).to.equal(hashTrustPassportSnapshot(two));
  });

  it('binds the proof to the chain settlement and dispute outcome', () => {
    const snapshot = makeTrustPassportSnapshot(order, null, `0x${'c'.repeat(64)}`, 100);
    const changedSettlement = { ...snapshot, settlementReference: `0x${'b'.repeat(64)}` };
    const disclosedDispute = { ...snapshot, dispute: 'resolved' as const, disputeOutcome: 'approved_as_recommended' };
    expect(hashTrustPassportSnapshot(changedSettlement)).not.to.equal(hashTrustPassportSnapshot(snapshot));
    expect(hashTrustPassportSnapshot(disclosedDispute)).not.to.equal(hashTrustPassportSnapshot(snapshot));
  });
});
