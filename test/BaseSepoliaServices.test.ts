import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  createVeilioServicesClient,
  formatServiceOrderId,
  type DepositServiceOrderInput,
} from '../lib/agent-sdk';
import {
  getServiceEscrowAddress,
  getServiceRegistryAddress,
} from '../lib/serviceContract';
import { parseEther, formatEther } from 'viem';
import { VeilServiceEscrow, VeilServiceRegistry } from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('VEILIO Phase 3 — Base Sepolia Services Integration Suite', () => {
  let escrowContract: VeilServiceEscrow;
  let registryContract: VeilServiceRegistry;
  let owner: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let reviewer: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

  const BASE_SEPOLIA_CHAIN_ID = 84532;

  beforeEach(async () => {
    [owner, buyer, seller, reviewer, feeRecipient] = await ethers.getSigners();

    // Deploy test instances mirroring the Base Sepolia deployment
    const RegistryFactory = await ethers.getContractFactory('VeilServiceRegistry', owner);
    registryContract = (await RegistryFactory.deploy()) as unknown as VeilServiceRegistry;
    await registryContract.waitForDeployment();

    const EscrowFactory = await ethers.getContractFactory('VeilServiceEscrow', owner);
    escrowContract = (await EscrowFactory.deploy(
      reviewer.address,
      feeRecipient.address,
      850 // 8.5% fee
    )) as unknown as VeilServiceEscrow;
    await escrowContract.waitForDeployment();
  });

  describe('1. Configuration & Network Binding', () => {
    it('resolves configured Base Sepolia contract addresses', () => {
      const escrowAddr = getServiceEscrowAddress(BASE_SEPOLIA_CHAIN_ID);
      const registryAddr = getServiceRegistryAddress(BASE_SEPOLIA_CHAIN_ID);

      expect(escrowAddr).to.be.a('string');
      expect(escrowAddr).to.match(/^0x[a-fA-F0-9]{40}$/);
      expect(registryAddr).to.be.a('string');
      expect(registryAddr).to.match(/^0x[a-fA-F0-9]{40}$/);
    });

    it('rejects unsupported chain IDs (e.g. Ethereum Mainnet 1)', () => {
      expect(() =>
        createVeilioServicesClient({
          publicClient: {} as any,
          contractAddress: buyer.address as `0x${string}`,
          chainId: 1,
        })
      ).to.throw('Invalid chain ID 1');
    });

    it('instantiates client for Base Sepolia (84532) without throwing', async () => {
      const escrowAddr = (await escrowContract.getAddress()) as `0x${string}`;
      const client = createVeilioServicesClient({
        publicClient: {} as any,
        contractAddress: escrowAddr,
        chainId: BASE_SEPOLIA_CHAIN_ID,
      });

      expect(client.chainId).to.equal(BASE_SEPOLIA_CHAIN_ID);
      expect(client.address.toLowerCase()).to.equal(escrowAddr.toLowerCase());
    });
  });

  describe('2. Wallet Chain Isolation (SEC-CHAIN-01)', () => {
    it('rejects transaction when wallet is connected to BNB (97) but client is Base Sepolia (84532)', async () => {
      const escrowAddr = (await escrowContract.getAddress()) as `0x${string}`;

      const mockWalletClientOnBnb = {
        chain: { id: 97, name: 'BNB Testnet' },
        account: buyer.address as `0x${string}`,
        writeContract: async () => '0xmockhash',
      } as any;

      const client = createVeilioServicesClient({
        publicClient: {} as any,
        walletClient: mockWalletClientOnBnb,
        contractAddress: escrowAddr,
        chainId: BASE_SEPOLIA_CHAIN_ID,
      });

      const deadline = Math.floor(Date.now() / 1000) + 3600;

      await expect(
        client.deposit({
          orderId: 'test-order-cross-chain',
          seller: seller.address as `0x${string}`,
          deadline,
          amountEth: '0.05',
        })
      ).to.be.rejectedWith('does not match required Base Sepolia (84532)');
    });
  });

  describe('3. Order Lifecycle on Base Sepolia Contract: Deposit -> Delivery -> Approval -> Payout', () => {
    const orderIdStr = 'ord-base-sepolia-001';
    const orderBytes32 = formatServiceOrderId(orderIdStr);
    const depositAmountEth = ethers.parseEther('0.1'); // 0.1 ETH

    it('completes the full lifecycle with 8.5% platform fee deduction on Base Sepolia', async () => {
      const currentBlock = await ethers.provider.getBlock('latest');
      const deadline = (currentBlock?.timestamp || Math.floor(Date.now() / 1000)) + 7200;

      // Step A: Buyer deposits 0.1 ETH into Base Sepolia Escrow
      const depositTx = await escrowContract.connect(buyer).deposit(
        orderBytes32,
        seller.address,
        deadline,
        { value: depositAmountEth }
      );
      await depositTx.wait();

      let orderOnChain = await escrowContract.getOrder(orderBytes32);
      expect(orderOnChain.buyer).to.equal(buyer.address);
      expect(orderOnChain.seller).to.equal(seller.address);
      expect(orderOnChain.amount).to.equal(depositAmountEth);
      expect(orderOnChain.status).to.equal(1); // 1 = Funded

      // Step B: Seller submits deliverable reference
      const deliverableRef = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const submitTx = await escrowContract.connect(seller).submitDelivery(orderBytes32, deliverableRef);
      await submitTx.wait();

      orderOnChain = await escrowContract.getOrder(orderBytes32);
      expect(orderOnChain.status).to.equal(5); // 5 = Delivered
      expect(orderOnChain.deliverableReference).to.equal(deliverableRef);

      // Step C: Buyer approves work and releases funds
      const feeRecipientBalBefore = await ethers.provider.getBalance(feeRecipient.address);
      const sellerBalBefore = await ethers.provider.getBalance(seller.address);

      const releaseTx = await escrowContract.connect(buyer).releaseFunds(orderBytes32);
      await releaseTx.wait();

      orderOnChain = await escrowContract.getOrder(orderBytes32);
      expect(orderOnChain.status).to.equal(2); // 2 = Released
      expect(orderOnChain.amount).to.equal(0n); // zeroed out

      // Verify exact 8.5% platform fee payout
      const expectedFee = (depositAmountEth * 850n) / 10000n; // 0.0085 ETH
      const expectedSellerPayout = depositAmountEth - expectedFee; // 0.0915 ETH

      const feeRecipientBalAfter = await ethers.provider.getBalance(feeRecipient.address);
      const sellerBalAfter = await ethers.provider.getBalance(seller.address);

      expect(feeRecipientBalAfter - feeRecipientBalBefore).to.equal(expectedFee);
      expect(sellerBalAfter - sellerBalBefore).to.equal(expectedSellerPayout);
    });

    it('rejects unauthorized release attempt from a stranger', async () => {
      const currentBlock = await ethers.provider.getBlock('latest');
      const deadline = (currentBlock?.timestamp || Math.floor(Date.now() / 1000)) + 7200;
      await escrowContract.connect(buyer).deposit(orderBytes32, seller.address, deadline, {
        value: depositAmountEth,
      });

      await expect(
        escrowContract.connect(reviewer).releaseFunds(orderBytes32)
      ).to.be.revertedWith('Only buyer can approve and release funds');
    });

    it('handles timeout refund fee-free when deadline expires without delivery', async () => {
      const shortDeadline = (await ethers.provider.getBlock('latest'))!.timestamp + 10;
      await escrowContract.connect(buyer).deposit(orderBytes32, seller.address, shortDeadline, {
        value: depositAmountEth,
      });

      // Increase time past deadline
      await ethers.provider.send('evm_increaseTime', [20]);
      await ethers.provider.send('evm_mine', []);

      const buyerBalBefore = await ethers.provider.getBalance(buyer.address);
      const refundTx = await escrowContract.connect(buyer).cancelOrder(orderBytes32, 'Deadline passed');
      const receipt = await refundTx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      const buyerBalAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerBalAfter + gasCost - buyerBalBefore).to.equal(depositAmountEth);

      const orderOnChain = await escrowContract.getOrder(orderBytes32);
      expect(orderOnChain.status).to.equal(3); // 3 = Refunded
    });
  });

  describe('4. Dispute Resolution on Base Sepolia', () => {
    it('allows reviewer to resolve dispute with 60/40 split and 8.5% fee on seller share', async () => {
      const orderIdStr = 'ord-base-dispute-001';
      const orderBytes32 = formatServiceOrderId(orderIdStr);
      const amount = ethers.parseEther('1.0'); // 1 ETH
      const currentBlock = await ethers.provider.getBlock('latest');
      const deadline = (currentBlock?.timestamp || Math.floor(Date.now() / 1000)) + 7200;

      await escrowContract.connect(buyer).deposit(orderBytes32, seller.address, deadline, {
        value: amount,
      });

      await escrowContract.connect(buyer).dispute(orderBytes32, 'Scope not fulfilled');

      const orderBefore = await escrowContract.getOrder(orderBytes32);
      expect(orderBefore.status).to.equal(4); // 4 = Disputed

      const feeRecipientBefore = await ethers.provider.getBalance(feeRecipient.address);
      const sellerBefore = await ethers.provider.getBalance(seller.address);
      const buyerBefore = await ethers.provider.getBalance(buyer.address);

      // Reviewer awards 60% refund to buyer, 40% payout to seller
      const resolveTx = await escrowContract.connect(reviewer).resolveDispute(orderBytes32, 60);
      await resolveTx.wait();

      const buyerExpected = (amount * 60n) / 100n; // 0.6 ETH
      const sellerGross = amount - buyerExpected; // 0.4 ETH
      const feeExpected = (sellerGross * 850n) / 10000n; // 0.034 ETH
      const sellerNet = sellerGross - feeExpected; // 0.38 ETH

      const feeRecipientAfter = await ethers.provider.getBalance(feeRecipient.address);
      const sellerAfter = await ethers.provider.getBalance(seller.address);
      const buyerAfter = await ethers.provider.getBalance(buyer.address);

      expect(buyerAfter - buyerBefore).to.equal(buyerExpected);
      expect(sellerAfter - sellerBefore).to.equal(sellerNet);
      expect(feeRecipientAfter - feeRecipientBefore).to.equal(feeExpected);
    });
  });
});
