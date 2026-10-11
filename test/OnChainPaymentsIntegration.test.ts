import { expect } from 'chai';
import { ethers } from 'hardhat';
import { VeilServiceEscrow, RejectingReceiver } from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { formatServiceOrderId } from '../lib/agent-sdk';

describe('VEILIO On-Chain Payments Integration Test Suite', () => {
  let escrow: VeilServiceEscrow;
  let owner: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let reviewer: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let stranger: SignerWithAddress;

  const orderStringId = 'ord-payment-integration-101';
  const orderBytes32 = ethers.encodeBytes32String(orderStringId);
  const depositAmount = ethers.parseEther('2.0'); // 2.0 tBNB

  beforeEach(async () => {
    [owner, buyer, seller, reviewer, feeRecipient, stranger] = await ethers.getSigners();

    const EscrowFactory = await ethers.getContractFactory('VeilServiceEscrow');
    // Deploy VeilServiceEscrow with 500 bps (5%) platform fee
    escrow = (await EscrowFactory.deploy(
      reviewer.address,
      feeRecipient.address,
      500
    )) as unknown as VeilServiceEscrow;
    await escrow.waitForDeployment();
  });

  describe('1. Platform Fee & Normal Release (95% Seller / 5% Fee Recipient Split)', () => {
    it('verifies exact 95% seller and 5% platform fee split on releaseFunds', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const now = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = now + 86400;

      // Buyer deposits 2.0 ETH / BNB
      await escrow.connect(buyer).deposit(orderBytes32, seller.address, deadline, {
        value: depositAmount,
      });

      // Seller submits delivery
      await escrow.connect(seller).submitDelivery(orderBytes32, 'ipfs://QmDeliverable123');

      // Track balances before release
      const sellerBalBefore = await ethers.provider.getBalance(seller.address);
      const feeRecipientBalBefore = await ethers.provider.getBalance(feeRecipient.address);

      // Buyer approves work and releases funds
      const tx = await escrow.connect(buyer).releaseFunds(orderBytes32);
      const receipt = await tx.wait();

      // Platform fee is 500 bps = 5% of 2.0 BNB = 0.10 BNB
      const expectedFee = (depositAmount * 500n) / 10000n; // 0.10 BNB
      // Seller payout is 95% of 2.0 BNB = 1.90 BNB
      const expectedSellerPayout = depositAmount - expectedFee; // 1.90 BNB

      expect(expectedFee).to.equal(ethers.parseEther('0.1'));
      expect(expectedSellerPayout).to.equal(ethers.parseEther('1.9'));

      // Check event emission
      await expect(tx)
        .to.emit(escrow, 'OrderReleased')
        .withArgs(orderBytes32, buyer.address, seller.address, expectedSellerPayout, expectedFee);

      // Verify recipient balances
      const sellerBalAfter = await ethers.provider.getBalance(seller.address);
      const feeRecipientBalAfter = await ethers.provider.getBalance(feeRecipient.address);

      expect(sellerBalAfter - sellerBalBefore).to.equal(expectedSellerPayout);
      expect(feeRecipientBalAfter - feeRecipientBalBefore).to.equal(expectedFee);

      // Verify order state in contract
      const order = await escrow.getOrder(orderBytes32);
      expect(order.status).to.equal(2); // EscrowStatus.Released
    });
  });

  describe('2. Fee-Free Cancellation & Refund Behavior (100% Buyer Refund)', () => {
    it('applies 100% fee-free refund to buyer when seller cancels', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const now = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = now + 86400;

      await escrow.connect(buyer).deposit(orderBytes32, seller.address, deadline, {
        value: depositAmount,
      });

      const buyerBalBefore = await ethers.provider.getBalance(buyer.address);

      // Seller cancels order
      await expect(
        escrow.connect(seller).cancelOrder(orderBytes32, 'Seller capacity constrained')
      )
        .to.emit(escrow, 'OrderRefunded')
        .withArgs(orderBytes32, buyer.address, depositAmount, 'Seller capacity constrained');

      const buyerBalAfter = await ethers.provider.getBalance(buyer.address);
      // Buyer gets 100% back without any platform fee deducted
      expect(buyerBalAfter - buyerBalBefore).to.equal(depositAmount);

      const order = await escrow.getOrder(orderBytes32);
      expect(order.status).to.equal(3); // EscrowStatus.Refunded
    });

    it('allows buyer to claim 100% timeout refund after deadline if no delivery was made', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const now = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = now + 3600; // 1 hour

      await escrow.connect(buyer).deposit(orderBytes32, seller.address, deadline, {
        value: depositAmount,
      });

      // Attempt refund before deadline -> must revert
      await expect(
        escrow.connect(buyer).cancelOrder(orderBytes32, 'Buyer wants out early')
      ).to.be.revertedWith('Unauthorized refund: buyer timeout only allowed before delivery');

      // Fast forward past deadline
      await ethers.provider.send('evm_increaseTime', [3601]);
      await ethers.provider.send('evm_mine', []);

      // Now buyer can cancel and receive 100% refund
      const buyerBalBefore = await ethers.provider.getBalance(buyer.address);
      const tx = await escrow.connect(buyer).cancelOrder(orderBytes32, 'Seller missed deadline');
      const receipt = await tx.wait();
      const gasSpent = receipt!.gasUsed * receipt!.gasPrice;

      const buyerBalAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerBalAfter + gasSpent - buyerBalBefore).to.equal(depositAmount);
    });

    it('reverts buyer timeout refund if work was already delivered before deadline', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const now = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = now + 3600;

      await escrow.connect(buyer).deposit(orderBytes32, seller.address, deadline, {
        value: depositAmount,
      });

      // Seller delivers work
      await escrow.connect(seller).submitDelivery(orderBytes32, 'ipfs://QmDeliveredProof');

      // Fast forward past deadline
      await ethers.provider.send('evm_increaseTime', [3601]);
      await ethers.provider.send('evm_mine', []);

      // Buyer cannot unilaterally cancel delivered work after deadline; must dispute
      await expect(
        escrow.connect(buyer).cancelOrder(orderBytes32, 'Trying to cancel delivered work')
      ).to.be.revertedWith('Unauthorized refund: buyer timeout only allowed before delivery');
    });
  });

  describe('3. Dispute Lifecycle & Split Rules', () => {
    it('executes full dispute workflow: dispute -> resolveDispute with custom split', async () => {
      const latestBlock = await ethers.provider.getBlock('latest');
      const now = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = now + 86400;

      await escrow.connect(buyer).deposit(orderBytes32, seller.address, deadline, {
        value: depositAmount,
      });

      // Seller submits delivery
      await escrow.connect(seller).submitDelivery(orderBytes32, 'ipfs://QmMilestonePartial');

      // Buyer opens dispute on-chain
      await expect(escrow.connect(buyer).dispute(orderBytes32, 'Milestone defective'))
        .to.emit(escrow, 'OrderDisputed')
        .withArgs(orderBytes32, buyer.address, 'Milestone defective');

      let order = await escrow.getOrder(orderBytes32);
      expect(order.status).to.equal(4); // EscrowStatus.Disputed

      // Unauthorized party cannot resolve dispute
      await expect(
        escrow.connect(buyer).resolveDispute(orderBytes32, 50)
      ).to.be.revertedWith('Only reviewer or owner');

      // Reviewer resolves dispute with 60% refund to buyer, 40% gross award to seller
      // 60% buyer refund of 2.0 BNB = 1.2 BNB (0% fee)
      // 40% seller gross award of 2.0 BNB = 0.8 BNB
      // 5% fee on seller award = 0.8 * 0.05 = 0.04 BNB
      // Net seller payout = 0.8 - 0.04 = 0.76 BNB
      const buyerBalBefore = await ethers.provider.getBalance(buyer.address);
      const sellerBalBefore = await ethers.provider.getBalance(seller.address);
      const feeBalBefore = await ethers.provider.getBalance(feeRecipient.address);

      const resolveTx = await escrow.connect(reviewer).resolveDispute(orderBytes32, 60);

      await expect(resolveTx)
        .to.emit(escrow, 'DisputeResolved')
        .withArgs(
          orderBytes32,
          ethers.parseEther('1.2'),
          ethers.parseEther('0.8')
        );

      const buyerBalAfter = await ethers.provider.getBalance(buyer.address);
      const sellerBalAfter = await ethers.provider.getBalance(seller.address);
      const feeBalAfter = await ethers.provider.getBalance(feeRecipient.address);

      expect(buyerBalAfter - buyerBalBefore).to.equal(ethers.parseEther('1.2'));
      expect(sellerBalAfter - sellerBalBefore).to.equal(ethers.parseEther('0.76'));
      expect(feeBalAfter - feeBalBefore).to.equal(ethers.parseEther('0.04'));

      order = await escrow.getOrder(orderBytes32);
      expect(order.status).to.equal(2); // EscrowStatus.Released
    });
  });

  describe('4. Pull-Payment Fallback (withdrawPending)', () => {
    it('safely credits pendingWithdrawals if direct transfer to receiver fails', async () => {
      // Deploy RejectingReceiver contract
      const RejectingFactory = await ethers.getContractFactory('RejectingReceiver');
      const rejectingReceiver = (await RejectingFactory.deploy()) as unknown as RejectingReceiver;
      await rejectingReceiver.waitForDeployment();
      const rejectingAddress = await rejectingReceiver.getAddress();

      const latestBlock = await ethers.provider.getBlock('latest');
      const now = latestBlock?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = now + 86400;

      // Buyer deposits with rejectingAddress as seller
      await escrow.connect(buyer).deposit(orderBytes32, rejectingAddress, deadline, {
        value: depositAmount,
      });

      // Submit delivery & release funds
      // The release transfer to the rejecting contract will fail, triggering pull-payment fallback
      await escrow.connect(buyer).releaseFunds(orderBytes32);

      const expectedFee = (depositAmount * 500n) / 10000n;
      const expectedSellerPayout = depositAmount - expectedFee;

      // Seller payout should be stored in pendingWithdrawals
      const pendingAmount = await escrow.pendingWithdrawals(rejectingAddress);
      expect(pendingAmount).to.equal(expectedSellerPayout);
    });
  });

  describe('5. Formatting & Order ID Canonicalization', () => {
    it('correctly maps human order strings to bytes32 format', () => {
      const formatted = formatServiceOrderId('ord-123456');
      expect(formatted).to.match(/^0x[a-fA-F0-9]{64}$/);
    });
  });
});
