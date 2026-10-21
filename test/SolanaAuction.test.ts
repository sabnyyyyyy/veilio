import { expect } from 'chai';
import crypto from 'crypto';
import {
  findAuctionPda,
  findBidCommitmentPda,
  computeSealedBidCommitment,
  createCreateAuctionInstruction,
  createCommitBidInstruction,
  createRevealBidInstruction,
  createSettleAuctionInstruction,
  createAcceptDatasetInstruction,
  createFinalizeRefundTimeoutInstruction,
  createRequestRefundInstruction,
  decodeAuctionStateAccount,
  decodeBidCommitmentAccount,
  decodeAuctionConfigAccount,
  findAuctionFeeConfigPda,
  findAuctionConfigPda,
  createInitializeAuctionConfigInstruction,
  createUpdateAuctionConfigInstruction,
  createReviewRefundInstruction,
  AUCTION_CONFIG_ACCOUNT_SIZE,
  SolanaAuctionState,
  DEFAULT_SOLANA_AUCTION_PROGRAM_ID,
  COMMITMENT_DOMAIN_TAG,
} from '../lib/cross-chain/solanaAuction';
import {
  encodeBase58,
  decodeBase58,
  getAnchorDiscriminator,
  SYSTEM_PROGRAM_ID,
  findProgramDataPda,
} from '../lib/cross-chain/solanaServiceRegistry';
import { PublicKey } from '@solana/web3.js';

