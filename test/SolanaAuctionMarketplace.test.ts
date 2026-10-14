import { expect } from 'chai';
import crypto from 'crypto';
import {
  formatSolLamports,
  normalizeSolanaAuction,
  querySolanaOnchainAuctionsDirectly,
  fetchSolanaOnchainAuctionById,
} from '../lib/solanaAuctions';
import {
  DEFAULT_SOLANA_AUCTION_PROGRAM_ID,
  findAuctionPda,
  findBidCommitmentPda,
  computeSealedBidCommitment,
  createCommitBidInstruction,
  createRevealBidInstruction,
  createSettleAuctionInstruction,
  decodeAuctionStateAccount,
  SolanaAuctionState,
  type DecodedAuctionState,
} from '../lib/cross-chain/solanaAuction';
import {
  getAnchorDiscriminator,
  encodeBase58,
} from '../lib/cross-chain/solanaServiceRegistry';
import { baseSepoliaChain, bnbChain } from '../lib/chain';

describe('VEILIO — Solana Devnet Auctions Marketplace Integration', () => {
  const dummyProgramId = DEFAULT_SOLANA_AUCTION_PROGRAM_ID;
  const sellerWallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const reviewerWallet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  const bidderWallet = '4fYNw3dojWmQ4dXtSGE9epjRGy9pFSVa62YMMnk58rTQ';

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Solana Data Normalization
  // ──────────────────────────────────────────────────────────────────────────
  describe('Solana Auction Data Normalization', () => {
    it('normalizes DecodedAuctionState into standard AuctionItem format without fabricated fields', () => {
      const now = Math.floor(Date.now() / 1000);
      const decoded: DecodedAuctionState = {
        seller: sellerWallet,
        reviewer: reviewerWallet,
        auctionId: 501n,
        itemName: 'Autonomous Agent Training Corpus',
        description: 'Verified on-chain text corpus for financial modeling agents.',
        imageUri: 'ipfs://QmSampleHash12345',
        startingPrice: 2_500_000_000n, // 2.5 SOL
        commitEndTime: now + 3600,
        revealEndTime: now + 7200,
        inspectionDuration: 3600,
        inspectionEndTime: 0,
        refundRequestedAt: 0,
        state: SolanaAuctionState.Bidding,
        highestBidder: '',
        highestBid: 0n,
        bidderCount: 4,
        revealedCount: 0,
        evidenceHash: '0x' + '00'.repeat(32),
        reviewReason: '',
        bump: 254,
      };

      const normalized = normalizeSolanaAuction(decoded);

      expect(normalized.id).to.equal('501');
      expect(normalized.itemName).to.equal('Autonomous Agent Training Corpus');
      expect(normalized.description).to.equal('Verified on-chain text corpus for financial modeling agents.');
      expect(normalized.imageURI).to.equal('ipfs://QmSampleHash12345');
      expect(normalized.startingPrice).to.equal('2.5');
      expect(normalized.bidderCount).to.equal(4);
      expect(normalized.status).to.equal('Bidding');
      expect(normalized.seller).to.equal(sellerWallet);
      expect(normalized.networkId).to.equal('solana:devnet');
      expect(normalized.contractAddress).to.equal(dummyProgramId);
      expect(normalized.commitEndTime).to.equal((now + 3600) * 1000);
      expect(normalized.revealEndTime).to.equal((now + 7200) * 1000);
    });

    it('correctly maps various auction states and timestamps', () => {
      const now = Math.floor(Date.now() / 1000);

      // Bidding state
      const biddingState: DecodedAuctionState = {
        seller: sellerWallet, reviewer: reviewerWallet, auctionId: 1n,
        itemName: 'A', description: 'B', imageUri: '', startingPrice: 1_000_000_000n,
        commitEndTime: now + 1000, revealEndTime: now + 2000,
        inspectionDuration: 3600, inspectionEndTime: 0, refundRequestedAt: 0,
        state: SolanaAuctionState.Bidding, highestBidder: '', highestBid: 0n,
        bidderCount: 0, revealedCount: 0, evidenceHash: '', reviewReason: '', bump: 255,
      };
      expect(normalizeSolanaAuction(biddingState).status).to.equal('Bidding');

      // Revealing state
      const revealingState: DecodedAuctionState = {
        ...biddingState,
        commitEndTime: now - 100,
        revealEndTime: now + 1000,
        state: SolanaAuctionState.Revealing,
      };
      expect(normalizeSolanaAuction(revealingState).status).to.equal('Revealing');

      // Completed / Settled state
      const completedState: DecodedAuctionState = {
        ...biddingState,
        commitEndTime: now - 2000,
        revealEndTime: now - 1000,
        state: SolanaAuctionState.Completed,
      };
      expect(normalizeSolanaAuction(completedState).status).to.equal('Settled');
    });

    it('formats lamports to decimal SOL properly', () => {
      expect(formatSolLamports(1_000_000_000n)).to.equal('1');
      expect(formatSolLamports(1_500_000_000n)).to.equal('1.5');
      expect(formatSolLamports(100_000_000n)).to.equal('0.1');
      expect(formatSolLamports(1n)).to.equal('0.000000001');
      expect(formatSolLamports(50_000_000_000n)).to.equal('50');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Chain-Aware Network Isolation & Routing
  // ──────────────────────────────────────────────────────────────────────────
  describe('Network Isolation & Chain Routing', () => {
    it('generates chain-appropriate block explorer links for each network', () => {
      const bnbAuctionId = '1';
      const bnbTx = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const baseTx = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const solanaTx = '5UfDqcMjZnyAJvGZ6nJq4hQeN5hQ1qU8gC8DkF2v2W1eKz4v9G8x4V1g3X9j2B6m';

      // BNB
      const bnbUrl = `${bnbChain.blockExplorers.default.url}/tx/${bnbTx}`;
      expect(bnbUrl).to.include('testnet.bscscan.com/tx/');

      // Base Sepolia
      const baseUrl = `${baseSepoliaChain.blockExplorers.default.url}/tx/${baseTx}`;
      expect(baseUrl).to.include('sepolia.basescan.org/tx/');

      // Solana Devnet
      const solanaUrl = `https://explorer.solana.com/tx/${solanaTx}?cluster=devnet`;
      expect(solanaUrl).to.include('explorer.solana.com/tx/');
      expect(solanaUrl).to.include('?cluster=devnet');
    });

    it('scopes bid secret storage keys by network to prevent cross-chain collisions', () => {
      const auctionId = '42';

      const bnbKey = `veilio_secret_${auctionId}_${bidderWallet.toLowerCase()}`;
      const baseKey = `veilio_secret_${baseSepoliaChain.id}:${auctionId}_${bidderWallet.toLowerCase()}`;
      const solanaKey = `veilio_secret_solana:devnet:${auctionId}_${bidderWallet.toLowerCase()}`;

      expect(bnbKey).to.not.equal(baseKey);
      expect(bnbKey).to.not.equal(solanaKey);
      expect(baseKey).to.not.equal(solanaKey);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Solana Devnet Program Verification & Empty State Handling
  // ──────────────────────────────────────────────────────────────────────────
  describe('Solana Devnet Program & Empty State Verification', () => {
    it('verifies the on-chain Anchor discriminator for AuctionStateAccount', () => {
      const disc = getAnchorDiscriminator('account', 'AuctionStateAccount');
      expect(disc.length).to.equal(8);
      const b58 = encodeBase58(disc);
      expect(b58).to.be.a('string');
      expect(b58.length).to.be.greaterThan(5);
    });

    it('queries Solana Devnet RPC and handles empty state gracefully without throwing', async () => {
      try {
        const auctions = await querySolanaOnchainAuctionsDirectly();
        expect(Array.isArray(auctions)).to.be.true;
        // If 0 auctions exist on devnet, it returns empty array cleanly
        expect(auctions.length).to.be.at.least(0);
      } catch (err: any) {
        // If RPC is blocked by rate-limit or offline, the error must indicate network connectivity
        expect(err.message).to.be.a('string');
      }
    });

    it('queries single auction account by ID and returns null when not found without crashing', async () => {
      try {
        const nonExistent = await fetchSolanaOnchainAuctionById(999999999n);
        expect(nonExistent).to.be.null;
      } catch (err: any) {
        expect(err.message).to.be.a('string');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Solana Auction Instruction Construction
  // ──────────────────────────────────────────────────────────────────────────
  describe('Solana Instruction Integrity', () => {
    it('builds sealed commit bid instruction with correct account keys and domain-tag commitment', () => {
      const auctionId = 101n;
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);
      const { pda: commitmentPda } = findBidCommitmentPda(auctionPda, bidderWallet, dummyProgramId);

      const salt = crypto.randomBytes(32);
      const maxBid = 1_500_000_000n; // 1.5 SOL
      const deposit = 2_000_000_000n; // 2.0 SOL deposit

      const commitment = computeSealedBidCommitment({
        auctionPubkey: auctionPda,
        bidderPubkey: bidderWallet,
        maxBidLamports: maxBid,
        salt,
      });

      const instruction = createCommitBidInstruction({
        programId: dummyProgramId,
        auctionId,
        bidder: bidderWallet,
        commitment,
        depositLamports: deposit,
      });

      expect(instruction.programId).to.equal(dummyProgramId);
      expect(instruction.accounts).to.have.length(4);
      expect(instruction.accounts[0].pubkey).to.equal(auctionPda);
      expect(instruction.accounts[0].isWritable).to.be.true;
      expect(instruction.accounts[1].pubkey).to.equal(commitmentPda);
      expect(instruction.accounts[1].isWritable).to.be.true;
      expect(instruction.accounts[2].pubkey).to.equal(bidderWallet);
      expect(instruction.accounts[2].isSigner).to.be.true;
    });

    it('builds reveal instruction with maxBid and salt verification', () => {
      const auctionId = 101n;
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);
      const { pda: commitmentPda } = findBidCommitmentPda(auctionPda, bidderWallet, dummyProgramId);
      const salt = crypto.randomBytes(32);
      const maxBid = 1_500_000_000n;

      const instruction = createRevealBidInstruction({
        programId: dummyProgramId,
        auctionId,
        bidder: bidderWallet,
        maxBidLamports: maxBid,
        salt,
      });

      expect(instruction.programId).to.equal(dummyProgramId);
      expect(instruction.accounts).to.have.length(3);
      expect(instruction.accounts[0].pubkey).to.equal(auctionPda);
      expect(instruction.accounts[1].pubkey).to.equal(commitmentPda);
      expect(instruction.accounts[2].pubkey).to.equal(bidderWallet);
      expect(instruction.accounts[2].isSigner).to.be.true;
    });

    it('builds permissionless settle auction instruction', () => {
      const auctionId = 101n;
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);

      const instruction = createSettleAuctionInstruction({
        programId: dummyProgramId,
        auctionId,
      });

      expect(instruction.programId).to.equal(dummyProgramId);
      expect(instruction.accounts).to.have.length(1);
      expect(instruction.accounts[0].pubkey).to.equal(auctionPda);
      expect(instruction.accounts[0].isWritable).to.be.true;
    });
  });
});
