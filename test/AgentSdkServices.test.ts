import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  createVeilioAgent,
  createVeilioServicesClient,
  formatServiceOrderId,
  VEILIO_CHAIN_ID,
  VEILIO_CONTRACT_ADDRESS,
  VEILIO_SERVICES_CONTRACT_ADDRESS,
  AUCTION_STATES,
  SERVICE_ESCROW_STATES,
} from '../lib/agent-sdk';
import { VeilServiceEscrow } from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('VEILIO Agent SDK - Services Extension & Backward Compatibility', () => {
  let escrowContract: VeilServiceEscrow;
  let owner: SignerWithAddress;
  let buyer: SignerWithAddress;
  let seller: SignerWithAddress;
  let reviewer: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

  beforeEach(async () => {
    [owner, buyer, seller, reviewer, feeRecipient] = await ethers.getSigners();

    const EscrowFactory = await ethers.getContractFactory('VeilServiceEscrow');
    escrowContract = (await EscrowFactory.deploy(
      reviewer.address,
      feeRecipient.address,
      500 // 5% fee
    )) as unknown as VeilServiceEscrow;
    await escrowContract.waitForDeployment();
  });

  describe('Backward Compatibility for Existing Auction Features', () => {
    it('preserves existing SDK constants and state enums', () => {
      expect(VEILIO_CHAIN_ID).to.equal(97);
      expect(VEILIO_CONTRACT_ADDRESS).to.be.a('string');
      expect(AUCTION_STATES).to.include('Created');
      expect(AUCTION_STATES).to.include('Bidding');
      expect(AUCTION_STATES).to.include('Revealing');
      expect(AUCTION_STATES).to.include('Completed');
    });

    it('instantiates createVeilioAgent with legacy methods intact', () => {
      const mockPublicClient = {
        readContract: async () => 0n,
      } as any;

      const agent = createVeilioAgent({
        publicClient: mockPublicClient,
        account: buyer.address as `0x${string}`,
      });

      expect(agent.address).to.equal(VEILIO_CONTRACT_ADDRESS);
      expect(agent.chainId).to.equal(97);
      expect(agent.getAuction).to.be.a('function');
      expect(agent.listAuctions).to.be.a('function');
      expect(agent.searchAssets).to.be.a('function');
      expect(agent.getAssetDetails).to.be.a('function');
      expect(agent.evaluateAsset).to.be.a('function');
      expect(agent.prepareBid).to.be.a('function');
      expect(agent.commitBid).to.be.a('function');
      expect(agent.revealBid).to.be.a('function');
      expect(agent.getAuctionResult).to.be.a('function');
      expect(agent.claimAsset).to.be.a('function');
      expect(agent.getLicense).to.be.a('function');
    });

    it('exposes the full auction lifecycle and targets the chosen chain (S3/S4)', async () => {
      const agent = createVeilioAgent({
        publicClient: { readContract: async () => 0n } as any,
        account: buyer.address as `0x${string}`,
        chainId: 84532,
      });
      expect(agent.chainId).to.equal(84532);
      expect(agent.services?.chainId).to.equal(84532);
      expect(agent.prepareBid(1n, '0.01').chainId).to.equal(84532);
      for (const fn of ['settleAuction', 'finalizeSettlement', 'requestRefund', 'withdrawRefund', 'getPendingRefund', 'isNftAuction']) {
        expect((agent as any)[fn]).to.be.a('function');
      }
      expect(() =>
        createVeilioAgent({ publicClient: {} as any, account: buyer.address as `0x${string}`, chainId: 1 })
      ).to.throw('Invalid chain ID 1');

      const sent: unknown[] = [];
      const bnbAgent = createVeilioAgent({
        publicClient: { readContract: async () => 0n } as any,
        walletClient: {
          account: buyer.address,
          chain: { id: 84532 },
          writeContract: async (req: unknown) => { sent.push(req); return '0x'; },
        } as any,
        account: buyer.address as `0x${string}`,
      });
      await expect(bnbAgent.settleAuction(1)).to.be.rejectedWith('does not match required BNB Chain testnet (97)');
      expect(sent).to.have.length(0);
    });
  });

  describe('Configuration & Security Guardrails', () => {
    it('fails clearly when Services contract address is missing or invalid', () => {
      expect(() =>
        createVeilioServicesClient({
          publicClient: {} as any,
          contractAddress: '' as any,
        })
      ).to.throw('NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS is missing or invalid');

      expect(() =>
        createVeilioServicesClient({
          publicClient: {} as any,
          contractAddress: '0x0000000000000000000000000000000000000000' as any,
        })
      ).to.throw('NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS is missing or invalid');

      expect(() =>
        createVeilioServicesClient({
          publicClient: {} as any,
          contractAddress: 'not-an-address' as any,
        })
      ).to.throw('NEXT_PUBLIC_SERVICE_ESCROW_CONTRACT_ADDRESS is missing or invalid');
    });

    it('prevents accidental fallback to auction contract address', () => {
      expect(() =>
        createVeilioServicesClient({
          publicClient: {} as any,
          contractAddress: VEILIO_CONTRACT_ADDRESS,
        })
      ).to.throw('cannot use the VEILIO auction contract address for Services escrow');
    });

    it('validates chain ID and prevents cross-chain execution', () => {
      expect(() =>
        createVeilioServicesClient({
          publicClient: {} as any,
          contractAddress: buyer.address as `0x${string}`,
          chainId: 1, // Mainnet instead of 97
        })
      ).to.throw('Invalid chain ID 1');
    });

    it('formats string and hex order IDs correctly into bytes32', () => {
      const formattedStr = formatServiceOrderId('order-test-uuid');
      expect(formattedStr).to.match(/^0x[0-9a-fA-F]{64}$/);

      const alreadyHex = '0x1234567890123456789012345678901234567890123456789012345678901234';
      expect(formatServiceOrderId(alreadyHex)).to.equal(alreadyHex);
    });
  });

  describe('Dedicated Services Client Module & Contract Interaction', () => {
    it('reads deployed VeilServiceEscrow parameters using SDK client', async () => {
      const escrowAddress = (await escrowContract.getAddress()) as `0x${string}`;

      const viemPublicClient = {
        readContract: async ({ functionName, args }: any) => {
          if (functionName === 'getOrder') {
            const res = await escrowContract.getOrder(args[0]);
            return {
              orderId: res.orderId,
              buyer: res.buyer,
              seller: res.seller,
              amount: res.amount,
              deadline: res.deadline,
              status: Number(res.status),
              createdAt: res.createdAt,
              settledAt: res.settledAt,
              deliverableReference: res.deliverableReference,
            };
          }
          if (functionName === 'platformFeeBasisPoints') return escrowContract.platformFeeBasisPoints();
          if (functionName === 'feeRecipient') return escrowContract.feeRecipient();
          if (functionName === 'reviewer') return escrowContract.reviewer();
          throw new Error('Unknown function: ' + functionName);
        },
      } as any;

      const servicesClient = createVeilioServicesClient({
        publicClient: viemPublicClient,
        contractAddress: escrowAddress,
      });

      const feeConfig = await servicesClient.getFeeConfig();
      expect(feeConfig.feeRecipient).to.equal(feeRecipient.address);
      expect(feeConfig.platformFeeBps).to.equal(500);
      expect(feeConfig.feePercent).to.equal(5);

      const reviewerAddr = await servicesClient.getReviewer();
      expect(reviewerAddr).to.equal(reviewer.address);

      const nonExistent = await servicesClient.getOrder('order-999');
      expect(nonExistent).to.be.null;
    });

    it('interacts with escrow workflow: deposit, delivery, and getOrder state', async () => {
      const escrowAddress = (await escrowContract.getAddress()) as `0x${string}`;
      const orderIdHex = formatServiceOrderId('order-sdk-flow-01');
      const latestBlock = await ethers.provider.getBlock('latest');
      const deadline = BigInt((latestBlock?.timestamp ?? Math.floor(Date.now() / 1000)) + 86400);

      // 1. Buyer deposits
      await escrowContract.connect(buyer).deposit(orderIdHex, seller.address, deadline, {
        value: ethers.parseEther('0.5'),
      });

      // 2. Viem adapter reading actual contract state
      const viemPublicClient = {
        readContract: async ({ functionName, args }: any) => {
          if (functionName === 'getOrder') {
            const res = await escrowContract.getOrder(args[0]);
            return {
              orderId: res.orderId,
              buyer: res.buyer,
              seller: res.seller,
              amount: res.amount,
              deadline: res.deadline,
              status: Number(res.status),
              createdAt: res.createdAt,
              settledAt: res.settledAt,
              deliverableReference: res.deliverableReference,
            };
          }
        },
      } as any;

      const servicesClient = createVeilioServicesClient({
        publicClient: viemPublicClient,
        contractAddress: escrowAddress,
      });

      const orderBefore = await servicesClient.getOrder(orderIdHex);
      expect(orderBefore).to.not.be.null;
      expect(orderBefore?.status).to.equal('Funded');
      expect(orderBefore?.amountBnb).to.equal('0.5');
      expect(orderBefore?.buyer.toLowerCase()).to.equal(buyer.address.toLowerCase());
      expect(orderBefore?.seller.toLowerCase()).to.equal(seller.address.toLowerCase());

      // 3. Seller submits delivery
      await escrowContract.connect(seller).submitDelivery(orderIdHex, 'ipfs://QmWorkSDKProof');
      const orderAfterDelivery = await servicesClient.getOrder(orderIdHex);
      expect(orderAfterDelivery?.status).to.equal('Delivered');
      expect(orderAfterDelivery?.deliverableReference).to.equal('ipfs://QmWorkSDKProof');

      // 4. Buyer releases funds
      await escrowContract.connect(buyer).releaseFunds(orderIdHex);
      const orderAfterRelease = await servicesClient.getOrder(orderIdHex);
      expect(orderAfterRelease?.status).to.equal('Released');
    });

    it('properly distinguishes reverted transactions when waiting for receipts', async () => {
      const escrowAddress = (await escrowContract.getAddress()) as `0x${string}`;

      const mockPublicClient = {
        waitForTransactionReceipt: async () => ({
          status: 'reverted',
          transactionHash: '0x1234',
        }),
      } as any;

      const mockWalletClient = {
        writeContract: async () => '0x1234',
        chain: { id: 97 },
      } as any;

      const servicesClient = createVeilioServicesClient({
        publicClient: mockPublicClient,
        walletClient: mockWalletClient,
        account: buyer.address as `0x${string}`,
        contractAddress: escrowAddress,
      });

      const res = await servicesClient.releaseFunds('order-reverted-test');
      expect(res.txHash).to.equal('0x1234');
      expect(res.status).to.equal('submitted');

      await expect(res.wait()).to.be.rejectedWith('Transaction 0x1234 reverted on-chain.');
    });
  });
});
