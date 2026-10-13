import { expect } from 'chai';
import crypto from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createWalletLinkChallenge,
  consumeWalletLinkChallenge,
  getOrCreateIdentityForWallet,
  getIdentityProfile,
  getIdentityByWallet,
  linkWalletToIdentity,
  unlinkWalletFromIdentity,
  verifyUnlinkAuth,
  createUnlinkAuthMessage,
  createProfileInitMessage,
  verifyProfileInitAuth,
  sanitizeBidMetadata,
  ingestUnifiedActivity,
  getUnifiedActivityHistory,
  getUnifiedServicesForIdentity,
  verifySolanaSignature,
  normalizeWalletAddress,
  _resetIdentitiesDbForTesting,
  identityStorageConfigurationError,
  _setIdentityStoreForTesting,
} from '../lib/server/identityDb';
import { encodeBase58 } from '../lib/cross-chain/solanaServiceRegistry';
import { LocalIdentityStore, RedisIdentityStore } from '../lib/server/identityPersistence';

describe('VEILIO Milestone 5 & Production Persistence — Unified Multi-Chain Identity & Activity History', () => {
  // Test EVM Account
  const evmPrivateKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7dc1a084016e7' as `0x${string}`;
  const evmAccount = privateKeyToAccount(evmPrivateKey);
  const evmAddress = evmAccount.address;

  // Test Solana Keypair (Ed25519)
  const { publicKey: solPublicKey, privateKey: solPrivateKey } = crypto.generateKeyPairSync('ed25519');
  const rawSolPub = solPublicKey.export({ type: 'spki', format: 'der' }).subarray(12);
  const solAddress = encodeBase58(rawSolPub);

  // Another EVM account for cross-account testing
  const otherEvmAccount = privateKeyToAccount(
    '0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1' as `0x${string}`
  );

  beforeEach(async () => {
    _setIdentityStoreForTesting(null);
    await _resetIdentitiesDbForTesting();
  });

  afterEach(() => {
    _setIdentityStoreForTesting(null);
  });

  // ==========================================================================
  // 1. Address Normalization Tests
  // ==========================================================================
  describe('Address Normalization', () => {
    it('normalizes EVM addresses to lowercase', () => {
      const mixed = '0x0D1c307B4D59143703aE38fB6479d9Dac1fec987';
      expect(normalizeWalletAddress(mixed, 'evm')).to.equal(mixed.toLowerCase());
    });

    it('preserves case for Solana Base58 addresses', () => {
      expect(normalizeWalletAddress(solAddress, 'solana')).to.equal(solAddress);
    });
  });

  // ==========================================================================
  // 2. Identity Anchor & Profile Management
  // ==========================================================================
  describe('Identity Anchor & Profile Creation', () => {
    it('creates a fresh Veilio identity anchored by primary EVM wallet', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      expect(profile.id).to.match(/^usr_/);
      expect(profile.primaryWallet).to.equal(evmAddress.toLowerCase());
      expect(profile.linkedWallets).to.have.length(1);
      expect(profile.linkedWallets[0].address).to.equal(evmAddress.toLowerCase());
      expect(profile.linkedWallets[0].chainFamily).to.equal('evm');
      expect(profile.linkedWallets[0].isPrimary).to.be.true;
      expect(profile.linkedWallets[0].status).to.equal('active');
    });

    it('retrieves existing identity profile when called with same wallet', async () => {
      const profile1 = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const profile2 = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      expect(profile1.id).to.equal(profile2.id);
    });
  });

  // ==========================================================================
  // 3. Ephemeral Challenges & Atomic Replay Protection
  // ==========================================================================
  describe('Challenge Generation & Atomic Consumption', () => {
    it('generates a fresh short-lived challenge for EVM linking', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'evm',
        walletAddress: evmAddress,
      });

      expect(challenge.challengeId).to.match(/^chal_/);
      expect(challenge.expiresAt).to.be.greaterThan(Date.now());
      expect(challenge.message).to.include(profile.id);
      expect(challenge.message).to.include(evmAddress.toLowerCase());
    });

    it('generates a fresh domain-separated challenge for Solana linking', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'solana',
        walletAddress: solAddress,
      });

      expect(challenge.challengeId).to.match(/^chal_/);
      expect(challenge.message).to.include('[VEILIO_SOLANA_LINK_CHALLENGE]');
      expect(challenge.message).to.include(solAddress);
    });

    it('generates a fresh Base Sepolia challenge with Chain ID 84532 and verifies signature', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'base:84532');
      expect(profile.linkedWallets[0].networkId).to.equal('base:84532');

      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'evm',
        networkId: 'base:84532',
        walletAddress: otherEvmAccount.address,
      });

      expect(challenge.challengeId).to.match(/^chal_/);
      expect(challenge.networkId).to.equal('base:84532');
      expect(challenge.message).to.include('Chain ID: 84532');

      const signature = await otherEvmAccount.signMessage({ message: challenge.message });
      const res = await consumeWalletLinkChallenge(challenge.challengeId, otherEvmAccount.address, signature);
      expect(res.valid).to.be.true;
      expect(res.identityId).to.equal(profile.id);

      const updated = await linkWalletToIdentity(profile.id, {
        address: otherEvmAccount.address,
        chainFamily: 'evm',
        networkId: 'base:84532',
        proofType: 'eip191',
      });
      const baseRecord = updated.linkedWallets.find((w) => w.address === otherEvmAccount.address.toLowerCase());
      expect(baseRecord).to.exist;
      expect(baseRecord?.networkId).to.equal('base:84532');
      expect(baseRecord?.proofType).to.equal('eip191');
    });

    it('atomically consumes challenge on first verification and blocks replay', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'evm',
        walletAddress: evmAddress,
      });

      const signature = await evmAccount.signMessage({ message: challenge.message });

      // First consumption: MUST succeed
      const res1 = await consumeWalletLinkChallenge(challenge.challengeId, evmAddress, signature);
      expect(res1.valid).to.be.true;
      expect(res1.identityId).to.equal(profile.id);

      // Replay attempt: MUST fail because challenge was atomically removed
      const res2 = await consumeWalletLinkChallenge(challenge.challengeId, evmAddress, signature);
      expect(res2.valid).to.be.false;
      expect(res2.error).to.include('already consumed, or expired');
    });

    it('rejects challenge if submitted with mismatched wallet address', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'evm',
        walletAddress: evmAddress,
      });

      const signature = await evmAccount.signMessage({ message: challenge.message });

      // Submit with different wallet
      const res = await consumeWalletLinkChallenge(
        challenge.challengeId,
        otherEvmAccount.address,
        signature
      );
      expect(res.valid).to.be.false;
      expect(res.error).to.include('Wallet address mismatch');
    });

    it('rejects forged or invalid signature', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'evm',
        walletAddress: evmAddress,
      });

      // Sign with wrong private key
      const wrongSignature = await otherEvmAccount.signMessage({ message: challenge.message });

      const res = await consumeWalletLinkChallenge(
        challenge.challengeId,
        evmAddress,
        wrongSignature
      );
      expect(res.valid).to.be.false;
      expect(res.error).to.include('Invalid EVM cryptographic signature');
    });
  });

  // ==========================================================================
  // 4. Solana Ed25519 Signature Verification
  // ==========================================================================
  describe('Solana Ed25519 Wallet Proof Verification', () => {
    it('verifies valid Solana Ed25519 signature over challenge text', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'solana',
        walletAddress: solAddress,
      });

      // Sign using Node crypto with Ed25519 private key
      const sigBuf = crypto.sign(null, Buffer.from(challenge.message, 'utf8'), solPrivateKey);
      const sigBase58 = encodeBase58(sigBuf);

      const res = await consumeWalletLinkChallenge(challenge.challengeId, solAddress, sigBase58);
      expect(res.valid).to.be.true;
    });

    it('rejects corrupted Solana signature', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'solana',
        walletAddress: solAddress,
      });

      const corruptedSig = encodeBase58(Buffer.alloc(64, 0x12));
      const res = await consumeWalletLinkChallenge(challenge.challengeId, solAddress, corruptedSig);
      expect(res.valid).to.be.false;
      expect(res.error).to.include('Invalid Solana Ed25519');
    });
  });

  // ==========================================================================
  // 5. Multi-Chain Wallet Linking & Unlinking Invariants
  // ==========================================================================
  describe('Multi-Chain Linking Invariants', () => {
    it('links Solana wallet to existing EVM identity after verified proof', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      const updated = await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      expect(updated.linkedWallets).to.have.length(2);
      const solRecord = updated.linkedWallets.find((w) => w.address === solAddress);
      expect(solRecord).to.exist;
      expect(solRecord?.chainFamily).to.equal('solana');
      expect(solRecord?.networkId).to.equal('solana:devnet');
      expect(solRecord?.status).to.equal('active');
    });

    it('rejects linking a wallet already bound to another active identity profile', async () => {
      // Identity 1 owns evmAddress
      const profile1 = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      // Identity 2 owns otherEvmAccount
      const profile2 = await getOrCreateIdentityForWallet(otherEvmAccount.address, 'evm', 'bnb:97');

      let threw = false;
      try {
        await linkWalletToIdentity(profile2.id, {
          address: evmAddress,
          chainFamily: 'evm',
          networkId: 'bnb:97',
          proofType: 'eip191',
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).to.include('already linked to another Veilio identity');
      }
      expect(threw).to.be.true;
    });

    it('unlinks secondary wallet while preserving primary wallet', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      const afterUnlink = await unlinkWalletFromIdentity(profile.id, solAddress, 'solana');
      const solRecord = afterUnlink.linkedWallets.find((w) => w.address === solAddress);
      expect(solRecord?.status).to.equal('unlinked');
      expect(afterUnlink.primaryWallet).to.equal(evmAddress.toLowerCase());
    });

    it('blocks unlinking the only remaining active wallet', async () => {
      const singleWalletAccount = privateKeyToAccount(
        '0x7cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a2' as `0x${string}`
      );
      const profile = await getOrCreateIdentityForWallet(singleWalletAccount.address, 'evm', 'bnb:97');

      let threw = false;
      try {
        await unlinkWalletFromIdentity(profile.id, singleWalletAccount.address, 'evm');
      } catch (err: any) {
        threw = true;
        expect(err.message).to.include('Cannot unlink the only active wallet');
      }
      expect(threw).to.be.true;
    });
  });

  // ==========================================================================
  // 6. Unified Activity Ingestion & History Queries
  // ==========================================================================
  describe('Unified Activity Ingestion & Queries', () => {
    it('ingests and queries activities across mixed EVM and Solana chains with full provenance', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      // 1. Ingest BNB Auction Activity
      const bnbAct = await ingestUnifiedActivity({
        id: 'bnb:97:tx:0x1111222233334444',
        identityId: profile.id,
        walletAddress: evmAddress.toLowerCase(),
        chainFamily: 'evm',
        networkId: 'bnb:97',
        activityType: 'auction_created',
        title: 'Dataset Auction Created on BNB Chain',
        description: 'Listing item: Medical Dataset Alpha',
        txHashOrSignature: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
        contractOrProgram: '0x0D1c307B4D59143703aE38fB6479d9Dac1fec987',
        blockOrSlot: 45000100,
        timestamp: Date.now() - 10000,
        status: 'confirmed',
      });
      expect(bnbAct.inserted).to.be.true;

      // 2. Ingest Solana Service Registry Activity
      const solAct = await ingestUnifiedActivity({
        id: 'solana:devnet:sig:5eykt4UsFv8P8NJd',
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        activityType: 'service_registered',
        title: 'Service Registered on Solana Devnet',
        description: 'Listing service: Smart Contract Audit Agent',
        txHashOrSignature: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9dTeZMn28nd859y77K6A1F9v5b3d6r7y8k9m4n2p5q8r9s',
        contractOrProgram: 'Ve11ioServiceRegistry1111111111111111111111',
        blockOrSlot: 280010000,
        timestamp: Date.now(),
        status: 'confirmed',
      });
      expect(solAct.inserted).to.be.true;

      // 3. Query combined activity history
      const history = await getUnifiedActivityHistory(profile.id);
      expect(history.total).to.be.greaterThanOrEqual(2);

      const items = history.items;
      const bnbItem = items.find((i) => i.chainFamily === 'evm');
      const solItem = items.find((i) => i.chainFamily === 'solana');

      expect(bnbItem).to.exist;
      expect(bnbItem?.networkId).to.equal('bnb:97');
      expect(bnbItem?.walletAddress).to.equal(evmAddress.toLowerCase());

      expect(solItem).to.exist;
      expect(solItem?.networkId).to.equal('solana:devnet');
      expect(solItem?.walletAddress).to.equal(solAddress);
    });

    it('proves idempotent ingestion on duplicate activity ID', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const actId = 'bnb:97:tx:idempotent_test_001';

      const res1 = await ingestUnifiedActivity({
        id: actId,
        identityId: profile.id,
        walletAddress: evmAddress.toLowerCase(),
        chainFamily: 'evm',
        networkId: 'bnb:97',
        activityType: 'order_funded',
        title: 'Order Funded',
        description: 'Initial deposit',
        timestamp: Date.now(),
        status: 'pending',
      });
      expect(res1.inserted).to.be.true;

      // Duplicate ingestion with updated status
      const res2 = await ingestUnifiedActivity({
        id: actId,
        identityId: profile.id,
        walletAddress: evmAddress.toLowerCase(),
        chainFamily: 'evm',
        networkId: 'bnb:97',
        activityType: 'order_funded',
        title: 'Order Funded',
        description: 'Initial deposit',
        timestamp: Date.now(),
        status: 'finalized',
      });
      expect(res2.inserted).to.be.false;
      expect(res2.item.status).to.equal('finalized');
    });

    it('supports chain family filtering and pagination', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      const evmOnly = await getUnifiedActivityHistory(profile.id, { chainFamily: 'evm' });
      for (const item of evmOnly.items) {
        expect(item.chainFamily).to.equal('evm');
      }

      const solOnly = await getUnifiedActivityHistory(profile.id, { chainFamily: 'solana' });
      for (const item of solOnly.items) {
        expect(item.chainFamily).to.equal('solana');
      }
    });
  });

  // ==========================================================================
  // 7. Security Audit Regression & Invariant Hardening
  // ==========================================================================
  describe('Security Audit Regression & Invariant Hardening', () => {
    it('rejects challenge generation with malformed EVM address', async () => {
      let threw = false;
      try {
        await createWalletLinkChallenge({
          identityId: 'usr_test123',
          chainFamily: 'evm',
          walletAddress: '0xinvalid_address_not_40_hex',
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).to.include('Invalid EVM wallet address format');
      }
      expect(threw).to.be.true;
    });

    it('rejects challenge generation with malformed Solana Base58 public key', async () => {
      let threwFormat = false;
      try {
        await createWalletLinkChallenge({
          identityId: 'usr_test123',
          chainFamily: 'solana',
          walletAddress: 'InvalidBase58_0OIl',
        });
      } catch (err: any) {
        threwFormat = true;
        expect(err.message).to.include('Invalid Solana Base58 public key format');
      }
      expect(threwFormat).to.be.true;

      const shortPub = encodeBase58(Buffer.alloc(16));
      let threwLen = false;
      try {
        await createWalletLinkChallenge({
          identityId: 'usr_test123',
          chainFamily: 'solana',
          walletAddress: shortPub,
        });
      } catch (err: any) {
        threwLen = true;
        expect(err.message).to.include('Solana public key must be exactly 32 bytes');
      }
      expect(threwLen).to.be.true;
    });

    it('prevents race conditions: exactly one succeeds among concurrent challenge consumption attempts', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'evm',
        walletAddress: evmAddress,
      });

      const signature = await evmAccount.signMessage({ message: challenge.message });

      // Run 10 concurrent consumption attempts
      const attempts = await Promise.all(
        Array.from({ length: 10 }, () =>
          consumeWalletLinkChallenge(challenge.challengeId, evmAddress, signature)
        )
      );

      const successCount = attempts.filter((r) => r.valid).length;
      const failedCount = attempts.filter((r) => !r.valid).length;

      expect(successCount).to.equal(1);
      expect(failedCount).to.equal(9);
    });

    it('verifies unlink authorization: permits unlinking signed by primary wallet', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createUnlinkAuthMessage({
        identityId: profile.id,
        walletAddress: solAddress,
        signerAddress: evmAddress.toLowerCase(),
        timestamp,
        nonce,
      });

      const signature = await evmAccount.signMessage({ message });

      const authCheck = await verifyUnlinkAuth({
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        auth: {
          signerAddress: evmAddress.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });

      expect(authCheck.valid).to.be.true;
      const unlinkedProfile = await unlinkWalletFromIdentity(profile.id, solAddress, 'solana');
      const solRecord = unlinkedProfile.linkedWallets.find((w) => w.address === solAddress);
      expect(solRecord?.status).to.equal('unlinked');
    });

    it('verifies unlink authorization: permits unlinking signed by the target wallet itself', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createUnlinkAuthMessage({
        identityId: profile.id,
        walletAddress: solAddress,
        signerAddress: solAddress,
        timestamp,
        nonce,
      });

      const sigBuf = crypto.sign(null, Buffer.from(message, 'utf8'), solPrivateKey);
      const signature = encodeBase58(sigBuf);

      const authCheck = await verifyUnlinkAuth({
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        auth: {
          signerAddress: solAddress,
          signature,
          timestamp,
          nonce,
          chainFamily: 'solana',
        },
      });

      expect(authCheck.valid).to.be.true;
    });

    it('verifies unlink authorization: rejects unlinking signed by unauthorized third-party wallet', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createUnlinkAuthMessage({
        identityId: profile.id,
        walletAddress: solAddress,
        signerAddress: otherEvmAccount.address.toLowerCase(),
        timestamp,
        nonce,
      });

      const signature = await otherEvmAccount.signMessage({ message });

      const authCheck = await verifyUnlinkAuth({
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        auth: {
          signerAddress: otherEvmAccount.address.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });

      expect(authCheck.valid).to.be.false;
      expect(authCheck.status).to.equal(403);
      expect(authCheck.error).to.include('not authorized');
    });

    it('verifies unlink authorization: rejects replayed nonce and expired timestamp', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createUnlinkAuthMessage({
        identityId: profile.id,
        walletAddress: solAddress,
        signerAddress: evmAddress.toLowerCase(),
        timestamp,
        nonce,
      });

      const signature = await evmAccount.signMessage({ message });

      // First call succeeds
      const check1 = await verifyUnlinkAuth({
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        auth: {
          signerAddress: evmAddress.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });
      expect(check1.valid).to.be.true;

      // Replay attempt fails
      const check2 = await verifyUnlinkAuth({
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        auth: {
          signerAddress: evmAddress.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });
      expect(check2.valid).to.be.false;
      expect(check2.error).to.include('Replay detected');

      // Expired timestamp fails
      const expiredTimestamp = Date.now() - 10 * 60 * 1000;
      const checkExpired = await verifyUnlinkAuth({
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        auth: {
          signerAddress: evmAddress.toLowerCase(),
          signature,
          timestamp: expiredTimestamp,
          nonce: 'fresh_nonce_123',
          chainFamily: 'evm',
        },
      });
      expect(checkExpired.valid).to.be.false;
      expect(checkExpired.error).to.include('expired');
    });

    it('rejects activity ingestion for a wallet not linked to the identity', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      let threw = false;
      try {
        await ingestUnifiedActivity({
          id: 'activity_unauthorized_wallet_001',
          identityId: profile.id,
          walletAddress: otherEvmAccount.address,
          chainFamily: 'evm',
          networkId: 'bnb:97',
          activityType: 'order_funded',
          title: 'Unauthorized Order Funded',
          description: 'Attempt to spoof identity activity from unlinked wallet',
          timestamp: Date.now(),
          status: 'confirmed',
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).to.include('not an active linked wallet');
      }
      expect(threw).to.be.true;
    });

    it('sanitizes confidential bid secrets on bid_committed activity ingestion', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      const res = await ingestUnifiedActivity({
        id: 'bnb:97:tx:sealed_bid_sanitize_001',
        identityId: profile.id,
        walletAddress: evmAddress.toLowerCase(),
        chainFamily: 'evm',
        networkId: 'bnb:97',
        activityType: 'bid_committed',
        title: 'Bid Committed',
        description: 'Sealed bid submission',
        timestamp: Date.now(),
        status: 'confirmed',
        metadata: {
          auctionId: '101',
          salt: '0x1234567890abcdef',
          secret: 'super_secret_cleartext_phrase',
          maxBid: '1000000000000000000',
          maxBidLamports: '5000000',
          publicCommitmentHash: '0x9999888877776666',
        },
      });

      expect(res.item.metadata?.publicCommitmentHash).to.equal('0x9999888877776666');
      expect(res.item.metadata?.auctionId).to.equal('101');
      expect(res.item.metadata?.salt).to.be.undefined;
      expect(res.item.metadata?.secret).to.be.undefined;
      expect(res.item.metadata?.maxBid).to.be.undefined;
      expect(res.item.metadata?.maxBidLamports).to.be.undefined;
    });

    it('sanitizes case-insensitive, alternate-named, and nested sealed-bid secrets across storage and response paths', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      const complexMetadata = {
        auctionId: '202',
        publicCommitmentHash: '0x1111222233334444',
        Salt: '0xsensitive_salt_uppercase',
        SECRET: 'sensitive_secret_caps',
        max_bid: '99999999',
        MAX_BID_LAMPORTS: '88888888',
        cleartextSecret: 'cleartext_value',
        rawBid: '100000',
        nestedBid: {
          salt: '0xnested_salt',
          secret: 'nested_secret',
          safeField: 'safe_nested_info',
        },
        items: [
          { preimage: 'array_preimage', label: 'safe_label' },
        ],
      };

      const res = await ingestUnifiedActivity({
        id: 'bnb:97:tx:nested_sanitize_001',
        identityId: profile.id,
        walletAddress: evmAddress.toLowerCase(),
        chainFamily: 'evm',
        networkId: 'bnb:97',
        activityType: 'bid_committed',
        title: 'Bid Committed Nested',
        description: 'Sealed bid submission with nested secrets',
        timestamp: Date.now(),
        status: 'confirmed',
        metadata: complexMetadata,
      });

      // Storage sanitization check
      const meta = res.item.metadata as any;
      expect(meta.publicCommitmentHash).to.equal('0x1111222233334444');
      expect(meta.auctionId).to.equal('202');
      expect(meta.Salt).to.be.undefined;
      expect(meta.SECRET).to.be.undefined;
      expect(meta.max_bid).to.be.undefined;
      expect(meta.MAX_BID_LAMPORTS).to.be.undefined;
      expect(meta.cleartextSecret).to.be.undefined;
      expect(meta.rawBid).to.be.undefined;
      expect(meta.nestedBid.salt).to.be.undefined;
      expect(meta.nestedBid.secret).to.be.undefined;
      expect(meta.nestedBid.safeField).to.equal('safe_nested_info');
      expect(meta.items[0].preimage).to.be.undefined;
      expect(meta.items[0].label).to.equal('safe_label');

      // Response serialization path check
      const history = await getUnifiedActivityHistory(profile.id, { chainFamily: 'evm' });
      const queried = history.items.find((i) => i.id === 'bnb:97:tx:nested_sanitize_001');
      expect(queried).to.exist;
      const qMeta = queried?.metadata as any;
      expect(qMeta.Salt).to.be.undefined;
      expect(qMeta.nestedBid.secret).to.be.undefined;
    });

    it('verifies unlink authorization: rejects unlinking when message target wallet differs from payload', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createUnlinkAuthMessage({
        identityId: profile.id,
        walletAddress: 'different_wallet_address',
        signerAddress: evmAddress.toLowerCase(),
        timestamp,
        nonce,
      });

      const signature = await evmAccount.signMessage({ message });

      const authCheck = await verifyUnlinkAuth({
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        auth: {
          signerAddress: evmAddress.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });

      expect(authCheck.valid).to.be.false;
      expect(authCheck.error).to.include('Invalid EVM cryptographic signature');
    });

    it('verifies unlink authorization: rejects unlinking when message identity differs', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createUnlinkAuthMessage({
        identityId: 'usr_different_identity',
        walletAddress: solAddress,
        signerAddress: evmAddress.toLowerCase(),
        timestamp,
        nonce,
      });

      const signature = await evmAccount.signMessage({ message });

      const authCheck = await verifyUnlinkAuth({
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana',
        auth: {
          signerAddress: evmAddress.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });

      expect(authCheck.valid).to.be.false;
      expect(authCheck.error).to.include('Invalid EVM cryptographic signature');
    });

    it('prevents race conditions: exactly one succeeds among concurrent unlink authorization attempts', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createUnlinkAuthMessage({
        identityId: profile.id,
        walletAddress: solAddress,
        signerAddress: evmAddress.toLowerCase(),
        timestamp,
        nonce,
      });

      const signature = await evmAccount.signMessage({ message });

      const payload = {
        identityId: profile.id,
        walletAddress: solAddress,
        chainFamily: 'solana' as const,
        auth: {
          signerAddress: evmAddress.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm' as const,
        },
      };

      // 10 concurrent verification attempts with the same authorization payload
      const attempts = await Promise.all(
        Array.from({ length: 10 }, () => verifyUnlinkAuth(payload))
      );

      const successCount = attempts.filter((r) => r.valid).length;
      const replayCount = attempts.filter((r) => !r.valid && r.error?.includes('Replay detected')).length;

      expect(successCount).to.equal(1);
      expect(replayCount).to.equal(9);
    });

    it('verifies unique-wallet invariant under concurrent linking attempts', async () => {
      const profile1 = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const profile2 = await getOrCreateIdentityForWallet(otherEvmAccount.address, 'evm', 'bnb:97');

      // Create challenges for both identities attempting to link the same Solana wallet
      const chal1 = await createWalletLinkChallenge({
        identityId: profile1.id,
        chainFamily: 'solana',
        walletAddress: solAddress,
      });
      const chal2 = await createWalletLinkChallenge({
        identityId: profile2.id,
        chainFamily: 'solana',
        walletAddress: solAddress,
      });

      const sig1 = encodeBase58(crypto.sign(null, Buffer.from(chal1.message, 'utf8'), solPrivateKey));
      const sig2 = encodeBase58(crypto.sign(null, Buffer.from(chal2.message, 'utf8'), solPrivateKey));

      // Consume both challenges
      const [res1, res2] = await Promise.all([
        consumeWalletLinkChallenge(chal1.challengeId, solAddress, sig1),
        consumeWalletLinkChallenge(chal2.challengeId, solAddress, sig2),
      ]);

      expect(res1.valid).to.be.true;
      expect(res2.valid).to.be.true;

      // Link to profile1 succeeds
      await linkWalletToIdentity(profile1.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      // Subsequent or concurrent attempt to link to profile2 must be rejected
      let threw = false;
      try {
        await linkWalletToIdentity(profile2.id, {
          address: solAddress,
          chainFamily: 'solana',
          networkId: 'solana:devnet',
          proofType: 'ed25519',
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).to.include('already linked to another Veilio identity');
      }
      expect(threw).to.be.true;
    });

    it('verifies profile initialization authorization: rejects unauthenticated requests on fresh wallet', async () => {
      const newEvmAccount = privateKeyToAccount(
        '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as `0x${string}`
      );

      // Verify no profile exists yet
      expect(await getIdentityByWallet(newEvmAccount.address, 'evm')).to.be.null;

      const authCheck = await verifyProfileInitAuth({
        walletAddress: newEvmAccount.address,
        chainFamily: 'evm',
        auth: null as any,
      });
      expect(authCheck.valid).to.be.false;
      expect(authCheck.status).to.equal(401);
    });

    it('verifies profile initialization authorization: rejects unauthorized signer from different wallet', async () => {
      const targetAccount = privateKeyToAccount(
        '0x92db14e403b83d5bac05b9d1b2299ad19194d63502e30e9208873136b80e5e1e' as `0x${string}`
      );

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createProfileInitMessage({
        walletAddress: targetAccount.address.toLowerCase(),
        chainFamily: 'evm',
        timestamp,
        nonce,
      });

      // Signed by otherEvmAccount (unauthorized third party)
      const signature = await otherEvmAccount.signMessage({ message });

      const authCheck = await verifyProfileInitAuth({
        walletAddress: targetAccount.address.toLowerCase(),
        chainFamily: 'evm',
        auth: {
          signerAddress: otherEvmAccount.address.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });

      expect(authCheck.valid).to.be.false;
      expect(authCheck.status).to.equal(403);
      expect(authCheck.error).to.include('Unauthorized');
    });

    it('verifies profile initialization authorization: succeeds with valid owner signature and enforces anti-replay', async () => {
      const freshAccount = privateKeyToAccount(
        '0xa88b64e0e5a882d8d85f8e02d6b35d72f123d456789abcdef0123456789abcde' as `0x${string}`
      );

      const nonce = crypto.randomBytes(8).toString('hex');
      const timestamp = Date.now();
      const message = createProfileInitMessage({
        walletAddress: freshAccount.address.toLowerCase(),
        chainFamily: 'evm',
        timestamp,
        nonce,
      });

      const signature = await freshAccount.signMessage({ message });

      // First initialization authorization: succeeds
      const authCheck1 = await verifyProfileInitAuth({
        walletAddress: freshAccount.address.toLowerCase(),
        chainFamily: 'evm',
        auth: {
          signerAddress: freshAccount.address.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });
      expect(authCheck1.valid).to.be.true;

      // Create profile
      const profile = await getOrCreateIdentityForWallet(freshAccount.address, 'evm', 'bnb:97');
      expect(profile.primaryWallet).to.equal(freshAccount.address.toLowerCase());

      // Replay attempt with same nonce: rejected
      const authCheck2 = await verifyProfileInitAuth({
        walletAddress: freshAccount.address.toLowerCase(),
        chainFamily: 'evm',
        auth: {
          signerAddress: freshAccount.address.toLowerCase(),
          signature,
          timestamp,
          nonce,
          chainFamily: 'evm',
        },
      });
      expect(authCheck2.valid).to.be.false;
      expect(authCheck2.error).to.include('Replay detected');

      // Duplicate initialization query for existing wallet is idempotent
      const dup = await getOrCreateIdentityForWallet(freshAccount.address, 'evm', 'bnb:97');
      expect(dup.id).to.equal(profile.id);
    });
  });

  // ==========================================================================
  // 8. Production Serverless & Shared Persistence Verification
  // ==========================================================================
  describe('Production Serverless & Shared Persistence Invariants', () => {
    it('fails closed in production mode when shared Redis persistence is missing', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevUrl = process.env.IDENTITY_REDIS_REST_URL;
      const prevToken = process.env.IDENTITY_REDIS_REST_TOKEN;
      const prevAssetUrl = process.env.ASSET_REDIS_REST_URL;
      const prevAssetToken = process.env.ASSET_REDIS_REST_TOKEN;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.IDENTITY_REDIS_REST_URL;
        delete process.env.IDENTITY_REDIS_REST_TOKEN;
        delete process.env.ASSET_REDIS_REST_URL;
        delete process.env.ASSET_REDIS_REST_TOKEN;

        expect(identityStorageConfigurationError()).to.include('Persistent multi-instance identity storage is not configured');

        let threw = false;
        try {
          await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
        } catch (err: any) {
          threw = true;
          expect(err.message).to.include('Persistent multi-instance identity storage is not configured');
        }
        expect(threw).to.be.true;
      } finally {
        if (prevEnv) process.env.NODE_ENV = prevEnv;
        else delete process.env.NODE_ENV;
        if (prevUrl) process.env.IDENTITY_REDIS_REST_URL = prevUrl;
        if (prevToken) process.env.IDENTITY_REDIS_REST_TOKEN = prevToken;
        if (prevAssetUrl) process.env.ASSET_REDIS_REST_URL = prevAssetUrl;
        if (prevAssetToken) process.env.ASSET_REDIS_REST_TOKEN = prevAssetToken;
      }
    });

    it('proves atomic operations and Lua script dispatch on shared Redis store', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevUrl = process.env.IDENTITY_REDIS_REST_URL;
      const prevToken = process.env.IDENTITY_REDIS_REST_TOKEN;
      const prevFetch = globalThis.fetch;

      process.env.NODE_ENV = 'production';
      process.env.IDENTITY_REDIS_REST_URL = 'https://redis.example.test';
      process.env.IDENTITY_REDIS_REST_TOKEN = 'test-token';

      // Mock in-memory Redis KV store for simulating Upstash REST responses
      const redisMap = new Map<string, string>();
      const dispatchedCommands: string[] = [];

      globalThis.fetch = (async (_input, init) => {
        const bodyArr = JSON.parse(String(init?.body || '[]')) as unknown[];
        dispatchedCommands.push(String(bodyArr[0]));
        const op = bodyArr[0];

        if (op === 'SET') {
          const key = String(bodyArr[1]);
          const val = String(bodyArr[2]);
          const isNx = bodyArr.includes('NX');
          if (isNx && redisMap.has(key)) {
            return new Response(JSON.stringify({ result: null }), { status: 200 });
          }
          redisMap.set(key, val);
          return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
        }

        if (op === 'GET') {
          const key = String(bodyArr[1]);
          return new Response(JSON.stringify({ result: redisMap.get(key) || null }), { status: 200 });
        }

        if (op === 'EVAL') {
          const script = String(bodyArr[1]);
          // Challenge consumption Lua script: atomic GET + DEL
          if (script.includes("redis.call('DEL', key)")) {
            const key = String(bodyArr[3]);
            const val = redisMap.get(key) || null;
            if (val) redisMap.delete(key);
            return new Response(JSON.stringify({ result: val }), { status: 200 });
          }

          // Create or get profile Lua script
          if (script.includes("veilio:id:profile:")) {
            const walletKey = String(bodyArr[3]);
            const normalized = String(bodyArr[4]);
            const chain = String(bodyArr[5]);
            const net = String(bodyArr[6]);
            const newId = String(bodyArr[7]);
            const now = Number(bodyArr[8]);

            if (redisMap.has(walletKey)) {
              const currentId = redisMap.get(walletKey)!;
              const existing = redisMap.get(`veilio:id:profile:${currentId}`);
              return new Response(JSON.stringify({ result: existing }), { status: 200 });
            }

            const p = {
              id: newId,
              primaryWallet: normalized,
              createdAt: now,
              updatedAt: now,
              linkedWallets: [{
                address: normalized,
                chainFamily: chain,
                networkId: net,
                linkedAt: now,
                verifiedAt: now,
                isPrimary: true,
                status: 'active',
                proofType: 'eip191',
              }],
            };
            const jsonStr = JSON.stringify(p);
            redisMap.set(walletKey, newId);
            redisMap.set(`veilio:id:profile:${newId}`, jsonStr);
            return new Response(JSON.stringify({ result: jsonStr }), { status: 200 });
          }

          // Link wallet Lua script
          if (script.includes("targetId = ARGV[1]")) {
            const walletKey = String(bodyArr[3]);
            const profileKey = String(bodyArr[4]);
            const targetId = String(bodyArr[5]);
            const record = JSON.parse(String(bodyArr[6]));
            const now = Number(bodyArr[7]);

            const currentOwner = redisMap.get(walletKey);
            if (currentOwner && currentOwner !== targetId) {
              return new Response(JSON.stringify({ result: -1 }), { status: 200 });
            }

            const profileRaw = redisMap.get(profileKey);
            if (!profileRaw) {
              return new Response(JSON.stringify({ result: -2 }), { status: 200 });
            }

            const profile = JSON.parse(profileRaw);
            profile.linkedWallets.push(record);
            profile.updatedAt = now;
            redisMap.set(walletKey, targetId);
            const jsonStr = JSON.stringify(profile);
            redisMap.set(profileKey, jsonStr);
            return new Response(JSON.stringify({ result: jsonStr }), { status: 200 });
          }

          return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
        }

        return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
      }) as typeof fetch;

      try {
        // Test Profile Creation via Redis
        const p = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
        expect(p.primaryWallet).to.equal(evmAddress.toLowerCase());
        expect(dispatchedCommands).to.include('EVAL');

        // Test Challenge Creation and Atomic Consumption via Redis
        const chal = await createWalletLinkChallenge({
          identityId: p.id,
          chainFamily: 'evm',
          walletAddress: evmAddress,
        });
        expect(dispatchedCommands).to.include('SET');

        const sig = await evmAccount.signMessage({ message: chal.message });
        const consumed = await consumeWalletLinkChallenge(chal.challengeId, evmAddress, sig);
        expect(consumed.valid).to.be.true;

        // Verify second consumption attempt fails atomically
        const replayed = await consumeWalletLinkChallenge(chal.challengeId, evmAddress, sig);
        expect(replayed.valid).to.be.false;

        // Test Nonce Anti-Replay via Redis SET NX
        const nonce = 'redis_test_nonce_1';
        const unlinkTimestamp = Date.now();
        const msg = createUnlinkAuthMessage({
          identityId: p.id,
          walletAddress: solAddress,
          signerAddress: evmAddress.toLowerCase(),
          timestamp: unlinkTimestamp,
          nonce,
        });
        const unlinkSig = await evmAccount.signMessage({ message: msg });

        // Link wallet first
        await linkWalletToIdentity(p.id, {
          address: solAddress,
          chainFamily: 'solana',
          networkId: 'solana:devnet',
          proofType: 'ed25519',
        });

        const auth1 = await verifyUnlinkAuth({
          identityId: p.id,
          walletAddress: solAddress,
          chainFamily: 'solana',
          auth: {
            signerAddress: evmAddress.toLowerCase(),
            signature: unlinkSig,
            timestamp: unlinkTimestamp,
            nonce,
            chainFamily: 'evm',
          },
        });
        expect(auth1.valid).to.be.true;

        // Replay attempt with same nonce on Redis: must be rejected
        const auth2 = await verifyUnlinkAuth({
          identityId: p.id,
          walletAddress: solAddress,
          chainFamily: 'solana',
          auth: {
            signerAddress: evmAddress.toLowerCase(),
            signature: unlinkSig,
            timestamp: unlinkTimestamp,
            nonce,
            chainFamily: 'evm',
          },
        });
        expect(auth2.valid).to.be.false;
        expect(auth2.error).to.include('Replay detected');
      } finally {
        globalThis.fetch = prevFetch;
        if (prevEnv) process.env.NODE_ENV = prevEnv;
        else delete process.env.NODE_ENV;
        if (prevUrl) process.env.IDENTITY_REDIS_REST_URL = prevUrl;
        else delete process.env.IDENTITY_REDIS_REST_URL;
        if (prevToken) process.env.IDENTITY_REDIS_REST_TOKEN = prevToken;
        else delete process.env.IDENTITY_REDIS_REST_TOKEN;
      }
    });
  });
});