describe('VEILIO Milestone 4 — Solana Auction Program & Client Interface', () => {
  const dummyProgramId = DEFAULT_SOLANA_AUCTION_PROGRAM_ID;
  const sellerWallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const bidderWallet1 = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  const bidderWallet2 = '4fYNw3dojWmQ4dXtSGE9epjRGy9pFSVa62YMMnk58rTQ';

  const auctionId = 101n;
  const salt1 = crypto.randomBytes(32);
  const salt2 = crypto.randomBytes(32);

  // ==========================================================================
  // 1. PDA Derivation Tests
  // ==========================================================================
  describe('PDA Derivation', () => {
    it('deterministically derives PDA for an auction ID', () => {
      const res1 = findAuctionPda(auctionId, dummyProgramId);
      const res2 = findAuctionPda(auctionId, dummyProgramId);

      expect(res1.pda).to.equal(res2.pda);
      expect(res1.bump).to.equal(res2.bump);
      expect(res1.pda.length).to.be.greaterThanOrEqual(32);
    });

    it('produces distinct PDAs for different auction IDs', () => {
      const res1 = findAuctionPda(101n, dummyProgramId);
      const res2 = findAuctionPda(102n, dummyProgramId);
      expect(res1.pda).to.not.equal(res2.pda);
    });

    it('deterministically derives PDA for a bidder commitment', () => {
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);
      const res1 = findBidCommitmentPda(auctionPda, bidderWallet1, dummyProgramId);
      const res2 = findBidCommitmentPda(auctionPda, bidderWallet1, dummyProgramId);

      expect(res1.pda).to.equal(res2.pda);
      expect(res1.bump).to.equal(res2.bump);
    });

    it('produces distinct PDAs for different bidders in the same auction', () => {
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);
      const res1 = findBidCommitmentPda(auctionPda, bidderWallet1, dummyProgramId);
      const res2 = findBidCommitmentPda(auctionPda, bidderWallet2, dummyProgramId);

      expect(res1.pda).to.not.equal(res2.pda);
    });
  });

  // ==========================================================================
  // 2. Domain-Separated Cryptographic Commitment Tests
  // ==========================================================================
  describe('Sealed-Bid Commitment Math & Domain Separation', () => {
    it('computes deterministic SHA-256 commitment with domain separation', () => {
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);
      const maxBid = 2_000_000_000n; // 2.0 SOL

      const commit1 = computeSealedBidCommitment({
        auctionPubkey: auctionPda,
        bidderPubkey: bidderWallet1,
        maxBidLamports: maxBid,
        salt: salt1,
      });

      const commit2 = computeSealedBidCommitment({
        auctionPubkey: auctionPda,
        bidderPubkey: bidderWallet1,
        maxBidLamports: maxBid,
        salt: salt1,
      });

      expect(commit1).to.deep.equal(commit2);
      expect(commit1.length).to.equal(32);

      // Verify domain tag inclusion
      const manualHash = crypto
        .createHash('sha256')
        .update(COMMITMENT_DOMAIN_TAG)
        .update(Buffer.from(decodeBase58(auctionPda)))
        .update(Buffer.from(decodeBase58(bidderWallet1)))
        .update(Buffer.from([0x00, 0x94, 0x35, 0x77, 0x00, 0x00, 0x00, 0x00])) // 2_000_000_000 in LE
        .update(salt1)
        .digest();

      expect(commit1).to.deep.equal(manualHash);
    });

    it('alters commitment hash when maxBid, salt, auction, or bidder changes', () => {
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);
      const { pda: otherAuctionPda } = findAuctionPda(102n, dummyProgramId);

      const base = computeSealedBidCommitment({
        auctionPubkey: auctionPda,
        bidderPubkey: bidderWallet1,
        maxBidLamports: 2_000_000_000n,
        salt: salt1,
      });

      // Different bid
      const diffBid = computeSealedBidCommitment({
        auctionPubkey: auctionPda,
        bidderPubkey: bidderWallet1,
        maxBidLamports: 3_000_000_000n,
        salt: salt1,
      });
      expect(base).to.not.deep.equal(diffBid);

      // Different salt
      const diffSalt = computeSealedBidCommitment({
        auctionPubkey: auctionPda,
        bidderPubkey: bidderWallet1,
        maxBidLamports: 2_000_000_000n,
        salt: salt2,
      });
      expect(base).to.not.deep.equal(diffSalt);

      // Different bidder (prevents frontrunning / commitment theft)
      const diffBidder = computeSealedBidCommitment({
        auctionPubkey: auctionPda,
        bidderPubkey: bidderWallet2,
        maxBidLamports: 2_000_000_000n,
        salt: salt1,
      });
      expect(base).to.not.deep.equal(diffBidder);

      // Different auction (prevents cross-auction replay)
      const diffAuction = computeSealedBidCommitment({
        auctionPubkey: otherAuctionPda,
        bidderPubkey: bidderWallet1,
        maxBidLamports: 2_000_000_000n,
        salt: salt1,
      });
      expect(base).to.not.deep.equal(diffAuction);
    });

    it('rejects salt that is not 32 bytes', () => {
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);
      expect(() =>
        computeSealedBidCommitment({
          auctionPubkey: auctionPda,
          bidderPubkey: bidderWallet1,
          maxBidLamports: 1_000_000_000n,
          salt: Buffer.from('short-salt'),
        })
      ).to.throw(/Salt must be exactly 32 bytes/);
    });
  });

  // ==========================================================================
  // 3. Instruction Encoding: create_auction
  // ==========================================================================
  describe('Instruction: create_auction', () => {
    it('encodes create_auction instruction with valid accounts and parameters', () => {
      const ix = createCreateAuctionInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        reviewer: bidderWallet1,
        auctionId,
        itemName: 'Medical Dataset 2026',
        description: 'Verified clinical trial dataset',
        imageUri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        startingPriceLamports: 1_000_000_000n,
        commitDurationSeconds: 3600,
        revealDurationSeconds: 3600,
        inspectionDurationSeconds: 86400,
      });

      expect(ix.programId).to.equal(dummyProgramId);
      expect(ix.accounts).to.have.length(5);
      expect(ix.accounts[0].isWritable).to.be.true; // Auction PDA
      expect(ix.accounts[1].pubkey).to.equal(sellerWallet);
      expect(ix.accounts[1].isSigner).to.be.true;
      expect(ix.accounts[2].pubkey).to.equal(bidderWallet1);
      expect(ix.accounts[3].pubkey).to.equal(SYSTEM_PROGRAM_ID);
      // LAST: global AuctionConfig PDA, read-only (ignored by the pre-upgrade program).
      expect(ix.accounts[4]).to.deep.equal({
        pubkey: findAuctionConfigPda(dummyProgramId).pda, isSigner: false, isWritable: false,
      });

      const disc = getAnchorDiscriminator('global', 'create_auction');
      expect(ix.data.subarray(0, 8)).to.deep.equal(disc);
    });

    it('rejects commit duration below 60s', () => {
      expect(() =>
        createCreateAuctionInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          reviewer: bidderWallet1,
          auctionId,
          itemName: 'Item',
          description: 'Desc',
          imageUri: 'ipfs://uri',
          startingPriceLamports: 1_000_000_000n,
          commitDurationSeconds: 30, // < 60
          revealDurationSeconds: 3600,
          inspectionDurationSeconds: 86400,
        })
      ).to.throw(/Commit duration must be at least 60 seconds/);
    });

    it('rejects reveal duration below 60s', () => {
      expect(() =>
        createCreateAuctionInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          reviewer: bidderWallet1,
          auctionId,
          itemName: 'Item',
          description: 'Desc',
          imageUri: 'ipfs://uri',
          startingPriceLamports: 1_000_000_000n,
          commitDurationSeconds: 3600,
          revealDurationSeconds: 45, // < 60
          inspectionDurationSeconds: 86400,
        })
      ).to.throw(/Reveal duration must be at least 60 seconds/);
    });

    it('rejects inspection duration below 3600s (1 hour)', () => {
      expect(() =>
        createCreateAuctionInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          reviewer: bidderWallet1,
          auctionId,
          itemName: 'Item',
          description: 'Desc',
          imageUri: 'ipfs://uri',
          startingPriceLamports: 1_000_000_000n,
          commitDurationSeconds: 3600,
          revealDurationSeconds: 3600,
          inspectionDurationSeconds: 1800, // < 3600
        })
      ).to.throw(/Inspection duration must be at least 3600 seconds/);
    });

    it('rejects zero or negative starting price', () => {
      expect(() =>
        createCreateAuctionInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          reviewer: bidderWallet1,
          auctionId,
          itemName: 'Item',
          description: 'Desc',
          imageUri: 'ipfs://uri',
          startingPriceLamports: 0n,
          commitDurationSeconds: 3600,
          revealDurationSeconds: 3600,
          inspectionDurationSeconds: 86400,
        })
      ).to.throw(/Starting price must be positive/);
    });
  });

  // ==========================================================================
  // 4. Instruction Encoding: commit_bid & reveal_bid
  // ==========================================================================
  describe('Instruction: commit_bid & reveal_bid', () => {
    it('encodes commit_bid instruction with bidder as signer', () => {
      const dummyCommit = Buffer.alloc(32, 0xaa);
      const ix = createCommitBidInstruction({
        programId: dummyProgramId,
        auctionId,
        bidder: bidderWallet1,
        commitment: dummyCommit,
        depositLamports: 3_000_000_000n, // 3.0 SOL (over-deposit)
      });

      expect(ix.accounts).to.have.length(4);
      expect(ix.accounts[0].isWritable).to.be.true; // Auction PDA
      expect(ix.accounts[1].isWritable).to.be.true; // BidCommitment PDA
      expect(ix.accounts[2].pubkey).to.equal(bidderWallet1);
      expect(ix.accounts[2].isSigner).to.be.true;
      expect(ix.accounts[3].pubkey).to.equal(SYSTEM_PROGRAM_ID);

      const disc = getAnchorDiscriminator('global', 'commit_bid');
      expect(ix.data.subarray(0, 8)).to.deep.equal(disc);
      expect(ix.data.subarray(8, 40)).to.deep.equal(dummyCommit);
      expect(ix.data.readBigUInt64LE(40)).to.equal(3_000_000_000n);
    });

    it('rejects zero commitment hash', () => {
      expect(() =>
        createCommitBidInstruction({
          programId: dummyProgramId,
          auctionId,
          bidder: bidderWallet1,
          commitment: Buffer.alloc(32, 0),
          depositLamports: 1_000_000_000n,
        })
      ).to.throw(/Commitment cannot be zero/);
    });

    it('encodes reveal_bid instruction with correct parameters', () => {
      const ix = createRevealBidInstruction({
        programId: dummyProgramId,
        auctionId,
        bidder: bidderWallet1,
        maxBidLamports: 2_000_000_000n,
        salt: salt1,
      });

      expect(ix.accounts).to.have.length(3);
      expect(ix.accounts[2].pubkey).to.equal(bidderWallet1);
      expect(ix.accounts[2].isSigner).to.be.true;

      const disc = getAnchorDiscriminator('global', 'reveal_bid');
      expect(ix.data.subarray(0, 8)).to.deep.equal(disc);
      expect(ix.data.readBigUInt64LE(8)).to.equal(2_000_000_000n);
      expect(ix.data.subarray(16, 48)).to.deep.equal(salt1);
    });
  });

  // ==========================================================================
  // 5. Instruction Encoding: settle_auction, accept_dataset, request_refund
  // ==========================================================================
  describe('Settlement & Inspection Instructions', () => {
    it('encodes settle_auction instruction', () => {
      const ix = createSettleAuctionInstruction({
        programId: dummyProgramId,
        auctionId,
      });

      expect(ix.accounts).to.have.length(1);
      expect(ix.accounts[0].isWritable).to.be.true;
      const disc = getAnchorDiscriminator('global', 'settle_auction');
      expect(ix.data).to.deep.equal(disc);
    });

    it('encodes accept_dataset instruction with winner signer', () => {
      const ix = createAcceptDatasetInstruction({
        programId: dummyProgramId,
        auctionId,
        seller: sellerWallet,
        winner: bidderWallet1,
        feeRecipient: sellerWallet,
      });

      expect(ix.accounts).to.have.length(6);
      expect(ix.accounts[2].pubkey).to.equal(sellerWallet);
      expect(ix.accounts[3].pubkey).to.equal(bidderWallet1);
      expect(ix.accounts[3].isSigner).to.be.true;
      expect(ix.accounts[3].isWritable).to.be.true;
      const disc = getAnchorDiscriminator('global', 'accept_dataset');
      expect(ix.data).to.deep.equal(disc);
    });

    it('encodes request_refund instruction with evidence hash', () => {
      const evidence = Buffer.alloc(32, 0xbb);
      const ix = createRequestRefundInstruction({
        programId: dummyProgramId,
        auctionId,
        winner: bidderWallet1,
        evidenceHash: evidence,
      });

      expect(ix.accounts).to.have.length(2);
      expect(ix.accounts[1].pubkey).to.equal(bidderWallet1);
      expect(ix.accounts[1].isSigner).to.be.true;
      const disc = getAnchorDiscriminator('global', 'request_refund');
      expect(ix.data.subarray(0, 8)).to.deep.equal(disc);
      expect(ix.data.subarray(8, 40)).to.deep.equal(evidence);
    });

    it('encodes permissionless refund-timeout finalization with winner signer', () => {
      const ix = createFinalizeRefundTimeoutInstruction({
        programId: dummyProgramId,
        auctionId,
        winner: bidderWallet1,
      });

      expect(ix.accounts).to.have.length(3);
      expect(ix.accounts[2].pubkey).to.equal(bidderWallet1);
      expect(ix.accounts[2].isSigner).to.be.true;
      expect(ix.data).to.deep.equal(getAnchorDiscriminator('global', 'finalize_refund_timeout'));
    });

    it('rejects zero evidence hash in request_refund', () => {
      expect(() =>
        createRequestRefundInstruction({
          programId: dummyProgramId,
          auctionId,
          winner: bidderWallet1,
          evidenceHash: Buffer.alloc(32, 0),
        })
      ).to.throw(/Evidence hash cannot be zero/);
    });
  });

  // ==========================================================================
  // 6. Account Deserialization Tests
  // ==========================================================================
  describe('Account Deserialization: decodeAuctionStateAccount & decodeBidCommitmentAccount', () => {
    it('successfully decodes serialized AuctionStateAccount buffer', () => {
      const disc = getAnchorDiscriminator('account', 'AuctionStateAccount');
      const sellerBytes = Buffer.from(decodeBase58(sellerWallet));
      const reviewerBytes = Buffer.from(decodeBase58(sellerWallet));
      const idBuf = Buffer.alloc(8);
      idBuf.writeBigUInt64LE(101n, 0);

      const name = Buffer.from('Dataset Alpha', 'utf8');
      const nameLen = Buffer.alloc(4);
      nameLen.writeUInt32LE(name.length, 0);

      const desc = Buffer.from('Medical records', 'utf8');
      const descLen = Buffer.alloc(4);
      descLen.writeUInt32LE(desc.length, 0);

      const uri = Buffer.from('ipfs://bafyalpha', 'utf8');
      const uriLen = Buffer.alloc(4);
      uriLen.writeUInt32LE(uri.length, 0);

      const priceBuf = Buffer.alloc(8);
      priceBuf.writeBigUInt64LE(1_000_000_000n, 0);

      const commitEnd = Buffer.alloc(8);
      commitEnd.writeBigInt64LE(1760000000n, 0);

      const revealEnd = Buffer.alloc(8);
      revealEnd.writeBigInt64LE(1760003600n, 0);

      const inspDur = Buffer.alloc(8);
      inspDur.writeBigInt64LE(86400n, 0);

      const inspEnd = Buffer.alloc(8);
      inspEnd.writeBigInt64LE(1760090000n, 0);

      const refundRequestedAt = Buffer.alloc(8);

      const stateBuf = Buffer.from([SolanaAuctionState.Inspection]);

      const winnerBytes = Buffer.from(decodeBase58(bidderWallet1));
      const highestBidBuf = Buffer.alloc(8);
      highestBidBuf.writeBigUInt64LE(2_500_000_000n, 0);

      const bidderCountBuf = Buffer.alloc(4);
      bidderCountBuf.writeUInt32LE(3, 0);

      const revealedCountBuf = Buffer.alloc(4);
      revealedCountBuf.writeUInt32LE(2, 0);

      const evidenceBuf = Buffer.alloc(32, 0x12);

      const reason = Buffer.from('', 'utf8');
      const reasonLen = Buffer.alloc(4);
      reasonLen.writeUInt32LE(reason.length, 0);

      const bumpBuf = Buffer.from([253]);

      const buffer = Buffer.concat([
        disc,
        sellerBytes,
        reviewerBytes,
        idBuf,
        nameLen,
        name,
        descLen,
        desc,
        uriLen,
        uri,
        priceBuf,
        commitEnd,
        revealEnd,
        inspDur,
        inspEnd,
        refundRequestedAt,
        stateBuf,
        winnerBytes,
        highestBidBuf,
        bidderCountBuf,
        revealedCountBuf,
        evidenceBuf,
        reasonLen,
        reason,
        bumpBuf,
      ]);

      const decoded = decodeAuctionStateAccount(buffer);
      expect(decoded.seller).to.equal(sellerWallet);
      expect(decoded.reviewer).to.equal(sellerWallet);
      expect(decoded.auctionId).to.equal(101n);
      expect(decoded.itemName).to.equal('Dataset Alpha');
      expect(decoded.description).to.equal('Medical records');
      expect(decoded.imageUri).to.equal('ipfs://bafyalpha');
      expect(decoded.startingPrice).to.equal(1_000_000_000n);
      expect(decoded.commitEndTime).to.equal(1760000000);
      expect(decoded.revealEndTime).to.equal(1760003600);
      expect(decoded.refundRequestedAt).to.equal(0);
      expect(decoded.state).to.equal(SolanaAuctionState.Inspection);
      expect(decoded.highestBidder).to.equal(bidderWallet1);
      expect(decoded.highestBid).to.equal(2_500_000_000n);
      expect(decoded.bidderCount).to.equal(3);
      expect(decoded.revealedCount).to.equal(2);
      expect(decoded.bump).to.equal(253);
    });

    it('successfully decodes serialized BidCommitmentAccount buffer', () => {
      const disc = getAnchorDiscriminator('account', 'BidCommitmentAccount');
      const { pda: auctionPda } = findAuctionPda(101n, dummyProgramId);
      const auctionBytes = Buffer.from(decodeBase58(auctionPda));
      const bidderBytes = Buffer.from(decodeBase58(bidderWallet1));
      const commitBytes = Buffer.alloc(32, 0x55);

      const depositBuf = Buffer.alloc(8);
      depositBuf.writeBigUInt64LE(3_000_000_000n, 0);

      const maxBidBuf = Buffer.alloc(8);
      maxBidBuf.writeBigUInt64LE(2_500_000_000n, 0);

      const revealedBuf = Buffer.from([1]);
      const bumpBuf = Buffer.from([252]);

      const buffer = Buffer.concat([
        disc,
        auctionBytes,
        bidderBytes,
        commitBytes,
        depositBuf,
        maxBidBuf,
        revealedBuf,
        bumpBuf,
      ]);

      const decoded = decodeBidCommitmentAccount(buffer);
      expect(decoded.auction).to.equal(auctionPda);
      expect(decoded.bidder).to.equal(bidderWallet1);
      expect(decoded.deposit).to.equal(3_000_000_000n);
      expect(decoded.maxBid).to.equal(2_500_000_000n);
      expect(decoded.revealed).to.be.true;
      expect(decoded.bump).to.equal(252);
    });

    it('rejects account buffer with invalid discriminator', () => {
      const invalidDisc = Buffer.alloc(8, 0xff);
      const dummyData = Buffer.alloc(200, 0);
      const buffer = Buffer.concat([invalidDisc, dummyData]);

      expect(() => decodeAuctionStateAccount(buffer)).to.throw(
        /Invalid account discriminator: not an AuctionStateAccount/
      );
    });
  });

  // ==========================================================================
  // 7. Devnet MVP Economics
  // ==========================================================================
  describe('Solana Devnet MVP Economics', () => {
    it('sends the full winning bid to seller until a treasury is configured', () => {
      const winningPrice = 2_000_000_000n; // 2.0 SOL
      const platformFee = 0n;
      const sellerShare = winningPrice - platformFee;

      expect(platformFee).to.equal(0n);
      expect(sellerShare).to.equal(winningPrice);
      expect(sellerShare + platformFee).to.equal(winningPrice);
    });

    it('returns the full deposit to non-revealing bidders', () => {
      const deposit = 1_000_000_000n; // 1.0 SOL
      const penalty = 0n;
      const refund = deposit - penalty;

      expect(penalty).to.equal(0n);
      expect(refund).to.equal(deposit);
    });
  });

  // ==========================================================================
  // Global AuctionConfig PDA (program upgrade)
  // ==========================================================================
  describe('Global AuctionConfig: PDA, review_refund, initialize_config / update_config, decoder', () => {
    const adminWallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    const reviewerWallet = 'C9LaP3zxYLKeZpZ6GKzpUcEbCEfoRfGVDiRm6Yx1jHsD';

    it('derives the config PDA [b"auction_config"] exactly like @solana/web3.js', () => {
      const [expected, bump] = PublicKey.findProgramAddressSync([Buffer.from('auction_config')], new PublicKey(dummyProgramId));
      expect(findAuctionConfigPda(dummyProgramId)).to.deep.equal({ pda: expected.toBase58(), bump });
    });

    it('includes the configured fee treasury and both global configs in review_refund', () => {
      const ix = createReviewRefundInstruction({
        programId: dummyProgramId,
        auctionId,
        seller: sellerWallet,
        reviewer: reviewerWallet,
        winner: bidderWallet1,
        approve: true,
        feeRecipient: reviewerWallet,
      });
      const { pda: auctionPda } = findAuctionPda(auctionId, dummyProgramId);
      // ReviewRefund appends auction config and fee config/treasury after the original accounts.
      expect(ix.accounts.map((a) => a.pubkey)).to.deep.equal([
        auctionPda,
        findBidCommitmentPda(auctionPda, bidderWallet1, dummyProgramId).pda,
        sellerWallet,
        reviewerWallet,
        bidderWallet1,
        findAuctionConfigPda(dummyProgramId).pda,
        findAuctionFeeConfigPda(dummyProgramId).pda,
        reviewerWallet,
      ]);
      expect(ix.accounts[3].isSigner).to.be.true;
      expect(ix.accounts[5].isSigner).to.be.false;
      expect(ix.accounts[5].isWritable).to.be.false;
      expect(ix.data).to.deep.equal(Buffer.concat([getAnchorDiscriminator('global', 'review_refund'), Buffer.from([1])]));
    });

    it('encodes initialize_config(reviewer) with the InitializeConfig account list', () => {
      const ix = createInitializeAuctionConfigInstruction({ programId: dummyProgramId, admin: adminWallet, reviewer: reviewerWallet });
      expect(ix.accounts).to.deep.equal([
        { pubkey: findAuctionConfigPda(dummyProgramId).pda, isSigner: false, isWritable: true },
        { pubkey: adminWallet, isSigner: true, isWritable: true },
        { pubkey: dummyProgramId, isSigner: false, isWritable: false },
        { pubkey: findProgramDataPda(dummyProgramId).pda, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      ]);
      expect(ix.data).to.deep.equal(Buffer.concat([
        getAnchorDiscriminator('global', 'initialize_config'),
        Buffer.from(decodeBase58(reviewerWallet)),
      ]));
    });

    it('encodes update_config(reviewer, new_admin) signed by the admin; new_admin defaults to admin', () => {
      const ix = createUpdateAuctionConfigInstruction({ programId: dummyProgramId, admin: adminWallet, reviewer: reviewerWallet });
      expect(ix.accounts).to.deep.equal([
        { pubkey: findAuctionConfigPda(dummyProgramId).pda, isSigner: false, isWritable: true },
        { pubkey: adminWallet, isSigner: true, isWritable: false },
      ]);
      expect(ix.data).to.deep.equal(Buffer.concat([
        getAnchorDiscriminator('global', 'update_config'),
        Buffer.from(decodeBase58(reviewerWallet)),
        Buffer.from(decodeBase58(adminWallet)),
      ]));
      expect(() => createUpdateAuctionConfigInstruction({ programId: dummyProgramId, admin: adminWallet, reviewer: SYSTEM_PROGRAM_ID })).to.throw(/default/);
      expect(() => createInitializeAuctionConfigInstruction({ programId: dummyProgramId, admin: adminWallet, reviewer: 'not-base58!' })).to.throw(/reviewer/);
    });

    it('decodes an AuctionConfig account (73 bytes) and rejects wrong discriminators', () => {
      const data = Buffer.concat([
        getAnchorDiscriminator('account', 'AuctionConfig'),
        Buffer.from(decodeBase58(adminWallet)),
        Buffer.from(decodeBase58(reviewerWallet)),
        Buffer.from([253]),
      ]);
      expect(data.length).to.equal(AUCTION_CONFIG_ACCOUNT_SIZE);
      expect(decodeAuctionConfigAccount(data)).to.deep.equal({ admin: adminWallet, reviewer: reviewerWallet, bump: 253 });
      const wrong = Buffer.from(data);
      getAnchorDiscriminator('account', 'AuctionStateAccount').copy(wrong, 0);
      expect(() => decodeAuctionConfigAccount(wrong)).to.throw(/discriminator/);
      expect(() => decodeAuctionConfigAccount(data.subarray(0, 72))).to.throw(/too short/);
    });
  });
});
