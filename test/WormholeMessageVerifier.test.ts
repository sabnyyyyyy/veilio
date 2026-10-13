import { expect } from 'chai';
import { ethers } from 'hardhat';
import { keccak256, toBytes, type Hex } from 'viem';
import {
  WormholeMessageVerifier,
  ReplayStore,
  type CrossChainMessageEnvelope,
} from '../lib/server/cross-chain';

describe('VEILIO Milestone 2 — Wormhole Message Verification Pipeline', () => {
  // Setup 19 deterministic Guardian keypairs
  const guardianWallets: ethers.HDNodeWallet[] = [];
  const guardianAddresses: string[] = [];

  before(() => {
    // Generate 19 deterministic guardian test wallets
    for (let i = 0; i < 19; i++) {
      const wallet = ethers.HDNodeWallet.fromPhrase(
        'test test test test test test test test test test test junk',
        undefined,
        `m/44'/60'/0'/0/${i}`
      );
      guardianWallets.push(wallet);
      guardianAddresses.push(wallet.address.toLowerCase());
    }
  });

  beforeEach(async () => {
    await ReplayStore.clearAllReplaysForTesting();
  });

  /**
   * Helper function to synthesize a binary Wormhole VAA buffer with valid ECDSA signatures.
   */
  function synthesizeVaa(options: {
    emitterChainId?: number;
    emitterAddress?: string; // 20-byte EVM address
    sequence?: bigint;
    consistencyLevel?: number;
    payload?: string;
    guardianCount?: number;
    corruptSignature?: boolean;
    outOfOrderGuardians?: boolean;
    unauthorizedGuardian?: boolean;
  }): { vaaBytesHex: string; bodyHash: string } {
    const emitterChainId = options.emitterChainId ?? 4; // 4 = BSC
    const emitterAddrHex = options.emitterAddress ?? '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1';
    const sequence = options.sequence ?? 1001n;
    const consistencyLevel = options.consistencyLevel ?? 15;
    const payload = options.payload ?? '0x123456';
    const guardianCount = options.guardianCount ?? 13; // Quorum is 13

    // 1. Construct Body Buffer
    const timestampBuf = Buffer.alloc(4);
    timestampBuf.writeUInt32BE(Math.floor(Date.now() / 1000));

    const nonceBuf = Buffer.alloc(4);
    nonceBuf.writeUInt32BE(0);

    const emitterChainBuf = Buffer.alloc(2);
    emitterChainBuf.writeUInt16BE(emitterChainId);

    // Emitter address is 32 bytes (12 bytes zero padding + 20 bytes EVM address)
    const cleanAddr = emitterAddrHex.replace(/^0x/, '').padStart(64, '0');
    const emitterAddrBuf = Buffer.from(cleanAddr, 'hex');

    const seqBuf = Buffer.alloc(8);
    seqBuf.writeBigUInt64BE(sequence);

    const consistencyBuf = Buffer.from([consistencyLevel]);

    const payloadBytes = Buffer.from(payload.replace(/^0x/, ''), 'hex');

    const bodyBuffer = Buffer.concat([
      timestampBuf,
      nonceBuf,
      emitterChainBuf,
      emitterAddrBuf,
      seqBuf,
      consistencyBuf,
      payloadBytes,
    ]);

    // 2. Hash body: double keccak256
    const firstHash = keccak256(toBytes(`0x${bodyBuffer.toString('hex')}` as Hex));
    const doubleHash = keccak256(toBytes(firstHash));

    // 3. Create Guardian Signatures
    const sigsList: { index: number; sigBytes: Buffer }[] = [];
    const count = Math.min(guardianCount, 19);

    for (let i = 0; i < count; i++) {
      let wallet = guardianWallets[i];
      if (options.unauthorizedGuardian && i === 0) {
        // Use an unauthorized random wallet
        wallet = ethers.Wallet.createRandom() as any;
      }

      const signingKey = new ethers.SigningKey(wallet.privateKey);
      const signature = signingKey.sign(doubleHash);

      const rBuf = Buffer.from(signature.r.slice(2), 'hex');
      const sBuf = Buffer.from(signature.s.slice(2), 'hex');
      const vBuf = Buffer.from([signature.v]);

      if (options.corruptSignature && i === 0) {
        // Corrupt signature bytes
        rBuf[0] ^= 0xff;
      }

      const sigBytes = Buffer.concat([rBuf, sBuf, vBuf]);
      sigsList.push({ index: i, sigBytes });
    }

    if (options.outOfOrderGuardians && sigsList.length >= 2) {
      // Swap first two guardians to violate monotonic index ordering
      const tmp = sigsList[0];
      sigsList[0] = sigsList[1];
      sigsList[1] = tmp;
    }

    // 4. Construct Header
    const versionBuf = Buffer.from([1]);
    const guardianSetBuf = Buffer.alloc(4);
    guardianSetBuf.writeUInt32BE(0);

    const lenSigsBuf = Buffer.from([sigsList.length]);

    const sigParts: Buffer[] = [];
    for (const item of sigsList) {
      sigParts.push(Buffer.from([item.index]));
      sigParts.push(item.sigBytes);
    }
    const allSigsBuf = Buffer.concat(sigParts);

    const fullVaa = Buffer.concat([versionBuf, guardianSetBuf, lenSigsBuf, allSigsBuf, bodyBuffer]);

    return {
      vaaBytesHex: `0x${fullVaa.toString('hex')}`,
      bodyHash: doubleHash,
    };
  }

  // ==========================================================================
  // Positive Verification Tests
  // ==========================================================================
  describe('Positive Verification Pipeline', () => {
    it('successfully verifies a valid, correctly signed VAA from allowlisted emitter', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        emitterChainId: 4,
        emitterAddress: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        sequence: 5001n,
        consistencyLevel: 15,
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:0xc12E...:5001',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '5001',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '43920192',
        observedAt: Math.floor(Date.now() / 1000),
        sequence: '5001',
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      const result = await verifier.verifyMessage(envelope);

      expect(result.status).to.equal('verified');
      expect(result.checks.proofVerified).to.be.true;
      expect(result.checks.trustedEmitterVerified).to.be.true;
      expect(result.checks.finalitySatisfied).to.be.true;
      expect(result.checks.replayChecked).to.be.true;
      expect(result.canonicalMessageId).to.equal(
        'bnb:97:0xc12ecd53b9dae1753409b87f10bf00684bf7d8b1:5001'
      );
    });
  });

  // ==========================================================================
  // Negative Verification Tests
  // ==========================================================================
  describe('Negative & Security Edge-Case Tests', () => {
    it('rejects malformed VAA or truncated envelope bytes', async () => {
      const verifier = new WormholeMessageVerifier();
      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:1',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '1',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        vaaBytes: '0x010203', // Truncated
      };

      const result = await verifier.verifyMessage(envelope);
      expect(result.status).to.equal('rejected');
      expect(result.reason).to.include('INVALID_VAA_PROOF');
    });

    it('rejects VAA with insufficient Guardian quorum (e.g. 12/19 signatures)', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        guardianCount: 12, // 12 is less than 13 required
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:2',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '2',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      const result = await verifier.verifyMessage(envelope);
      expect(result.status).to.equal('rejected');
      expect(result.reason).to.equal('INSUFFICIENT_GUARDIAN_QUORUM');
    });

    it('rejects corrupted guardian signature bytes', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        guardianCount: 13,
        corruptSignature: true,
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:3',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '3',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      const result = await verifier.verifyMessage(envelope);
      expect(result.status).to.equal('rejected');
    });

    it('rejects untrusted or impersonated emitter address', async () => {
      const verifier = new WormholeMessageVerifier();

      const { vaaBytesHex } = synthesizeVaa({
        emitterAddress: '0xDead00000000000000000000000000000000Beef',
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:attacker:4',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xDead00000000000000000000000000000000Beef',
        auctionId: '4',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      const result = await verifier.verifyMessage(envelope);
      expect(result.status).to.equal('rejected');
      expect(result.reason).to.equal('UNTRUSTED_EMITTER');
      expect(result.checks.trustedEmitterVerified).to.be.false;
    });

    it('rejects unsupported payload version or malformed envelope', async () => {
      const verifier = new WormholeMessageVerifier();

      const malformedEnvelope = {
        version: 2, // Unsupported version
        sourceNetwork: 'bnb:97',
      };

      const result = await verifier.verifyMessage(malformedEnvelope);
      expect(result.status).to.equal('rejected');
      expect(result.reason).to.equal('UNSUPPORTED_VERSION');
    });

    it('rejects unauthorized guardian signer not in allowlist', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        unauthorizedGuardian: true,
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:5',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '5',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      const result = await verifier.verifyMessage(envelope);
      expect(result.status).to.equal('rejected');
      expect(result.reason).to.equal('UNAUTHORIZED_GUARDIAN_SIGNER');
    });

    it('enforces source-chain finality depth and transitions to pending if unconfirmed', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        consistencyLevel: 3, // Shallow depth (< 15 required)
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:6',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '6',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        vaaBytes: vaaBytesHex,
        consistencyLevel: 3, // < 15
      };

      const result = await verifier.verifyMessage(envelope);
      expect(result.status).to.equal('pending');
      expect(result.reason).to.equal('PENDING_SOURCE_FINALITY');
      expect(result.checks.finalitySatisfied).to.be.false;
      expect(result.checks.proofVerified).to.be.true;
    });

    it('ensures client-supplied verification flags cannot bypass verifier', async () => {
      const verifier = new WormholeMessageVerifier();

      // Client maliciously supplies pre-set flags claiming everything is verified
      const deceptiveEnvelope = {
        version: 1,
        messageId: 'wormhole:97:cheat:7',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xDead00000000000000000000000000000000Beef',
        auctionId: '7',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        verification: {
          proofVerified: true,
          trustedEmitterVerified: true,
          finalitySatisfied: true,
          replayChecked: true,
        },
        status: 'verified',
        vaaBytes: '0x010203', // Invalid
      };

      const result = await verifier.verifyMessage(deceptiveEnvelope);
      expect(result.status).to.equal('rejected');
      expect(result.status).to.not.equal('verified');
    });
  });

  // ==========================================================================
  // Replay, Idempotency & Concurrency Tests
  // ==========================================================================
  describe('Replay Protection & Atomic Idempotency', () => {
    it('handles duplicate message submissions idempotently', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        sequence: 7777n,
        consistencyLevel: 15,
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:7777',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '7777',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        sequence: '7777',
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      // First submission
      const firstResult = await verifier.verifyMessage(envelope);
      expect(firstResult.status).to.equal('verified');
      expect(firstResult.reason).to.be.undefined;

      // Second duplicate submission
      const secondResult = await verifier.verifyMessage(envelope);
      expect(secondResult.status).to.equal('verified');
      expect(secondResult.reason).to.equal('DUPLICATE_IDEMPOTENT');
    });

    it('proves atomic idempotency under concurrent duplicate submissions', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        sequence: 8888n,
        consistencyLevel: 15,
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:8888',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '8888',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        sequence: '8888',
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      // Concurrently submit 5 requests with the exact same message envelope
      const concurrentResults = await Promise.all([
        verifier.verifyMessage(envelope),
        verifier.verifyMessage(envelope),
        verifier.verifyMessage(envelope),
        verifier.verifyMessage(envelope),
        verifier.verifyMessage(envelope),
      ]);

      // Exactly one must win the initial commit, and all others must either return
      // DUPLICATE_IDEMPOTENT or CONCURRENT_IN_FLIGHT_RESERVATION, NEVER creating a second record!
      const initialVerifies = concurrentResults.filter(
        (r) => r.status === 'verified' && r.reason === undefined
      );
      expect(initialVerifies.length).to.equal(1);
    });

    it('rejects out-of-order guardian index signatures', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        sequence: 9991n,
        outOfOrderGuardians: true, // Non-monotonic guardian indices
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:9991',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '9991',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        sequence: '9991',
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      const result = await verifier.verifyMessage(envelope);
      expect(result.status).to.equal('rejected');
      expect(result.reason).to.equal('INVALID_GUARDIAN_INDEX_ORDER');
    });

    it('returns temporarily_unavailable when storage or database fails', async () => {
      const verifier = new WormholeMessageVerifier({
        requiredGuardianQuorum: 13,
        allowlistedGuardians: guardianAddresses,
      });

      const { vaaBytesHex } = synthesizeVaa({
        sequence: 9992n,
        consistencyLevel: 15,
      });

      const envelope: CrossChainMessageEnvelope = {
        version: 1,
        messageId: 'wormhole:97:test:9992',
        sourceNetwork: 'bnb:97',
        sourceEmitter: '0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1',
        auctionId: '9992',
        eventType: 'AUCTION_SETTLED',
        payloadHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        sourceTransaction: '0x8f7e6d5c4b3a291827364510abcedf1234567890abcdef1234567890abcdef12',
        sourceBlockOrSlot: '100',
        observedAt: Math.floor(Date.now() / 1000),
        sequence: '9992',
        vaaBytes: vaaBytesHex,
        consistencyLevel: 15,
      };

      // Mock ReplayStore.reserveMessage to throw simulating database outage
      const originalReserve = ReplayStore.reserveMessage;
      try {
        ReplayStore.reserveMessage = async () => {
          throw new Error('Database disk I/O failure (ENOSPC)');
        };

        const result = await verifier.verifyMessage(envelope);
        expect(result.status).to.equal('temporarily_unavailable');
        expect(result.reason).to.include('STORAGE_UNAVAILABLE');
      } finally {
        ReplayStore.reserveMessage = originalReserve;
      }
    });
  });
});

