import { expect } from 'chai';
import {
  getAllServices,
  getServiceById,
  createService,
  updateService,
  getOrCreateConversation,
  getUserConversations,
  getConversationMessages,
  addServiceMessage,
  createPaymentRequest,
  getPaymentRequest,
  createOrderFromPaymentRequest,
  getOrderById,
  getUserOrders,
  addOrderSubmission,
  addOrderRevision,
  updateOrderStatus,
} from '../lib/server/servicesDb';

describe('VEILIO Services Marketplace & Escrow Workflow', () => {
  const sellerAddress = '0x1234567890123456789012345678901234567890';
  const buyerAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const strangerAddress = '0x9999999999999999999999999999999999999999';

  let createdServiceId: string;
  let conversationId: string;
  let paymentRequestId: string;
  let orderId: string;

  describe('1. Service Listing & Discovery', () => {
    it('creates a new service listing with verified seller', () => {
      const service = createService({
        sellerId: sellerAddress,
        sellerType: 'human',
        sellerName: 'Senior Solidity Security Auditor',
        title: 'Full Smart Contract Audit with Invariant Testing',
        description: 'Comprehensive static analysis, Echidna fuzzing, and manual line-by-line vulnerability assessment.',
        category: 'Smart Contract Audit',
        price: '0.75',
        currency: 'BNB',
        deliveryTime: '3 Days',
        sampleDeliverables: ['Audit PDF Manifest', 'Echidna Test Harness'],
        status: 'active',
      });

      expect(service.id).to.be.a('string');
      expect(service.price).to.equal('0.75');
      expect(service.sellerType).to.equal('human');
      createdServiceId = service.id;
    });

    it('filters services by category, query, and sellerType', () => {
      const audits = getAllServices({ category: 'Smart Contract Audit' });
      expect(audits.length).to.be.at.least(1);
      expect(audits.some((s) => s.id === createdServiceId)).to.be.true;

      const searchResult = getAllServices({ query: 'Echidna' });
      expect(searchResult.length).to.be.at.least(1);

      const agentOnly = getAllServices({ sellerType: 'agent' });
      expect(agentOnly.every((s) => s.sellerType === 'agent')).to.be.true;
    });

    it('allows only the authorized seller to modify the listing', () => {
      const updated = updateService(createdServiceId, sellerAddress, {
        price: '0.85',
      });
      expect(updated?.price).to.equal('0.85');

      expect(() => {
        updateService(createdServiceId, strangerAddress, { price: '0.10' });
      }).to.throw('Unauthorized: only the service seller can edit this listing');
    });
  });

  describe('2. Messaging & Negotiations', () => {
    it('creates a conversation between buyer and seller', () => {
      const conv = getOrCreateConversation(
        buyerAddress,
        sellerAddress,
        createdServiceId,
        'Full Smart Contract Audit'
      );
      expect(conv.id).to.be.a('string');
      expect(conv.buyerId).to.equal(buyerAddress.toLowerCase());
      expect(conv.sellerId).to.equal(sellerAddress.toLowerCase());
      conversationId = conv.id;
    });

    it('sends and retrieves messages in the conversation', () => {
      const msg1 = addServiceMessage({
        conversationId,
        senderId: buyerAddress,
        senderType: 'human',
        content: 'Hello, can you audit a 400-line DeFi vault contract within 2 days?',
      });

      const msg2 = addServiceMessage({
        conversationId,
        senderId: sellerAddress,
        senderType: 'human',
        content: 'Yes, I can prioritize it for 0.85 BNB with delivery in 48 hours.',
      });

      const msgs = getConversationMessages(conversationId);
      expect(msgs.length).to.be.at.least(2);
      expect(msgs.some((m) => m.content.includes('400-line DeFi vault'))).to.be.true;
    });

    it('lists user conversations for participants', () => {
      const buyerConvs = getUserConversations(buyerAddress);
      expect(buyerConvs.some((c) => c.id === conversationId)).to.be.true;
    });
  });

  describe('3. Payment Request & Order Creation', () => {
    it('seller creates a payment request with agreed terms', () => {
      const pr = createPaymentRequest({
        conversationId,
        serviceId: createdServiceId,
        buyerId: buyerAddress,
        sellerId: sellerAddress,
        description: 'DeFi Vault Security Audit - 400 SLOC',
        scope: 'Static analysis, manual review, and remediation diff',
        agreedPrice: '0.85',
        currency: 'BNB',
        deadline: Date.now() + 2 * 24 * 3600 * 1000,
        revisionTerms: '1 round of re-audit for patched contracts',
        escrowContract: '0x4A6B8B5F6c9B420b9B5019A82D19D5d1b7D6eB8A',
        network: 'BNB Smart Chain',
        expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
      });

      expect(pr.id).to.be.a('string');
      expect(pr.status).to.equal('pending');
      expect(pr.agreedPrice).to.equal('0.85');
      paymentRequestId = pr.id;
    });

    it('prevents unauthorized buyer from accepting payment request', () => {
      expect(() => {
        createOrderFromPaymentRequest(paymentRequestId, strangerAddress);
      }).to.throw('Unauthorized: only designated buyer can accept this payment request');
    });

    it('creates an order in AwaitingPayment when designated buyer accepts', () => {
      const order = createOrderFromPaymentRequest(paymentRequestId, buyerAddress);
      expect(order.id).to.be.a('string');
      expect(order.status).to.equal('AwaitingPayment');
      expect(order.paymentStatus).to.equal('NotPaid');
      expect(order.priceSnapshot).to.equal('0.85');
      orderId = order.id;

      const pr = getPaymentRequest(paymentRequestId);
      expect(pr?.status).to.equal('accepted');
    });
  });

  describe('4. Order Lifecycle, Submissions, Revisions, and Approval', () => {
    it('transitions order to InProgress when escrow deposit is confirmed', () => {
      const updated = updateOrderStatus(
        orderId,
        'InProgress',
        'Funded',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      );
      expect(updated?.status).to.equal('InProgress');
      expect(updated?.paymentStatus).to.equal('Funded');
    });

    it('seller submits work deliverables and order status becomes InReview', () => {
      // Rejects non-seller
      expect(() => {
        addOrderSubmission(orderId, strangerAddress, 'Audit done', []);
      }).to.throw('Unauthorized: only seller can submit deliverables');

      const sub = addOrderSubmission(
        orderId,
        sellerAddress,
        'Completed full invariant audit. Found 1 high and 2 medium issues.',
        ['https://github.com/client/repo/pull/12', 'ipfs://QmSampleAuditReport']
      );

      expect(sub.id).to.be.a('string');
      const order = getOrderById(orderId);
      expect(order?.status).to.equal('InReview');
    });

    it('buyer requests revision and order status becomes RevisionRequested', () => {
      // Rejects non-buyer
      expect(() => {
        addOrderRevision(orderId, strangerAddress, 'Fix this');
      }).to.throw('Unauthorized: only buyer can request revision');

      const rev = addOrderRevision(
        orderId,
        buyerAddress,
        'Please re-verify the reentrancy guard on depositETH function.'
      );

      expect(rev.id).to.be.a('string');
      const order = getOrderById(orderId);
      expect(order?.status).to.equal('RevisionRequested');
    });

    it('seller submits revised deliverables and buyer approves completion', () => {
      // Seller submits revision
      addOrderSubmission(
        orderId,
        sellerAddress,
        'Re-verified depositETH. Reentrancy issue confirmed mitigated.',
        ['https://github.com/client/repo/pull/12#v2']
      );

      let order = getOrderById(orderId);
      expect(order?.status).to.equal('InReview');

      // Buyer approves
      order = updateOrderStatus(
        orderId,
        'Completed',
        'Released',
        order?.escrowReference,
        '0xreleaseTxHash123'
      );

      expect(order?.status).to.equal('Completed');
      expect(order?.paymentStatus).to.equal('Released');
    });

    it('seller cancels funded order before completion and refunds buyer', () => {
      const pr2 = createPaymentRequest({
        conversationId,
        serviceId: createdServiceId,
        buyerId: buyerAddress,
        sellerId: sellerAddress,
        description: 'Second order to test cancellation',
        scope: 'Cancel scope',
        agreedPrice: '0.5',
        currency: 'BNB',
        deadline: Date.now() + 86400000,
        revisionTerms: 'Standard',
        escrowContract: '0x794f1610B5588a55B19D8c82e4381448a388C965',
        network: 'BNB Chain Testnet',
      });
      const order2 = createOrderFromPaymentRequest(pr2.id, buyerAddress);
      updateOrderStatus(order2.id, 'Funded', 'Funded', '0xescrow2', '0xtx2');

      const cancelled = updateOrderStatus(order2.id, 'Cancelled', 'Refunded', '0xescrow2', '0xcancelTx');
      expect(cancelled?.status).to.equal('Cancelled');
      expect(cancelled?.paymentStatus).to.equal('Refunded');
    });

    it('buyer triggers timeout refund after deadline passes', () => {
      const pr3 = createPaymentRequest({
        conversationId,
        serviceId: createdServiceId,
        buyerId: buyerAddress,
        sellerId: sellerAddress,
        description: 'Third order for timeout refund',
        scope: 'Timeout scope',
        agreedPrice: '0.3',
        currency: 'BNB',
        deadline: Date.now() - 3600000,
        revisionTerms: 'Standard',
        escrowContract: '0x794f1610B5588a55B19D8c82e4381448a388C965',
        network: 'BNB Chain Testnet',
      });
      const order3 = createOrderFromPaymentRequest(pr3.id, buyerAddress);
      updateOrderStatus(order3.id, 'Funded', 'Funded', '0xescrow3', '0xtx3');

      const refunded = updateOrderStatus(order3.id, 'Refunded', 'Refunded', '0xescrow3', '0xrefundTx');
      expect(refunded?.status).to.equal('Refunded');
      expect(refunded?.paymentStatus).to.equal('Refunded');
    });
  });
});
