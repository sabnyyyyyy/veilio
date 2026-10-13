import { expect } from 'chai';
import crypto from 'crypto';
import {
  findServiceRecordPda,
  createRegisterServiceInstruction,
  createUpdateServiceMetadataInstruction,
  createSetServiceStatusInstruction,
  decodeServiceRecordAccount,
  getAnchorDiscriminator,
  encodeBase58,
  decodeBase58,
  normalizeBytes32,
  DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  MAX_METADATA_URI_LEN,
  type SolanaCompiledInstruction,
} from '../lib/cross-chain/solanaServiceRegistry';

describe('VEILIO Milestone 3 — Solana Service Registry Program & Client', () => {
  const dummyProgramId = DEFAULT_SOLANA_SERVICE_REGISTRY_PROGRAM_ID;
  const sellerWallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const attackerWallet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

  const validServiceIdHex = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const validServiceIdBytes = Buffer.from('1111111111111111111111111111111111111111111111111111111111111111', 'hex');
  const validMetadataHashHex = '0x2222222222222222222222222222222222222222222222222222222222222222';
  const validMetadataHashBytes = Buffer.from('2222222222222222222222222222222222222222222222222222222222222222', 'hex');
  const validMetadataUri = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

  // ==========================================================================
  // 1. Base58 & Bytes32 Utility Tests
  // ==========================================================================
  describe('Encoding & Utilities', () => {
    it('round-trips Base58 encoding and decoding', () => {
      const original = Buffer.from('VeilioSolanaServiceRegistry2026', 'utf8');
      const encoded = encodeBase58(original);
      const decoded = decodeBase58(encoded);
      expect(Buffer.from(decoded)).to.deep.equal(original);
    });

    it('correctly normalizes 32-byte hex strings and byte arrays', () => {
      const fromHex = normalizeBytes32(validServiceIdHex);
      const fromBytes = normalizeBytes32(validServiceIdBytes);
      expect(fromHex).to.deep.equal(validServiceIdBytes);
      expect(fromBytes).to.deep.equal(validServiceIdBytes);
    });

    it('rejects invalid length or malformed hex in normalizeBytes32', () => {
      expect(() => normalizeBytes32('0x1234')).to.throw(/Expected 32 bytes/);
      expect(() => normalizeBytes32(new Uint8Array(16))).to.throw(/Expected exactly 32 bytes/);
    });

    it('computes expected Anchor instruction and account discriminators', () => {
      const ixDisc = getAnchorDiscriminator('global', 'register_service');
      expect(ixDisc.length).to.equal(8);

      const accDisc = getAnchorDiscriminator('account', 'ServiceRecord');
      expect(accDisc.length).to.equal(8);

      // Verify deterministic SHA-256 derivation
      const manualPreimage = 'global:register_service';
      const manualHash = crypto.createHash('sha256').update(manualPreimage).digest().subarray(0, 8);
      expect(ixDisc).to.deep.equal(manualHash);
    });
  });

  // ==========================================================================
  // 2. PDA Derivation Tests
  // ==========================================================================
  describe('PDA Derivation', () => {
    it('deterministically derives PDA for a service record', () => {
      const res1 = findServiceRecordPda(validServiceIdHex, sellerWallet, dummyProgramId);
      const res2 = findServiceRecordPda(validServiceIdHex, sellerWallet, dummyProgramId);

      expect(res1.pda).to.equal(res2.pda);
      expect(res1.bump).to.equal(res2.bump);
      expect(res1.pda.length).to.be.greaterThanOrEqual(32);
    });

    it('produces distinct PDAs for different service IDs', () => {
      const otherServiceIdHex = '0x3333333333333333333333333333333333333333333333333333333333333333';
      const res1 = findServiceRecordPda(validServiceIdHex, sellerWallet, dummyProgramId);
      const res2 = findServiceRecordPda(otherServiceIdHex, sellerWallet, dummyProgramId);

      expect(res1.pda).to.not.equal(res2.pda);
    });
  });

  // ==========================================================================
  // 3. Instruction Encoding: register_service
  // ==========================================================================
  describe('Instruction: register_service', () => {
    it('encodes register_service instruction with correct accounts and data buffer', () => {
      const ix = createRegisterServiceInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        serviceId: validServiceIdHex,
        metadataHash: validMetadataHashHex,
        metadataUri: validMetadataUri,
      });

      expect(ix.programId).to.equal(dummyProgramId);
      expect(ix.accounts).to.have.length(3);

      // Account 0: PDA (writable, not signer)
      expect(ix.accounts[0].isWritable).to.be.true;
      expect(ix.accounts[0].isSigner).to.be.false;

      // Account 1: Seller (signer, writable)
      expect(ix.accounts[1].pubkey).to.equal(sellerWallet);
      expect(ix.accounts[1].isSigner).to.be.true;
      expect(ix.accounts[1].isWritable).to.be.true;

      // Account 2: System Program
      expect(ix.accounts[2].pubkey).to.equal(SYSTEM_PROGRAM_ID);
      expect(ix.accounts[2].isSigner).to.be.false;
      expect(ix.accounts[2].isWritable).to.be.false;

      // Check discriminator
      const expectedDisc = getAnchorDiscriminator('global', 'register_service');
      expect(ix.data.subarray(0, 8)).to.deep.equal(expectedDisc);

      // Check serialized service_id and metadata_hash
      expect(ix.data.subarray(8, 40)).to.deep.equal(validServiceIdBytes);
      expect(ix.data.subarray(40, 72)).to.deep.equal(validMetadataHashBytes);

      // Check serialized metadata_uri
      const uriLen = ix.data.readUInt32LE(72);
      expect(uriLen).to.equal(Buffer.from(validMetadataUri).length);
      const uri = ix.data.subarray(76, 76 + uriLen).toString('utf8');
      expect(uri).to.equal(validMetadataUri);
    });

    it('rejects zero service ID', () => {
      const zeroId = '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(() =>
        createRegisterServiceInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          serviceId: zeroId,
          metadataHash: validMetadataHashHex,
          metadataUri: validMetadataUri,
        })
      ).to.throw(/Invalid service ID: cannot be zero/);
    });

    it('rejects zero metadata hash', () => {
      const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(() =>
        createRegisterServiceInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          serviceId: validServiceIdHex,
          metadataHash: zeroHash,
          metadataUri: validMetadataUri,
        })
      ).to.throw(/Invalid metadata hash: cannot be zero/);
    });

    it('rejects empty or whitespace metadata URI', () => {
      expect(() =>
        createRegisterServiceInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          serviceId: validServiceIdHex,
          metadataHash: validMetadataHashHex,
          metadataUri: '',
        })
      ).to.throw(/Metadata URI required/);
    });

    it('rejects metadata URI exceeding maximum length (200 bytes)', () => {
      const overlongUri = 'https://example.com/' + 'a'.repeat(250);
      expect(() =>
        createRegisterServiceInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          serviceId: validServiceIdHex,
          metadataHash: validMetadataHashHex,
          metadataUri: overlongUri,
        })
      ).to.throw(/exceeds maximum length/);
    });
  });

  // ==========================================================================
  // 4. Instruction Encoding: update_service_metadata
  // ==========================================================================
  describe('Instruction: update_service_metadata', () => {
    it('encodes update_service_metadata instruction with authorized seller', () => {
      const newHash = '0x4444444444444444444444444444444444444444444444444444444444444444';
      const newUri = 'ipfs://bafybeic5y3s';

      const ix = createUpdateServiceMetadataInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        serviceId: validServiceIdHex,
        newMetadataHash: newHash,
        newMetadataUri: newUri,
      });

      expect(ix.accounts).to.have.length(2);
      expect(ix.accounts[0].isWritable).to.be.true; // PDA
      expect(ix.accounts[1].pubkey).to.equal(sellerWallet);
      expect(ix.accounts[1].isSigner).to.be.true;

      const expectedDisc = getAnchorDiscriminator('global', 'update_service_metadata');
      expect(ix.data.subarray(0, 8)).to.deep.equal(expectedDisc);
    });

    it('rejects zero new metadata hash', () => {
      const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
      expect(() =>
        createUpdateServiceMetadataInstruction({
          programId: dummyProgramId,
          seller: sellerWallet,
          serviceId: validServiceIdHex,
          newMetadataHash: zeroHash,
          newMetadataUri: 'ipfs://valid',
        })
      ).to.throw(/Invalid metadata hash: cannot be zero/);
    });
  });

  // ==========================================================================
  // 5. Instruction Encoding: set_service_status
  // ==========================================================================
  describe('Instruction: set_service_status', () => {
    it('encodes set_service_status instruction (deactivate)', () => {
      const ix = createSetServiceStatusInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        serviceId: validServiceIdHex,
        active: false,
      });

      expect(ix.accounts).to.have.length(2);
      expect(ix.accounts[1].pubkey).to.equal(sellerWallet);
      expect(ix.accounts[1].isSigner).to.be.true;

      const expectedDisc = getAnchorDiscriminator('global', 'set_service_status');
      expect(ix.data.subarray(0, 8)).to.deep.equal(expectedDisc);
      expect(ix.data.readUInt8(8)).to.equal(0);
    });

    it('encodes set_service_status instruction (activate)', () => {
      const ix = createSetServiceStatusInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        serviceId: validServiceIdHex,
        active: true,
      });

      expect(ix.data.readUInt8(8)).to.equal(1);
    });
  });

  // ==========================================================================
  // 6. Account Buffer Deserialization Tests
  // ==========================================================================
  describe('Account Deserializer: decodeServiceRecordAccount', () => {
    it('correctly decodes a serialized ServiceRecord account buffer', () => {
      const disc = getAnchorDiscriminator('account', 'ServiceRecord');
      const sellerBytes = Buffer.from(decodeBase58(sellerWallet));
      const serviceIdBytes = validServiceIdBytes;
      const metadataHashBytes = validMetadataHashBytes;
      const uriBytes = Buffer.from(validMetadataUri, 'utf8');
      const uriLenBuf = Buffer.alloc(4);
      uriLenBuf.writeUInt32LE(uriBytes.length, 0);

      const activeBuf = Buffer.from([1]);
      const registeredAtBuf = Buffer.alloc(8);
      registeredAtBuf.writeBigInt64LE(1760000000n, 0);
      const updatedAtBuf = Buffer.alloc(8);
      updatedAtBuf.writeBigInt64LE(1760001000n, 0);
      const bumpBuf = Buffer.from([254]);

      const buffer = Buffer.concat([
        disc,
        sellerBytes,
        serviceIdBytes,
        metadataHashBytes,
        uriLenBuf,
        uriBytes,
        activeBuf,
        registeredAtBuf,
        updatedAtBuf,
        bumpBuf,
      ]);

      const state = decodeServiceRecordAccount(buffer);
      expect(state.seller).to.equal(sellerWallet);
      expect(state.serviceId).to.equal(validServiceIdHex);
      expect(state.metadataHash).to.equal(validMetadataHashHex);
      expect(state.metadataUri).to.equal(validMetadataUri);
      expect(state.active).to.be.true;
      expect(state.registeredAt).to.equal(1760000000);
      expect(state.updatedAt).to.equal(1760001000);
      expect(state.bump).to.equal(254);
    });

    it('rejects account buffer with invalid discriminator', () => {
      const invalidDisc = Buffer.alloc(8, 0xff);
      const dummyData = Buffer.alloc(150, 0);
      const buffer = Buffer.concat([invalidDisc, dummyData]);

      expect(() => decodeServiceRecordAccount(buffer)).to.throw(
        /Invalid account discriminator: not a ServiceRecord account/
      );
    });

    it('rejects truncated account buffer', () => {
      const shortBuffer = Buffer.alloc(20);
      expect(() => decodeServiceRecordAccount(shortBuffer)).to.throw(
        /Account data buffer too short/
      );
    });
  });

  // ==========================================================================
  // 7. Security & Non-Custodial Invariants
  // ==========================================================================
  describe('Security & Invariants', () => {
    it('verifies instruction contains zero lamport transfers or token mint accounts', () => {
      const ix = createRegisterServiceInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        serviceId: validServiceIdHex,
        metadataHash: validMetadataHashHex,
        metadataUri: validMetadataUri,
      });

      // Exactly 3 accounts: PDA, Seller, SystemProgram
      expect(ix.accounts).to.have.length(3);
      const pubkeys = ix.accounts.map((a) => a.pubkey);
      expect(pubkeys).to.not.include('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      expect(pubkeys).to.not.include('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    });

    it('enforces seller signer constraint on all state modification instructions', () => {
      const updateIx = createUpdateServiceMetadataInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        serviceId: validServiceIdHex,
        newMetadataHash: validMetadataHashHex,
        newMetadataUri: validMetadataUri,
      });
      const sellerMeta = updateIx.accounts.find((a) => a.pubkey === sellerWallet);
      expect(sellerMeta?.isSigner).to.be.true;

      const statusIx = createSetServiceStatusInstruction({
        programId: dummyProgramId,
        seller: sellerWallet,
        serviceId: validServiceIdHex,
        active: false,
      });
      const statusSellerMeta = statusIx.accounts.find((a) => a.pubkey === sellerWallet);
      expect(statusSellerMeta?.isSigner).to.be.true;
    });
  });
});
