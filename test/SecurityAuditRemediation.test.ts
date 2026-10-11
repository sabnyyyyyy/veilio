import { expect } from 'chai';
import { ethers } from 'hardhat';
import { verifyServiceAuth } from '../lib/server/serviceAuth';
import { createServiceAuthMessage, generateAuthNonce } from '../lib/serviceAuth';
import {
  createService,
  getOrCreateConversation,
  createPaymentRequest,
  createOrderFromPaymentRequest,
  getOrderById,
  updateOrderStatus,
} from '../lib/server/servicesDb';

describe('Security Audit Remediation Regression Suite (AUDIT-001 through AUDIT-004, SEC-NEW-01 through 03)', () => {
  let deployer: any;
  let buyer: any;
  let seller: any;
  let stranger: any;
  let reviewer: any;

  before(async () => {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    buyer = signers[1];
    seller = signers[2];
    stranger = signers[3];
    reviewer = signers[4];

    const testService = createService({
      sellerId: seller.address.toLowerCase(),
      sellerType: 'human',
      sellerName: 'Audit Seller',
      title: 'Audit Remediation Test Service',
      description: 'Test service description',
      category: 'Smart Contract Audit',
      price: '0.5',
      currency: 'BNB',
      deliveryTime: '2 Days',
      sampleDeliverables: [],
      status: 'active',
    });

    testConv = getOrCreateConversation(
      buyer.address.toLowerCase(),
      seller.address.toLowerCase(),
      testService.id,
      testService.title
    );
  });
  let testConv: any;

  describe('AUDIT-001: Cryptographic Wallet Authentication & Anti-Replay', () => {
    const orderId = 'ord-audit-test-01';

    it('successfully authenticates a valid wallet signature for the authorized buyer', async () => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'approve',
        orderId,
        address: buyer.address,
        timestamp,
        nonce,
      });

      const signature = await buyer.signMessage(message);

      const result = await verifyServiceAuth({
        action: 'approve',
        orderId,
        expectedAddress: buyer.address,
        auth: {
          address: buyer.address,
          signature,
          timestamp,
          nonce,
        },
      });

      expect(result.valid).to.be.true;
    });

    it('rejects a request when the auth payload is completely missing', async () => {
      const result = await verifyServiceAuth({
        action: 'approve',
        orderId,
        expectedAddress: buyer.address,
        auth: undefined,
      });

      expect(result.valid).to.be.false;
      expect(result.status).to.equal(401);
      expect(result.error).to.contain('Missing required cryptographic authentication payload');
    });

    it('rejects forged identity: stranger signs but claims to be the buyer', async () => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'approve',
        orderId,
        address: stranger.address,
        timestamp,
        nonce,
      });

      const signature = await stranger.signMessage(message);

      // Stranger attempts to pass stranger.address as caller for buyer's order
      const result = await verifyServiceAuth({
        action: 'approve',
        orderId,
        expectedAddress: buyer.address,
        auth: {
          address: stranger.address,
          signature,
          timestamp,
          nonce,
        },
      });

      expect(result.valid).to.be.false;
      expect(result.status).to.equal(403);
      expect(result.error).to.contain('does not match required participant');
    });

    it('rejects forged identity: stranger signs with their key but supplies buyer.address in payload', async () => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'approve',
        orderId,
        address: buyer.address,
        timestamp,
        nonce,
      });

      // Stranger signs message reconstructed for buyer
      const signature = await stranger.signMessage(message);

      const result = await verifyServiceAuth({
        action: 'approve',
        orderId,
        expectedAddress: buyer.address,
        auth: {
          address: buyer.address,
          signature,
          timestamp,
          nonce,
        },
      });

      expect(result.valid).to.be.false;
      expect(result.status).to.equal(401);
      expect(result.error).to.contain('Invalid wallet signature');
    });

    it('rejects replay attack: reusing an already-consumed nonce', async () => {
      const timestamp = Date.now();
      const nonce = 'replay-nonce-' + Date.now();
      const message = createServiceAuthMessage({
        action: 'submit',
        orderId,
        address: seller.address,
        timestamp,
        nonce,
      });

      const signature = await seller.signMessage(message);

      // First use succeeds
      const firstResult = await verifyServiceAuth({
        action: 'submit',
        orderId,
        expectedAddress: seller.address,
        auth: {
          address: seller.address,
          signature,
          timestamp,
          nonce,
        },
      });
      expect(firstResult.valid).to.be.true;

      // Second use with identical nonce must be rejected
      const secondResult = await verifyServiceAuth({
        action: 'submit',
        orderId,
        expectedAddress: seller.address,
        auth: {
          address: seller.address,
          signature,
          timestamp,
          nonce,
        },
      });

      expect(secondResult.valid).to.be.false;
      expect(secondResult.status).to.equal(401);
      expect(secondResult.error).to.contain('Replay detected');
    });

    it('rejects expired timestamp (> 5 minutes clock skew)', async () => {
      const expiredTimestamp = Date.now() - (6 * 60 * 1000); // 6 minutes ago
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'cancel',
        orderId,
        address: seller.address,
        timestamp: expiredTimestamp,
        nonce,
      });

      const signature = await seller.signMessage(message);

      const result = await verifyServiceAuth({
        action: 'cancel',
        orderId,
        expectedAddress: seller.address,
        auth: {
          address: seller.address,
          signature,
          timestamp: expiredTimestamp,
          nonce,
        },
      });

      expect(result.valid).to.be.false;
      expect(result.status).to.equal(401);
      expect(result.error).to.contain('expired');
    });

    it('rejects signature for a different action or order', async () => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      // Signed for action 'dispute'
      const message = createServiceAuthMessage({
        action: 'dispute',
        orderId,
        address: buyer.address,
        timestamp,
        nonce,
      });

      const signature = await buyer.signMessage(message);

      // Attempt to present signature for action 'approve'
      const result = await verifyServiceAuth({
        action: 'approve',
        orderId,
        expectedAddress: buyer.address,
        auth: {
          address: buyer.address,
          signature,
          timestamp,
          nonce,
        },
      });

      expect(result.valid).to.be.false;
      expect(result.status).to.equal(401);
      expect(result.error).to.contain('Invalid wallet signature');
    });
  });

  describe('AUDIT-002 & AUDIT-003: On-Chain Receipt & Event Invariants', () => {
    let escrow: any;
    const testOrderId = ethers.id('audit-escrow-01');
    const depositAmount = ethers.parseEther('0.1');

    before(async () => {
      const factory = await ethers.getContractFactory('VeilServiceEscrow', deployer);
      escrow = await factory.deploy(reviewer.address, reviewer.address, 500);
      await escrow.waitForDeployment();
    });

    it('OrderFunded event contains exact orderId, buyer, seller, and amount on-chain', async () => {
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      const tx = await escrow.connect(buyer).deposit(testOrderId, seller.address, deadline, {
        value: depositAmount,
      });
      const receipt = await tx.wait();

      expect(receipt.status).to.equal(1);

      // Verify event was emitted on-chain
      const filter = escrow.filters.OrderFunded(testOrderId);
      const events = await escrow.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
      expect(events.length).to.equal(1);
      expect(events[0].args.orderId).to.equal(testOrderId);
      expect(events[0].args.buyer).to.equal(buyer.address);
      expect(events[0].args.seller).to.equal(seller.address);
      expect(events[0].args.amount).to.equal(depositAmount);
    });

    it('OrderReleased event accurately reflects release and 5% fee split', async () => {
      // Seller delivers
      await escrow.connect(seller).submitDelivery(testOrderId, 'ipfs://QmDeliverableTest');

      // Buyer approves
      const releaseTx = await escrow.connect(buyer).releaseFunds(testOrderId);
      const receipt = await releaseTx.wait();

      expect(receipt.status).to.equal(1);

      const filter = escrow.filters.OrderReleased(testOrderId);
      const events = await escrow.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
      expect(events.length).to.equal(1);
      expect(events[0].args.orderId).to.equal(testOrderId);
      expect(events[0].args.buyer).to.equal(buyer.address);
      expect(events[0].args.seller).to.equal(seller.address);

      const expectedFee = (depositAmount * 500n) / 10000n;
      const expectedSellerPayout = depositAmount - expectedFee;
      expect(events[0].args.feeAmount).to.equal(expectedFee);
      expect(events[0].args.sellerAmount).to.equal(expectedSellerPayout);
    });

    it('OrderRefunded event accurately emitted when seller cancels', async () => {
      const cancelOrderId = ethers.id('audit-cancel-02');
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await escrow.connect(buyer).deposit(cancelOrderId, seller.address, deadline, {
        value: depositAmount,
      });

      const cancelTx = await escrow.connect(seller).cancelOrder(cancelOrderId, 'Seller cancellation');
      const receipt = await cancelTx.wait();

      expect(receipt.status).to.equal(1);

      const filter = escrow.filters.OrderRefunded(cancelOrderId);
      const events = await escrow.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
      expect(events.length).to.equal(1);
      expect(events[0].args.orderId).to.equal(cancelOrderId);
      expect(events[0].args.buyer).to.equal(buyer.address);
      expect(events[0].args.refundAmount).to.equal(depositAmount);
    });
  });

  describe('AUDIT-004: Reviewer Authorization Invariants', () => {
    let escrow: any;
    const disputeOrderId = ethers.id('audit-dispute-03');
    const depositAmount = ethers.parseEther('0.1');

    before(async () => {
      const factory = await ethers.getContractFactory('VeilServiceEscrow', deployer);
      escrow = await factory.deploy(reviewer.address, reviewer.address, 500);
      await escrow.waitForDeployment();

      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await escrow.connect(buyer).deposit(disputeOrderId, seller.address, deadline, {
        value: depositAmount,
      });
      await escrow.connect(buyer).dispute(disputeOrderId, 'Defective deliverable');
    });

    it('rejects dispute resolution attempt by stranger or unauthorized party', async () => {
      await expect(
        escrow.connect(stranger).resolveDispute(disputeOrderId, 50)
      ).to.be.revertedWith('Only reviewer or owner');
    });

    it('rejects dispute resolution attempt by buyer or seller', async () => {
      await expect(
        escrow.connect(buyer).resolveDispute(disputeOrderId, 100)
      ).to.be.revertedWith('Only reviewer or owner');

      await expect(
        escrow.connect(seller).resolveDispute(disputeOrderId, 0)
      ).to.be.revertedWith('Only reviewer or owner');
    });

    it('allows designated reviewer to resolve dispute with valid split', async () => {
      const tx = await escrow.connect(reviewer).resolveDispute(disputeOrderId, 50);
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);

      const filter = escrow.filters.DisputeResolved(disputeOrderId);
      const events = await escrow.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
      expect(events.length).to.equal(1);
      expect(events[0].args.orderId).to.equal(disputeOrderId);
    });
  });

  describe('SEC-NEW-03: Concurrent Nonce Consumption Reservation & Retry Cleanup', () => {
    it('concurrent requests attempting to consume the same nonce: exactly one succeeds and the other is rejected', async () => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'approve',
        orderId: 'ord-concurrent-01',
        address: buyer.address,
        timestamp,
        nonce,
      });
      const signature = await buyer.signMessage(message);

      // Launch both verification requests concurrently
      const [res1, res2] = await Promise.all([
        verifyServiceAuth({
          action: 'approve',
          orderId: 'ord-concurrent-01',
          expectedAddress: buyer.address,
          auth: { address: buyer.address, signature, timestamp, nonce },
        }),
        verifyServiceAuth({
          action: 'approve',
          orderId: 'ord-concurrent-01',
          expectedAddress: buyer.address,
          auth: { address: buyer.address, signature, timestamp, nonce },
        }),
      ]);

      // Exactly one succeeds and one fails with 401 Replay detected
      const validCount = (res1.valid ? 1 : 0) + (res2.valid ? 1 : 0);
      const replayCount = (!res1.valid && res1.status === 401 ? 1 : 0) + (!res2.valid && res2.status === 401 ? 1 : 0);
      expect(validCount).to.equal(1);
      expect(replayCount).to.equal(1);
    });

    it('releases reserved nonce if verification fails, allowing legitimate retry', async () => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();

      // First attempt with invalid signature
      const failRes = await verifyServiceAuth({
        action: 'approve',
        orderId: 'ord-retry-01',
        expectedAddress: buyer.address,
        auth: {
          address: buyer.address,
          signature: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b',
          timestamp,
          nonce,
        },
      });
      expect(failRes.valid).to.be.false;

      // Second attempt with valid signature and same nonce succeeds because reservation was released
      const validMsg = createServiceAuthMessage({
        action: 'approve',
        orderId: 'ord-retry-01',
        address: buyer.address,
        timestamp,
        nonce,
      });
      const validSig = await buyer.signMessage(validMsg);

      const successRes = await verifyServiceAuth({
        action: 'approve',
        orderId: 'ord-retry-01',
        expectedAddress: buyer.address,
        auth: {
          address: buyer.address,
          signature: validSig,
          timestamp,
          nonce,
        },
      });
      expect(successRes.valid).to.be.true;
    });
  });

  describe('SEC-NEW-02: Cryptographic Payment-Request Acceptance Authentication', () => {
    it('successfully authenticates valid buyer signature for accept-payment-request', async () => {
      const prId = 'pr-test-accept-01';
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'accept-payment-request',
        orderId: prId,
        address: buyer.address,
        timestamp,
        nonce,
      });
      const signature = await buyer.signMessage(message);

      const result = await verifyServiceAuth({
        action: 'accept-payment-request',
        orderId: prId,
        expectedAddress: buyer.address,
        auth: { address: buyer.address, signature, timestamp, nonce },
      });
      expect(result.valid).to.be.true;
    });

    it('rejects payment-request acceptance when auth payload is missing (401)', async () => {
      const result = await verifyServiceAuth({
        action: 'accept-payment-request',
        orderId: 'pr-test-02',
        expectedAddress: buyer.address,
        auth: undefined,
      });
      expect(result.valid).to.be.false;
      expect(result.status).to.equal(401);
    });

    it('rejects payment-request acceptance if caller is stranger instead of designated buyer (403)', async () => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'accept-payment-request',
        orderId: 'pr-test-03',
        address: stranger.address,
        timestamp,
        nonce,
      });
      const signature = await stranger.signMessage(message);

      const result = await verifyServiceAuth({
        action: 'accept-payment-request',
        orderId: 'pr-test-03',
        expectedAddress: buyer.address,
        auth: { address: stranger.address, signature, timestamp, nonce },
      });
      expect(result.valid).to.be.false;
      expect(result.status).to.equal(403);
    });

    it('rejects payment-request acceptance if signature was created for wrong action (401)', async () => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'approve', // wrong action
        orderId: 'pr-test-04',
        address: buyer.address,
        timestamp,
        nonce,
      });
      const signature = await buyer.signMessage(message);

      const result = await verifyServiceAuth({
        action: 'accept-payment-request',
        orderId: 'pr-test-04',
        expectedAddress: buyer.address,
        auth: { address: buyer.address, signature, timestamp, nonce },
      });
      expect(result.valid).to.be.false;
      expect(result.status).to.equal(401);
    });

    it('rejects payment-request acceptance if timestamp is expired (401)', async () => {
      const expiredTimestamp = Date.now() - (6 * 60 * 1000);
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({
        action: 'accept-payment-request',
        orderId: 'pr-test-05',
        address: buyer.address,
        timestamp: expiredTimestamp,
        nonce,
      });
      const signature = await buyer.signMessage(message);

      const result = await verifyServiceAuth({
        action: 'accept-payment-request',
        orderId: 'pr-test-05',
        expectedAddress: buyer.address,
        auth: { address: buyer.address, signature, timestamp: expiredTimestamp, nonce },
      });
      expect(result.valid).to.be.false;
      expect(result.status).to.equal(401);
    });

    it('rejects replayed nonce on payment-request acceptance (401)', async () => {
      const timestamp = Date.now();
      const nonce = 'pr-replay-nonce-' + Date.now();
      const message = createServiceAuthMessage({
        action: 'accept-payment-request',
        orderId: 'pr-test-06',
        address: buyer.address,
        timestamp,
        nonce,
      });
      const signature = await buyer.signMessage(message);

      const first = await verifyServiceAuth({
        action: 'accept-payment-request',
        orderId: 'pr-test-06',
        expectedAddress: buyer.address,
        auth: { address: buyer.address, signature, timestamp, nonce },
      });
      expect(first.valid).to.be.true;

      const second = await verifyServiceAuth({
        action: 'accept-payment-request',
        orderId: 'pr-test-06',
        expectedAddress: buyer.address,
        auth: { address: buyer.address, signature, timestamp, nonce },
      });
      expect(second.valid).to.be.false;
      expect(second.status).to.equal(401);
    });

    it('createOrderFromPaymentRequest prevents duplicate order creation on repeated acceptance', () => {
      const pr = createPaymentRequest({
        conversationId: testConv.id,
        serviceId: testConv.serviceId,
        buyerId: buyer.address.toLowerCase(),
        sellerId: seller.address.toLowerCase(),
        description: 'Design and Architecture Spec',
        scope: 'Full Spec Doc',
        agreedPrice: '0.5',
        currency: 'BNB',
        deadline: Date.now() + 86400000,
      });

      // First acceptance creates the order
      const order1 = createOrderFromPaymentRequest(pr.id, buyer.address.toLowerCase());
      expect(order1.status).to.equal('AwaitingPayment');
      expect(order1.paymentRequestId).to.equal(pr.id);

      // Repeated acceptance returns the existing order instead of creating a duplicate
      const order2 = createOrderFromPaymentRequest(pr.id, buyer.address.toLowerCase());
      expect(order2.id).to.equal(order1.id);
    });

    it('concurrent payment request acceptance returns the same order without duplicates', async () => {
      const pr = createPaymentRequest({
        conversationId: testConv.id,
        serviceId: testConv.serviceId,
        buyerId: buyer.address.toLowerCase(),
        sellerId: seller.address.toLowerCase(),
        description: 'Concurrent acceptance test',
        scope: 'Test',
        agreedPrice: '0.5',
        currency: 'BNB',
        deadline: Date.now() + 86400000,
      });

      const [orderA, orderB] = await Promise.all([
        Promise.resolve().then(() => createOrderFromPaymentRequest(pr.id, buyer.address.toLowerCase())),
        Promise.resolve().then(() => createOrderFromPaymentRequest(pr.id, buyer.address.toLowerCase())),
      ]);

      expect(orderA.id).to.equal(orderB.id);
      expect(orderA.status).to.equal('AwaitingPayment');
    });
  });

  describe('SEC-NEW-01: Deposit Verification State Precondition Guards', () => {
    it('verifies that an order already Completed cannot be in AwaitingPayment state', () => {
      const pr = createPaymentRequest({
        conversationId: testConv.id,
        serviceId: testConv.serviceId,
        buyerId: buyer.address.toLowerCase(),
        sellerId: seller.address.toLowerCase(),
        description: 'Completed order test',
        scope: 'Test',
        agreedPrice: '0.2',
        currency: 'BNB',
        deadline: Date.now() + 86400000,
      });
      const order = createOrderFromPaymentRequest(pr.id, buyer.address.toLowerCase());
      updateOrderStatus(order.id, 'Completed', 'Released');

      const fetched = getOrderById(order.id);
      expect(fetched?.status).to.equal('Completed');
      expect(fetched?.status === 'AwaitingPayment').to.be.false;
    });

    it('verifies that an order already Cancelled cannot be in AwaitingPayment state', () => {
      const pr = createPaymentRequest({
        conversationId: testConv.id,
        serviceId: testConv.serviceId,
        buyerId: buyer.address.toLowerCase(),
        sellerId: seller.address.toLowerCase(),
        description: 'Cancelled order test',
        scope: 'Test',
        agreedPrice: '0.2',
        currency: 'BNB',
        deadline: Date.now() + 86400000,
      });
      const order = createOrderFromPaymentRequest(pr.id, buyer.address.toLowerCase());
      updateOrderStatus(order.id, 'Cancelled', 'Refunded');

      const fetched = getOrderById(order.id);
      expect(fetched?.status).to.equal('Cancelled');
      expect(fetched?.status === 'AwaitingPayment').to.be.false;
    });

    it('verifies that an order already InProgress cannot be in AwaitingPayment state (prevents status reset)', () => {
      const pr = createPaymentRequest({
        conversationId: testConv.id,
        serviceId: testConv.serviceId,
        buyerId: buyer.address.toLowerCase(),
        sellerId: seller.address.toLowerCase(),
        description: 'InProgress order test',
        scope: 'Test',
        agreedPrice: '0.2',
        currency: 'BNB',
        deadline: Date.now() + 86400000,
      });
      const order = createOrderFromPaymentRequest(pr.id, buyer.address.toLowerCase());
      updateOrderStatus(order.id, 'InProgress', 'Funded');

      const fetched = getOrderById(order.id);
      expect(fetched?.status).to.equal('InProgress');
      expect(fetched?.status === 'AwaitingPayment').to.be.false;
    });
  });
});
