import { expect } from 'chai';
import crypto from 'crypto';
import {
  findEscrowOrderPda,
  findVaultPda,
  createDepositServiceOrderInstruction,
  createSubmitDeliveryInstruction,
  createReleaseFundsInstruction,
  createCancelOrRefundInstruction,
  createDisputeOrderInstruction,
  createResolveDisputeInstruction,
  decodeEscrowOrderAccount,
  decodeEscrowConfigAccount,
  findEscrowConfigPda,
  createInitializeEscrowConfigInstruction,
  createUpdateEscrowConfigInstruction,
  ESCROW_CONFIG_ACCOUNT_SIZE,
  calculateSolanaServicePayouts,
  DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID,
  ESCROW_SEED,
  VAULT_SEED,
  MAX_DELIVERABLE_REF_LEN,
  MAX_FEE_BPS,
} from '../lib/cross-chain/solanaServiceEscrow';
import {
  encodeBase58,
  decodeBase58,
  normalizeBytes32,
  getAnchorDiscriminator,
  SYSTEM_PROGRAM_ID,
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  findProgramDataPda,
} from '../lib/cross-chain/solanaServiceRegistry';
import { PublicKey } from '@solana/web3.js';

describe('VEILIO Phase 4 — Solana Services Escrow Program & Client Suite', () => {
  const dummyProgramId = DEFAULT_SOLANA_SERVICE_ESCROW_PROGRAM_ID;
  const buyerWallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const sellerWallet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  const reviewerWallet = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  const feeRecipientWallet = '8r2DqTqV8bZ5bN9V1eJ2fH4kX6y3b8z5bN9V1eJ2fH4k';

  const validOrderIdHex = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const validOrderIdBytes = Buffer.from('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'hex');

  // ==========================================================================
  // 1. PDA Derivation Tests
  // ==========================================================================
  describe('PDA Derivation', () => {
    it('deterministically derives EscrowOrder PDA and Vault PDA from orderId', () => {
      const escrowPda1 = findEscrowOrderPda(validOrderIdHex, dummyProgramId);
      const escrowPda2 = findEscrowOrderPda(validOrderIdBytes, dummyProgramId);
      expect(escrowPda1.pda).to.equal(escrowPda2.pda);
      expect(escrowPda1.bump).to.equal(escrowPda2.bump);

      const vaultPda1 = findVaultPda(validOrderIdHex, dummyProgramId);
      const vaultPda2 = findVaultPda(validOrderIdBytes, dummyProgramId);
      expect(vaultPda1.pda).to.equal(vaultPda2.pda);
      expect(vaultPda1.bump).to.equal(vaultPda2.bump);

      // Escrow PDA and Vault PDA must be distinct addresses
      expect(escrowPda1.pda).to.not.equal(vaultPda1.pda);
    });

    it('produces distinct PDAs for different order IDs', () => {
      const otherOrderId = '0x9999999999999999999999999999999999999999999999999999999999999999';
      const res1 = findEscrowOrderPda(validOrderIdHex, dummyProgramId);
      const res2 = findEscrowOrderPda(otherOrderId, dummyProgramId);
      expect(res1.pda).to.not.equal(res2.pda);
    });
  });

  // ==========================================================================
  // 2. Instruction Serialization: deposit
  // ==========================================================================
  describe('Instruction: deposit', () => {
    it('encodes deposit instruction with correct accounts and data buffer', () => {
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      const amountLamports = 100_000_000n; // 0.1 SOL

      const ix = createDepositServiceOrderInstruction({
        programId: dummyProgramId,
        buyer: buyerWallet,
        seller: sellerWallet,
        reviewer: reviewerWallet,
        feeRecipient: feeRecipientWallet,
        orderId: validOrderIdHex,
        amountLamports,
        deadline,
      });

      expect(ix.programId).to.equal(dummyProgramId);
      expect(ix.keys).to.have.length(5);

      // Account 0: escrow_order (PDA, writable, not signer)
      expect(ix.keys[0].isWritable).to.be.true;
      expect(ix.keys[0].isSigner).to.be.false;

      // Account 1: vault (PDA, writable, not signer)
      expect(ix.keys[1].isWritable).to.be.true;
      expect(ix.keys[1].isSigner).to.be.false;

      // Account 2: buyer (signer, writable)
      expect(ix.keys[2].pubkey).to.equal(buyerWallet);
      expect(ix.keys[2].isSigner).to.be.true;
      expect(ix.keys[2].isWritable).to.be.true;

      // Account 3: system_program
      expect(ix.keys[3].pubkey).to.equal(SYSTEM_PROGRAM_ID);

      // Account 4 (LAST): global EscrowConfig PDA, read-only, not a signer. The upgraded program
      // requires it; the pre-upgrade program only reads accounts 0-3 and ignores it.
      expect(ix.keys[4].pubkey).to.equal(findEscrowConfigPda(dummyProgramId).pda);
      expect(ix.keys[4].isSigner).to.be.false;
      expect(ix.keys[4].isWritable).to.be.false;

      // Verify instruction discriminator
      const expectedDiscriminator = getAnchorDiscriminator('global', 'deposit');
      expect(Buffer.from(ix.data.subarray(0, 8))).to.deep.equal(expectedDiscriminator);
    });

    it('rejects deposit when buyer is the seller', () => {
      expect(() =>
        createDepositServiceOrderInstruction({
          programId: dummyProgramId,
          buyer: buyerWallet,
          seller: buyerWallet,
          reviewer: reviewerWallet,
          feeRecipient: feeRecipientWallet,
          orderId: validOrderIdHex,
          amountLamports: 100_000_000n,
          deadline: Math.floor(Date.now() / 1000) + 3600,
        })
      ).to.throw('Buyer cannot be seller');
    });

    it('rejects zero or negative deposit amount', () => {
      expect(() =>
        createDepositServiceOrderInstruction({
          programId: dummyProgramId,
          buyer: buyerWallet,
          seller: sellerWallet,
          reviewer: reviewerWallet,
          feeRecipient: feeRecipientWallet,
          orderId: validOrderIdHex,
          amountLamports: 0n,
          deadline: Math.floor(Date.now() / 1000) + 3600,
        })
      ).to.throw('Deposit amount must be greater than zero');
    });
  });

  // ==========================================================================
  // 3. Instruction Serialization: submit_delivery
  // ==========================================================================
  describe('Instruction: submit_delivery', () => {
    it('encodes submit_delivery instruction with seller signer', () => {
      const deliverableRef = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const ix = createSubmitDeliveryInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        orderId: validOrderIdHex,
        deliverableReference: deliverableRef,
      });

      expect(ix.keys).to.have.length(2);
      expect(ix.keys[1].pubkey).to.equal(sellerWallet);
      expect(ix.keys[1].isSigner).to.be.true;

      const disc = getAnchorDiscriminator('global', 'submit_delivery');
      expect(Buffer.from(ix.data.subarray(0, 8))).to.deep.equal(disc);
    });

    it('rejects empty deliverable reference', () => {
      expect(() =>
        createSubmitDeliveryInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          orderId: validOrderIdHex,
          deliverableReference: '   ',
        })
      ).to.throw('Deliverable reference cannot be empty');
    });
  });

  // ==========================================================================
  // 4. Instruction Serialization: release_funds
  // ==========================================================================
  describe('Instruction: release_funds', () => {
    it('encodes release_funds instruction with buyer signer and seller/feeRecipient destinations', () => {
      const ix = createReleaseFundsInstruction({
        programId: dummyProgramId,
        buyer: buyerWallet,
        seller: sellerWallet,
        feeRecipient: feeRecipientWallet,
        orderId: validOrderIdHex,
      });

      expect(ix.keys).to.have.length(6);
      expect(ix.keys[2].pubkey).to.equal(buyerWallet);
      expect(ix.keys[2].isSigner).to.be.true; // Buyer must sign to approve
      expect(ix.keys[3].pubkey).to.equal(sellerWallet);
      expect(ix.keys[3].isWritable).to.be.true;
      expect(ix.keys[4].pubkey).to.equal(feeRecipientWallet);
      expect(ix.keys[4].isWritable).to.be.true;
      expect(ix.keys[5].pubkey).to.equal(SYSTEM_PROGRAM_ID);
      expect(ix.keys[5].isWritable).to.be.false;

      const disc = getAnchorDiscriminator('global', 'release_funds');
      expect(Buffer.from(ix.data)).to.deep.equal(disc);
    });
  });

  // ==========================================================================
  // 5. Instruction Serialization: cancel_or_refund, dispute & resolve_dispute
  // ==========================================================================
  describe('Instructions: cancel_or_refund, dispute & resolve_dispute', () => {
    it('encodes cancel_or_refund instruction targeting buyer for 100% refund', () => {
      const ix = createCancelOrRefundInstruction({
        programId: dummyProgramId,
        caller: sellerWallet,
        buyer: buyerWallet,
        orderId: validOrderIdHex,
        reason: 'Seller unable to deliver on time',
      });

      expect(ix.keys).to.have.length(5);
      expect(ix.keys[2].pubkey).to.equal(sellerWallet);
      expect(ix.keys[2].isSigner).to.be.true;
      expect(ix.keys[3].pubkey).to.equal(buyerWallet);
      expect(ix.keys[3].isWritable).to.be.true;
      expect(ix.keys[4].pubkey).to.equal(SYSTEM_PROGRAM_ID);
      expect(ix.keys[4].isWritable).to.be.false;
    });

    it('encodes dispute instruction with caller signer', () => {
      const ix = createDisputeOrderInstruction({
        programId: dummyProgramId,
        caller: buyerWallet,
        orderId: validOrderIdHex,
        reason: 'Quality does not match scope',
      });

      expect(ix.keys).to.have.length(2);
      expect(ix.keys[1].pubkey).to.equal(buyerWallet);
      expect(ix.keys[1].isSigner).to.be.true;
    });

    it('encodes resolve_dispute instruction with reviewer signer and split percentage', () => {
      const ix = createResolveDisputeInstruction({
        programId: dummyProgramId,
        reviewer: reviewerWallet,
        buyer: buyerWallet,
        seller: sellerWallet,
        feeRecipient: feeRecipientWallet,
        orderId: validOrderIdHex,
        splitToBuyerPercent: 70, // 70% to buyer, 30% to seller
      });

      expect(ix.keys).to.have.length(8);
      expect(ix.keys[2].pubkey).to.equal(reviewerWallet);
      expect(ix.keys[2].isSigner).to.be.true;
      expect(ix.keys[6].pubkey).to.equal(SYSTEM_PROGRAM_ID);
      expect(ix.keys[6].isWritable).to.be.false;
      // Trailing read-only config PDA (after every account the pre-upgrade program expects).
      expect(ix.keys[7].pubkey).to.equal(findEscrowConfigPda(dummyProgramId).pda);
      expect(ix.keys[7].isSigner).to.be.false;
      expect(ix.keys[7].isWritable).to.be.false;

      const disc = getAnchorDiscriminator('global', 'resolve_dispute');
      expect(Buffer.from(ix.data.subarray(0, 8))).to.deep.equal(disc);
      expect(ix.data[8]).to.equal(70);
    });

    it('rejects invalid split percentage > 100 or < 0', () => {
      expect(() =>
        createResolveDisputeInstruction({
          programId: dummyProgramId,
          reviewer: reviewerWallet,
          buyer: buyerWallet,
          seller: sellerWallet,
          feeRecipient: feeRecipientWallet,
          orderId: validOrderIdHex,
          splitToBuyerPercent: 101,
        })
      ).to.throw('Split percentage must be between 0 and 100');
    });
  });

  // ==========================================================================
  // 6. Account Deserialization: decodeEscrowOrderAccount
  // ==========================================================================
  describe('Account Deserializer: decodeEscrowOrderAccount', () => {
    function buildMockEscrowAccountBuffer(statusVal = 1, amount = 1_000_000_000n): Buffer {
      const disc = getAnchorDiscriminator('account', 'EscrowOrder');
      const buyerBytes = Buffer.from(decodeBase58(buyerWallet));
      const sellerBytes = Buffer.from(decodeBase58(sellerWallet));
      const reviewerBytes = Buffer.from(decodeBase58(reviewerWallet));
      const feeRecipientBytes = Buffer.from(decodeBase58(feeRecipientWallet));
      const orderIdBytes = validOrderIdBytes;

      const amountBuf = Buffer.alloc(8);
      amountBuf.writeBigUInt64LE(amount);

      const feeBpsBuf = Buffer.alloc(2);
      feeBpsBuf.writeUInt16LE(500);

      const deadlineBuf = Buffer.alloc(8);
      deadlineBuf.writeBigInt64LE(1775550000n);

      const statusBuf = Buffer.from([statusVal]);

      const createdAtBuf = Buffer.alloc(8);
      createdAtBuf.writeBigInt64LE(1775500000n);

      const settledAtBuf = Buffer.alloc(8);
      settledAtBuf.writeBigInt64LE(0n);

      const refStr = 'ipfs://mockcid';
      const refLenBuf = Buffer.alloc(4);
      refLenBuf.writeUInt32LE(refStr.length);
      const refBuf = Buffer.from(refStr, 'utf8');

      const bumpBuf = Buffer.from([254]);
      const vaultBumpBuf = Buffer.from([253]);

      return Buffer.concat([
        disc,
        buyerBytes,
        sellerBytes,
        reviewerBytes,
        feeRecipientBytes,
        orderIdBytes,
        amountBuf,
        feeBpsBuf,
        deadlineBuf,
        statusBuf,
        createdAtBuf,
        settledAtBuf,
        refLenBuf,
        refBuf,
        bumpBuf,
        vaultBumpBuf,
      ]);
    }

    it('correctly decodes serialized EscrowOrder account buffer', () => {
      const mockBuf = buildMockEscrowAccountBuffer(1, 1_000_000_000n); // 1 SOL
      const decoded = decodeEscrowOrderAccount(mockBuf);

      expect(decoded.buyer).to.equal(buyerWallet);
      expect(decoded.seller).to.equal(sellerWallet);
      expect(decoded.reviewer).to.equal(reviewerWallet);
      expect(decoded.feeRecipient).to.equal(feeRecipientWallet);
      expect(decoded.orderIdHex).to.equal(validOrderIdHex);
      expect(decoded.amountLamports).to.equal(1_000_000_000n);
      expect(decoded.amountSol).to.equal('1.0000');
      expect(decoded.feeBasisPoints).to.equal(500);
      expect(decoded.status).to.equal('Funded');
      expect(decoded.deliverableReference).to.equal('ipfs://mockcid');
      expect(decoded.bump).to.equal(254);
      expect(decoded.vaultBump).to.equal(253);
    });

    it('rejects account buffer with invalid discriminator', () => {
      const badBuf = buildMockEscrowAccountBuffer();
      badBuf[0] = 0xff; // corrupt discriminator
      expect(() => decodeEscrowOrderAccount(badBuf)).to.throw('Invalid account discriminator');
    });

    it('rejects truncated account buffer', () => {
      const truncated = Buffer.alloc(32);
      expect(() => decodeEscrowOrderAccount(truncated)).to.throw('Truncated account buffer');
    });
  });

  // ==========================================================================
  // 7. Exact 5% Platform Fee & Multi-Chain Accounting Parity
  // ==========================================================================
  describe('Fee Calculation Parity (SEC-FEE-01)', () => {
    it('calculates exact 5% platform fee on 100% seller release (0.1 SOL = 100,000,000 lamports)', () => {
      const totalLamports = 100_000_000n; // 0.1 SOL
      const payouts = calculateSolanaServicePayouts(totalLamports, 0, 500);

      expect(payouts.buyerRefundLamports).to.equal(0n);
      expect(payouts.sellerGrossLamports).to.equal(100_000_000n);
      expect(payouts.platformFeeLamports).to.equal(5_000_000n); // 0.005 SOL (exact 5%)
      expect(payouts.sellerNetPayoutLamports).to.equal(95_000_000n); // 0.095 SOL (exact 95%)
      expect(payouts.platformFeeLamports + payouts.sellerNetPayoutLamports).to.equal(totalLamports);
    });

    it('calculates 100% fee-free refund for buyer on cancellation or timeout', () => {
      const totalLamports = 250_000_000n; // 0.25 SOL
      const payouts = calculateSolanaServicePayouts(totalLamports, 100, 500);

      expect(payouts.buyerRefundLamports).to.equal(250_000_000n);
      expect(payouts.sellerGrossLamports).to.equal(0n);
      expect(payouts.platformFeeLamports).to.equal(0n); // Fee is 0 on refund
      expect(payouts.sellerNetPayoutLamports).to.equal(0n);
    });

    it('calculates dispute split: fee applies strictly to seller gross payout', () => {
      const totalLamports = 1_000_000_000n; // 1 SOL
      // 60% buyer refund, 40% seller gross award
      const payouts = calculateSolanaServicePayouts(totalLamports, 60, 500);

      expect(payouts.buyerRefundLamports).to.equal(600_000_000n); // 0.6 SOL fee-free
      expect(payouts.sellerGrossLamports).to.equal(400_000_000n); // 0.4 SOL gross
      expect(payouts.platformFeeLamports).to.equal(20_000_000n);  // 0.02 SOL (5% of 0.4 SOL)
      expect(payouts.sellerNetPayoutLamports).to.equal(380_000_000n); // 0.38 SOL net
      expect(payouts.buyerRefundLamports + payouts.platformFeeLamports + payouts.sellerNetPayoutLamports).to.equal(totalLamports);
    });
  });

  // ==========================================================================
  // Global EscrowConfig PDA (program upgrade)
  // ==========================================================================
  describe('Global EscrowConfig: PDA, initialize_config / update_config, decoder', () => {
    const adminWallet = '4fYNw3dojWmQ4dXtSGE9epjRGy9pFSVa62YMMnk58rTQ';
    const feeWallet = 'C9LaP3zxYLKeZpZ6GKzpUcEbCEfoRfGVDiRm6Yx1jHsD';

    it('derives the config PDA [b"escrow_config"] and ProgramData PDA exactly like @solana/web3.js', () => {
      const [expectedConfig, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('escrow_config')],
        new PublicKey(dummyProgramId)
      );
      const config = findEscrowConfigPda(dummyProgramId);
      expect(config.pda).to.equal(expectedConfig.toBase58());
      expect(config.bump).to.equal(bump);

      const [expectedProgramData] = PublicKey.findProgramAddressSync(
        [new PublicKey(dummyProgramId).toBuffer()],
        new PublicKey(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)
      );
      expect(findProgramDataPda(dummyProgramId).pda).to.equal(expectedProgramData.toBase58());
    });

    it('encodes initialize_config(reviewer, fee_recipient, fee_bps) with the InitializeConfig account list', () => {
      const ix = createInitializeEscrowConfigInstruction({
        programId: dummyProgramId,
        admin: adminWallet,
        reviewer: reviewerWallet,
        feeRecipient: feeWallet,
        feeBasisPoints: 500,
      });
      expect(ix.keys).to.deep.equal(ix.accounts);
      expect(ix.accounts.map((a) => a.pubkey)).to.deep.equal([
        findEscrowConfigPda(dummyProgramId).pda,
        adminWallet,
        dummyProgramId,
        findProgramDataPda(dummyProgramId).pda,
        SYSTEM_PROGRAM_ID,
      ]);
      expect(ix.accounts.map((a) => [a.isSigner, a.isWritable])).to.deep.equal([
        [false, true], [true, true], [false, false], [false, false], [false, false],
      ]);
      expect(ix.data.length).to.equal(8 + 32 + 32 + 2);
      expect(ix.data.subarray(0, 8)).to.deep.equal(getAnchorDiscriminator('global', 'initialize_config'));
      expect(encodeBase58(ix.data.subarray(8, 40))).to.equal(reviewerWallet);
      expect(encodeBase58(ix.data.subarray(40, 72))).to.equal(feeWallet);
      expect(ix.data.readUInt16LE(72)).to.equal(500);
    });

    it('encodes update_config(reviewer, fee_recipient, fee_bps, new_admin) signed by the admin', () => {
      const ix = createUpdateEscrowConfigInstruction({
        programId: dummyProgramId,
        admin: adminWallet,
        reviewer: reviewerWallet,
        feeRecipient: feeWallet,
        feeBasisPoints: 250,
      });
      expect(ix.accounts).to.deep.equal([
        { pubkey: findEscrowConfigPda(dummyProgramId).pda, isSigner: false, isWritable: true },
        { pubkey: adminWallet, isSigner: true, isWritable: false },
      ]);
      expect(ix.data.length).to.equal(8 + 32 + 32 + 2 + 32);
      expect(ix.data.subarray(0, 8)).to.deep.equal(getAnchorDiscriminator('global', 'update_config'));
      expect(ix.data.readUInt16LE(72)).to.equal(250);
      // new_admin defaults to the current admin (no hand-over)
      expect(encodeBase58(ix.data.subarray(74, 106))).to.equal(adminWallet);

      const handOver = createUpdateEscrowConfigInstruction({
        programId: dummyProgramId, admin: adminWallet, reviewer: reviewerWallet, feeRecipient: feeWallet,
        feeBasisPoints: 250, newAdmin: sellerWallet,
      });
      expect(encodeBase58(handOver.data.subarray(74, 106))).to.equal(sellerWallet);
    });

    it('rejects fee bps above the 5% cap, non-integers, and default / malformed keys', () => {
      const base = { programId: dummyProgramId, admin: adminWallet, reviewer: reviewerWallet, feeRecipient: feeWallet };
      expect(() => createInitializeEscrowConfigInstruction({ ...base, feeBasisPoints: MAX_FEE_BPS + 1 })).to.throw(/between 0 and 500/);
      expect(() => createInitializeEscrowConfigInstruction({ ...base, feeBasisPoints: 1.5 })).to.throw(/integer/);
      expect(() => createInitializeEscrowConfigInstruction({ ...base, feeBasisPoints: -1 })).to.throw();
      expect(() => createInitializeEscrowConfigInstruction({ ...base, reviewer: SYSTEM_PROGRAM_ID, feeBasisPoints: 500 })).to.throw(/default/);
      expect(() => createInitializeEscrowConfigInstruction({ ...base, feeRecipient: 'abc', feeBasisPoints: 500 })).to.throw(/fee recipient/);
      expect(() => createUpdateEscrowConfigInstruction({ ...base, feeBasisPoints: 500, newAdmin: SYSTEM_PROGRAM_ID })).to.throw(/default/);
    });

    it('decodes an EscrowConfig account (107 bytes) and rejects wrong discriminators / truncation', () => {
      const fee = Buffer.alloc(2);
      fee.writeUInt16LE(300);
      const data = Buffer.concat([
        getAnchorDiscriminator('account', 'EscrowConfig'),
        Buffer.from(decodeBase58(adminWallet)),
        Buffer.from(decodeBase58(reviewerWallet)),
        Buffer.from(decodeBase58(feeWallet)),
        fee,
        Buffer.from([254]),
      ]);
      expect(data.length).to.equal(ESCROW_CONFIG_ACCOUNT_SIZE);
      expect(decodeEscrowConfigAccount(data)).to.deep.equal({
        admin: adminWallet, reviewer: reviewerWallet, feeRecipient: feeWallet, feeBasisPoints: 300, bump: 254,
      });
      const wrong = Buffer.from(data);
      getAnchorDiscriminator('account', 'EscrowOrder').copy(wrong, 0);
      expect(() => decodeEscrowConfigAccount(wrong)).to.throw(/discriminator/);
      expect(() => decodeEscrowConfigAccount(data.subarray(0, 100))).to.throw(/Truncated/);
    });

    it('keeps the pre-upgrade account prefix unchanged so the deployed program ignores the extra account', () => {
      const deposit = createDepositServiceOrderInstruction({
        programId: dummyProgramId, buyer: buyerWallet, seller: sellerWallet, reviewer: reviewerWallet,
        feeRecipient: feeRecipientWallet, orderId: validOrderIdHex, amountLamports: 1n, deadline: 2_000_000_000,
      });
      // Pre-upgrade DepositOrder: escrow_order, vault, buyer, system_program
      expect(deposit.keys!.slice(0, 4).map((k) => k.pubkey)).to.deep.equal([
        findEscrowOrderPda(validOrderIdHex, dummyProgramId).pda,
        findVaultPda(validOrderIdHex, dummyProgramId).pda,
        buyerWallet,
        SYSTEM_PROGRAM_ID,
      ]);
      const resolve = createResolveDisputeInstruction({
        programId: dummyProgramId, reviewer: reviewerWallet, buyer: buyerWallet, seller: sellerWallet,
        feeRecipient: feeRecipientWallet, orderId: validOrderIdHex, splitToBuyerPercent: 50,
      });
      // Pre-upgrade ResolveDispute: escrow_order, vault, reviewer, buyer, seller, fee_recipient, system_program
      expect(resolve.keys!.slice(1, 7).map((k) => k.pubkey)).to.deep.equal([
        findVaultPda(validOrderIdHex, dummyProgramId).pda,
        reviewerWallet, buyerWallet, sellerWallet, feeRecipientWallet, SYSTEM_PROGRAM_ID,
      ]);
    });
  });
});
