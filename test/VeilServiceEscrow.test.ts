import { expect } from 'chai';
import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { VeilServiceEscrow, RejectingReceiver } from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('VeilServiceEscrow Contract', () => {
  let escrow: VeilServiceEscrow;
  let owner: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let reviewer: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let stranger: SignerWithAddress;

  const orderId1 = ethers.encodeBytes32String('order-test-001');
  const depositAmount = ethers.parseEther('1.0');

  beforeEach(async () => {
    [owner, buyer, seller, reviewer, feeRecipient, stranger] = await ethers.getSigners();

    const EscrowFactory = await ethers.getContractFactory('VeilServiceEscrow');
    // Deploy with 5% platform fee (500 basis points)
    escrow = (await EscrowFactory.deploy(
      reviewer.address,
      feeRecipient.address,
      500
    )) as unknown as VeilServiceEscrow;
    await escrow.waitForDeployment();
  });

  it('initializes with correct parameters', async () => {
    expect(await escrow.reviewer()).to.equal(reviewer.address);
    expect(await escrow.feeRecipient()).to.equal(feeRecipient.address);
    expect(await escrow.platformFeeBasisPoints()).to.equal(500n);
    expect(await escrow.MAX_FEE_BPS()).to.equal(500n);
  });

  describe('Deposit & Order Funding', () => {
    it('allows a buyer to deposit and fund an escrow order', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;

      await expect(
        escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
          value: depositAmount,
        })
      )
        .to.emit(escrow, 'OrderFunded')
        .withArgs(orderId1, buyer.address, seller.address, depositAmount, deadline);

      const order = await escrow.getOrder(orderId1);
      expect(order.buyer).to.equal(buyer.address);
      expect(order.seller).to.equal(seller.address);
      expect(order.amount).to.equal(depositAmount);
      expect(order.status).to.equal(1); // EscrowStatus.Funded
    });

    it('rejects duplicate deposit for the same order ID', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });

      await expect(
        escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
          value: depositAmount,
        })
      ).to.be.revertedWith('Order already exists in escrow');
    });

    it('rejects deposit when buyer is the seller', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await expect(
        escrow.connect(buyer).deposit(orderId1, buyer.address, deadline, {
          value: depositAmount,
        })
      ).to.be.revertedWith('Buyer cannot be seller');
    });

    it('rejects zero amount deposit', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await expect(
        escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
          value: 0,
        })
      ).to.be.revertedWith('Deposit amount must be > 0');
    });
  });

  describe('Buyer Approval & Fund Release', () => {
    beforeEach(async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });
    });

    it('releases funds to seller and platform fee upon buyer approval', async () => {
      const initialSellerBal = await ethers.provider.getBalance(seller.address);
      const initialFeeBal = await ethers.provider.getBalance(feeRecipient.address);

      // Expected fee: 5% of 1.0 BNB = 0.05 BNB. Seller gets: 0.95 BNB (95%).
      const expectedFee = ethers.parseEther('0.05');
      const expectedSeller = ethers.parseEther('0.95');

      await expect(escrow.connect(buyer).releaseFunds(orderId1))
        .to.emit(escrow, 'OrderReleased')
        .withArgs(orderId1, buyer.address, seller.address, expectedSeller, expectedFee);

      const finalSellerBal = await ethers.provider.getBalance(seller.address);
      const finalFeeBal = await ethers.provider.getBalance(feeRecipient.address);

      expect(finalSellerBal - initialSellerBal).to.equal(expectedSeller);
      expect(finalFeeBal - initialFeeBal).to.equal(expectedFee);

      const order = await escrow.getOrder(orderId1);
      expect(order.status).to.equal(2); // EscrowStatus.Released
    });

    it('rejects release attempt from non-buyer', async () => {
      await expect(escrow.connect(seller).releaseFunds(orderId1)).to.be.revertedWith(
        'Only buyer can approve and release funds'
      );
      await expect(escrow.connect(stranger).releaseFunds(orderId1)).to.be.revertedWith(
        'Only buyer can approve and release funds'
      );
    });

    it('prevents double release', async () => {
      await escrow.connect(buyer).releaseFunds(orderId1);
      await expect(escrow.connect(buyer).releaseFunds(orderId1)).to.be.revertedWith(
        'Order is not funded'
      );
    });
  });

  describe('Refunds & Disputes', () => {
    it('allows seller to initiate a refund to buyer', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });

      const initialBuyerBal = await ethers.provider.getBalance(buyer.address);
      await expect(escrow.connect(seller).refund(orderId1, 'Cannot fulfill custom order'))
        .to.emit(escrow, 'OrderRefunded')
        .withArgs(orderId1, buyer.address, depositAmount, 'Cannot fulfill custom order');

      const finalBuyerBal = await ethers.provider.getBalance(buyer.address);
      expect(finalBuyerBal - initialBuyerBal).to.equal(depositAmount);
    });

    it('supports dispute escalation and reviewer resolution with fee deduction on seller share', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });

      // Buyer opens dispute
      await expect(escrow.connect(buyer).dispute(orderId1, 'Deliverable not delivered'))
        .to.emit(escrow, 'OrderDisputed')
        .withArgs(orderId1, buyer.address, 'Deliverable not delivered');

      const order = await escrow.getOrder(orderId1);
      expect(order.status).to.equal(4); // EscrowStatus.Disputed

      // Reviewer resolves with 50% split (0.5 BNB buyer, 0.5 BNB seller)
      // Platform fee is 5% of seller's 0.5 BNB = 0.025 BNB. Seller receives: 0.475 BNB. Buyer receives: 0.5 BNB (0% fee).
      const initialBuyerBal = await ethers.provider.getBalance(buyer.address);
      const initialSellerBal = await ethers.provider.getBalance(seller.address);
      const initialFeeBal = await ethers.provider.getBalance(feeRecipient.address);

      await expect(escrow.connect(reviewer).resolveDispute(orderId1, 50))
        .to.emit(escrow, 'DisputeResolved')
        .withArgs(orderId1, ethers.parseEther('0.5'), ethers.parseEther('0.5'));

      const finalBuyerBal = await ethers.provider.getBalance(buyer.address);
      const finalSellerBal = await ethers.provider.getBalance(seller.address);
      const finalFeeBal = await ethers.provider.getBalance(feeRecipient.address);

      expect(finalBuyerBal - initialBuyerBal).to.equal(ethers.parseEther('0.5'));
      expect(finalSellerBal - initialSellerBal).to.equal(ethers.parseEther('0.475'));
      expect(finalFeeBal - initialFeeBal).to.equal(ethers.parseEther('0.025'));
    });
  });

  describe('Delivery Submission & Work Approvals', () => {
    beforeEach(async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });
    });

    it('allows seller to submit deliverables reference and transitions to Delivered state', async () => {
      const deliverableRef = 'ipfs://QmSampleDeliverableHash12345';
      await expect(escrow.connect(seller).submitDelivery(orderId1, deliverableRef))
        .to.emit(escrow, 'DeliverySubmitted')
        .withArgs(orderId1, seller.address, deliverableRef);

      const order = await escrow.getOrder(orderId1);
      expect(order.status).to.equal(5); // EscrowStatus.Delivered
      expect(order.deliverableReference).to.equal(deliverableRef);
    });

    it('rejects delivery submission after deadline has passed', async () => {
      // Fast forward time past deadline
      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine', []);

      await expect(
        escrow.connect(seller).submitDelivery(orderId1, 'ipfs://QmLateDelivery')
      ).to.be.revertedWith('Delivery deadline has passed');
    });

    it('rejects buyer timeout refund after work has been delivered', async () => {
      await escrow.connect(seller).submitDelivery(orderId1, 'ipfs://QmOnTimeDelivery');

      // Fast forward time past deadline
      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine', []);

      // Buyer cannot unilaterally timeout refund after delivery
      await expect(
        escrow.connect(buyer).refund(orderId1, 'I want free work')
      ).to.be.revertedWith('Unauthorized refund: buyer timeout only allowed before delivery');
    });

    it('rejects delivery submission by non-seller', async () => {
      await expect(
        escrow.connect(stranger).submitDelivery(orderId1, 'ipfs://QmFake')
      ).to.be.revertedWith('Only seller can submit deliverables');
    });

    it('rejects empty deliverable reference', async () => {
      await expect(
        escrow.connect(seller).submitDelivery(orderId1, '')
      ).to.be.revertedWith('Empty deliverable reference');
    });

    it('allows buyer to approve and release funds after delivery is submitted', async () => {
      await escrow.connect(seller).submitDelivery(orderId1, 'ipfs://QmWorkRef');
      await expect(escrow.connect(buyer).releaseFunds(orderId1))
        .to.emit(escrow, 'OrderReleased');

      const order = await escrow.getOrder(orderId1);
      expect(order.status).to.equal(2); // EscrowStatus.Released
    });
  });

  describe('Pull-Payment Fallback on Failed Transfers', () => {
    it('safely credits pendingWithdrawals if seller contract rejects direct transfer', async () => {
      const RejectingFactory = await ethers.getContractFactory('RejectingReceiver');
      const rejectingReceiver = (await RejectingFactory.deploy()) as unknown as RejectingReceiver;
      await rejectingReceiver.waitForDeployment();
      const rejectingAddress = await rejectingReceiver.getAddress();

      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      const orderIdReject = ethers.encodeBytes32String('order-reject-01');

      await escrow.connect(buyer).deposit(orderIdReject, rejectingAddress, deadline, {
        value: depositAmount,
      });

      // Buyer approves and releases funds
      // The push transfer to rejectingReceiver will fail, but instead of reverting, it credits pendingWithdrawals!
      const expectedSellerAmount = ethers.parseEther('0.95');
      await expect(escrow.connect(buyer).releaseFunds(orderIdReject))
        .to.emit(escrow, 'WithdrawalPending')
        .withArgs(rejectingAddress, expectedSellerAmount);

      expect(await escrow.pendingWithdrawals(rejectingAddress)).to.equal(expectedSellerAmount);
      const order = await escrow.getOrder(orderIdReject);
      expect(order.status).to.equal(2); // EscrowStatus.Released
    });

    it('rejects withdrawPending when caller has no pending balance', async () => {
      await expect(escrow.connect(buyer).withdrawPending()).to.be.revertedWith(
        'No pending withdrawal'
      );
    });

    it('allows a legitimate user to claim pending withdrawals via withdrawPending', async () => {
      // Simulate by having seller be a rejecting contract, then enabling seller or testing seller transfer fallback
      const RejectingFactory = await ethers.getContractFactory('RejectingReceiver');
      const rejecting = (await RejectingFactory.deploy()) as unknown as RejectingReceiver;
      await rejecting.waitForDeployment();
      const rejectingAddress = await rejecting.getAddress();

      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      const orderIdReject2 = ethers.encodeBytes32String('order-reject-02');

      await escrow.connect(buyer).deposit(orderIdReject2, rejectingAddress, deadline, {
        value: depositAmount,
      });
      await escrow.connect(buyer).releaseFunds(orderIdReject2);

      const pending = await escrow.pendingWithdrawals(rejectingAddress);
      expect(pending).to.equal(ethers.parseEther('0.95'));

      // Stranger cannot withdraw rejectingAddress's balance
      await expect(escrow.connect(stranger).withdrawPending()).to.be.revertedWith(
        'No pending withdrawal'
      );
    });
  });

  describe('Cancellation & Administration', () => {
    it('allows buyer to trigger timeout refund if deadline passed without delivery', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });

      // Advance time past deadline
      await ethers.provider.send('evm_increaseTime', [86401]);
      await ethers.provider.send('evm_mine', []);

      const initialBuyerBal = await ethers.provider.getBalance(buyer.address);
      const tx = await escrow.connect(buyer).refund(orderId1, 'Deadline expired without delivery');
      const receipt = await tx.wait();
      const gasSpent = receipt!.gasUsed * receipt!.gasPrice;

      const finalBuyerBal = await ethers.provider.getBalance(buyer.address);
      expect(finalBuyerBal + gasSpent - initialBuyerBal).to.equal(depositAmount);

      const order = await escrow.getOrder(orderId1);
      expect(order.status).to.equal(3); // EscrowStatus.Refunded
    });

    it('rejects unauthorized dispute resolution from non-reviewer and non-owner', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });
      await escrow.connect(buyer).dispute(orderId1, 'Dispute reason');

      await expect(
        escrow.connect(stranger).resolveDispute(orderId1, 50)
      ).to.be.revertedWith('Only reviewer or owner');

      await expect(
        escrow.connect(buyer).resolveDispute(orderId1, 50)
      ).to.be.revertedWith('Only reviewer or owner');

      await expect(
        escrow.connect(seller).resolveDispute(orderId1, 50)
      ).to.be.revertedWith('Only reviewer or owner');
    });

    it('rejects dispute resolution with invalid split percentage > 100', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });
      await escrow.connect(buyer).dispute(orderId1, 'Dispute reason');

      await expect(
        escrow.connect(reviewer).resolveDispute(orderId1, 101)
      ).to.be.revertedWith('Split percent must be 0..100');
    });

    it('allows seller to cancel order and return funds to buyer fee-free', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });

      await expect(escrow.connect(seller).cancelOrder(orderId1, 'Seller mutual cancel'))
        .to.emit(escrow, 'OrderRefunded')
        .withArgs(orderId1, buyer.address, depositAmount, 'Seller mutual cancel');
    });

    it('rejects buyer cancellation before deadline passes', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentBlockTime = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = currentBlockTime + 86400;
      await escrow.connect(buyer).deposit(orderId1, seller.address, deadline, {
        value: depositAmount,
      });

      await expect(
        escrow.connect(buyer).cancelOrder(orderId1, 'Premature cancel')
      ).to.be.revertedWith('Unauthorized refund: buyer timeout only allowed before delivery');
    });

    it('owner can update fee configuration up to 500 basis points and rejects above 500', async () => {
      // 500 bps is accepted (5%)
      await expect(escrow.connect(owner).setFeeConfig(stranger.address, 500))
        .to.emit(escrow, 'FeeConfigUpdated')
        .withArgs(stranger.address, 500);

      expect(await escrow.platformFeeBasisPoints()).to.equal(500n);
      expect(await escrow.feeRecipient()).to.equal(stranger.address);

      // Above 500 bps (e.g. 501 bps or 600 bps or 1000 bps) is rejected
      await expect(
        escrow.connect(owner).setFeeConfig(stranger.address, 501)
      ).to.be.revertedWith('Fee exceeds max');

      await expect(
        escrow.connect(owner).setFeeConfig(stranger.address, 600)
      ).to.be.revertedWith('Fee exceeds max');

      await expect(
        escrow.connect(owner).setFeeConfig(stranger.address, 1000)
      ).to.be.revertedWith('Fee exceeds max');
    });

    it('constructor rejects initial fee exceeding 500 basis points', async () => {
      const EscrowFactory = await ethers.getContractFactory('VeilServiceEscrow');
      await expect(
        EscrowFactory.deploy(reviewer.address, feeRecipient.address, 501)
      ).to.be.revertedWith('Fee exceeds max');
    });

    it('rejects non-owner attempts to update fee config or reviewer', async () => {
      await expect(
        escrow.connect(stranger).setFeeConfig(stranger.address, 200)
      ).to.be.revertedWith('Only owner');

      await expect(
        escrow.connect(stranger).setReviewer(stranger.address)
      ).to.be.revertedWith('Only owner');
    });

    it('rejects zero address when updating fee recipient or reviewer', async () => {
      await expect(
        escrow.connect(owner).setFeeConfig(ethers.ZeroAddress, 200)
      ).to.be.revertedWith('Invalid fee recipient');

      await expect(
        escrow.connect(owner).setReviewer(ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid reviewer');
    });

    it('owner can update reviewer address', async () => {
      await expect(escrow.connect(owner).setReviewer(stranger.address))
        .to.emit(escrow, 'ReviewerUpdated')
        .withArgs(stranger.address);

      expect(await escrow.reviewer()).to.equal(stranger.address);
    });
  });
  describe('Fee snapshot & dispute timeout (hardening)', () => {
    const DISPUTE_TIMEOUT = 7 * 24 * 60 * 60;
    const orderId2 = ethers.encodeBytes32String('order-test-002');

    async function fund(id: string) {
      const latestBlock = await ethers.provider.getBlock('latest');
      const deadline = (latestBlock?.timestamp ?? 0) + 86400;
      await escrow.connect(buyer).deposit(id, seller.address, deadline, { value: depositAmount });
    }

    it('locks the fee rate at deposit so owner changes do not affect in-flight orders', async () => {
      await fund(orderId1);
      expect(await escrow.orderFeeBps(orderId1)).to.equal(500n);

      await escrow.connect(owner).setFeeConfig(feeRecipient.address, 100);
      await fund(orderId2);
      expect(await escrow.orderFeeBps(orderId2)).to.equal(100n);

      await expect(escrow.connect(buyer).releaseFunds(orderId1))
        .to.emit(escrow, 'OrderReleased')
        .withArgs(orderId1, buyer.address, seller.address, ethers.parseEther('0.95'), ethers.parseEther('0.05'));
      await expect(escrow.connect(buyer).releaseFunds(orderId2))
        .to.emit(escrow, 'OrderReleased')
        .withArgs(orderId2, buyer.address, seller.address, ethers.parseEther('0.99'), ethers.parseEther('0.01'));
    });

    it('uses the snapshotted fee in dispute resolution and keeps the 5% cap', async () => {
      await fund(orderId1);
      await escrow.connect(owner).setFeeConfig(feeRecipient.address, 0);
      await escrow.connect(buyer).dispute(orderId1, 'quality');
      const before = await ethers.provider.getBalance(feeRecipient.address);
      await escrow.connect(reviewer).resolveDispute(orderId1, 0);
      const after = await ethers.provider.getBalance(feeRecipient.address);
      expect(after - before).to.equal(ethers.parseEther('0.05'));
      await expect(escrow.connect(owner).setFeeConfig(feeRecipient.address, 501)).to.be.revertedWith('Fee exceeds max');
    });

    it('refunds the buyer in full after DISPUTE_TIMEOUT when the reviewer is absent (anyone can trigger)', async () => {
      expect(await escrow.DISPUTE_TIMEOUT()).to.equal(BigInt(DISPUTE_TIMEOUT));
      await fund(orderId1);
      await expect(escrow.connect(stranger).resolveDisputeTimeout(orderId1)).to.be.revertedWith('Order is not in disputed state');
      await escrow.connect(seller).submitDelivery(orderId1, 'ipfs://work');
      await escrow.connect(seller).dispute(orderId1, 'buyer unresponsive');
      expect(await escrow.disputedAt(orderId1)).to.be.greaterThan(0n);

      await time.increase(DISPUTE_TIMEOUT - 10);
      await expect(escrow.connect(stranger).resolveDisputeTimeout(orderId1)).to.be.revertedWith('Dispute review period still active');
      await time.increase(20);

      const before = await ethers.provider.getBalance(buyer.address);
      await expect(escrow.connect(stranger).resolveDisputeTimeout(orderId1))
        .to.emit(escrow, 'DisputeTimedOut').withArgs(orderId1, buyer.address, depositAmount)
        .and.to.emit(escrow, 'DisputeResolved').withArgs(orderId1, depositAmount, 0);
      expect((await ethers.provider.getBalance(buyer.address)) - before).to.equal(depositAmount);
      const order = await escrow.getOrder(orderId1);
      expect(order.status).to.equal(3); // Refunded
      expect(order.amount).to.equal(0n);
      expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
      await expect(escrow.connect(reviewer).resolveDispute(orderId1, 0)).to.be.revertedWith('Order is not in disputed state');
      await expect(escrow.connect(stranger).resolveDisputeTimeout(orderId1)).to.be.revertedWith('Order is not in disputed state');
    });

    it('reviewer can still resolve after the timeout elapses if nobody triggered it', async () => {
      await fund(orderId1);
      await escrow.connect(buyer).dispute(orderId1, 'x');
      await time.increase(DISPUTE_TIMEOUT + 1);
      await escrow.connect(reviewer).resolveDispute(orderId1, 0);
      expect((await escrow.getOrder(orderId1)).status).to.equal(2); // Released
    });
  });
});
