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
  _resetIdentitiesDbForTesting,
  _setIdentityStoreForTesting,
} from '../lib/server/identityDb';
import { getIdentityPersistenceStore } from '../lib/server/identityPersistence';
import { encodeBase58 } from '../lib/cross-chain/solanaServiceRegistry';
import { SolanaChainAdapter } from '../lib/cross-chain/SolanaChainAdapter';

describe('VEILIO — Solana Devnet RPC Recovery & Unified Identity Persistence Regression Suite', () => {
  const evmPrivateKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7dc1a084016e7' as `0x${string}`;
  const evmAccount = privateKeyToAccount(evmPrivateKey);
  const evmAddress = evmAccount.address;

  const { publicKey: solPublicKey, privateKey: solPrivateKey } = crypto.generateKeyPairSync('ed25519');
  const rawSolPub = solPublicKey.export({ type: 'spki', format: 'der' }).subarray(12);
  const solAddress = encodeBase58(rawSolPub);

  const missingIdentityId = 'usr_750cc5dc3207f8fa';

  beforeEach(async () => {
    _setIdentityStoreForTesting(null);
    await _resetIdentitiesDbForTesting();
  });

  afterEach(() => {
    _setIdentityStoreForTesting(null);
  });

  // ==========================================================================
  // 1. Missing Unified Identity Checks (usr_750cc5dc3207f8fa)
  // ==========================================================================
  describe('Missing Unified Identity Invariants', () => {
    it('returns null when querying non-existent identity ID and does not silently invent one', async () => {
      const profile = await getIdentityProfile(missingIdentityId);
      expect(profile).to.be.null;

      // Verify it was not added to the store
      const store = getIdentityPersistenceStore();
      const direct = await store.getProfile(missingIdentityId);
      expect(direct).to.be.null;
    });

    it('rejects wallet-link challenge generation for non-existent identity with clear error', async () => {
      let threw = false;
      try {
        await createWalletLinkChallenge({
          identityId: missingIdentityId,
          chainFamily: 'solana',
          networkId: 'solana:devnet',
          walletAddress: solAddress,
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).to.equal(`Veilio identity ${missingIdentityId} not found`);
      }
      expect(threw).to.be.true;
    });

    it('rejects direct wallet linking to non-existent identity with clear error', async () => {
      let threw = false;
      try {
        await linkWalletToIdentity(missingIdentityId, {
          address: solAddress,
          chainFamily: 'solana',
          networkId: 'solana:devnet',
          proofType: 'ed25519',
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).to.equal(`Veilio identity ${missingIdentityId} not found`);
      }
      expect(threw).to.be.true;
    });
  });

  // ==========================================================================
  // 2. Persisted Unified Identity Lifecycle & Self-Healing Index
  // ==========================================================================
  describe('Persisted Unified Identity Lifecycle & Self-Healing', () => {
    it('creates and persistently retrieves unified identity by wallet and ID', async () => {
      const created = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      expect(created.id).to.match(/^usr_/);
      expect(created.primaryWallet).to.equal(evmAddress.toLowerCase());

      const fetchedById = await getIdentityProfile(created.id);
      expect(fetchedById).to.not.be.null;
      expect(fetchedById?.id).to.equal(created.id);

      const fetchedByWallet = await getIdentityByWallet(evmAddress, 'evm');
      expect(fetchedByWallet).to.not.be.null;
      expect(fetchedByWallet?.id).to.equal(created.id);
    });

    it('self-heals missing walletToIdentity index by scanning linked wallets', async () => {
      const created = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      const store = getIdentityPersistenceStore() as any;

      // Simulate a desynchronized or cleared index
      if (store.ensureDb) {
        const db = store.ensureDb();
        delete db.walletToIdentity[`evm:${evmAddress.toLowerCase()}`];
        delete db.walletToIdentity[evmAddress.toLowerCase()];
        store.saveDb(db);

        // Verify index was wiped
        expect(db.walletToIdentity[`evm:${evmAddress.toLowerCase()}`]).to.be.undefined;

        // Query by wallet: should self-heal and return profile
        const recovered = await getIdentityByWallet(evmAddress, 'evm');
        expect(recovered).to.not.be.null;
        expect(recovered?.id).to.equal(created.id);

        // Verify index was reconstructed
        const dbAfter = store.ensureDb();
        expect(dbAfter.walletToIdentity[`evm:${evmAddress.toLowerCase()}`]).to.equal(created.id);
      }
    });
  });

  // ==========================================================================
  // 3. Solana Devnet Ed25519 Wallet Linking Invariants
  // ==========================================================================
  describe('Solana Devnet Wallet Linking & Cryptographic Proofs', () => {
    it('successfully links a Solana wallet with Ed25519 signature to an existing identity', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        walletAddress: solAddress,
      });

      expect(challenge.intendedIdentityId).to.equal(profile.id);
      expect(challenge.walletAddress).to.equal(solAddress);
      expect(challenge.message).to.include('[VEILIO_SOLANA_LINK_CHALLENGE]');

      // Sign with Ed25519 private key
      const sigBuf = crypto.sign(null, Buffer.from(challenge.message, 'utf8'), solPrivateKey);
      const signature = encodeBase58(sigBuf);

      const consumption = await consumeWalletLinkChallenge(challenge.challengeId, solAddress, signature);
      expect(consumption.valid).to.be.true;
      expect(consumption.identityId).to.equal(profile.id);

      const updated = await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      expect(updated.linkedWallets.some((w) => w.address === solAddress && w.status === 'active')).to.be.true;

      // Confirm retrieval by Solana address
      const retrievedBySol = await getIdentityByWallet(solAddress, 'solana');
      expect(retrievedBySol).to.not.be.null;
      expect(retrievedBySol?.id).to.equal(profile.id);
    });

    it('rejects Solana wallet linking challenge if wallet is already active on another identity', async () => {
      const profile1 = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');
      await linkWalletToIdentity(profile1.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      // Second EVM user tries to link the same Solana wallet
      const otherAccount = privateKeyToAccount('0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1' as `0x${string}`);
      const profile2 = await getOrCreateIdentityForWallet(otherAccount.address, 'evm', 'base:84532');

      let threw = false;
      try {
        await createWalletLinkChallenge({
          identityId: profile2.id,
          chainFamily: 'solana',
          networkId: 'solana:devnet',
          walletAddress: solAddress,
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).to.include('already linked to another Veilio identity');
      }
      expect(threw).to.be.true;
    });

    it('rejects invalid Solana Base58 format during challenge creation', async () => {
      const profile = await getOrCreateIdentityForWallet(evmAddress, 'evm', 'bnb:97');

      // Invalid character in Base58 (0, O, I, l)
      await expect(
        createWalletLinkChallenge({
          identityId: profile.id,
          chainFamily: 'solana',
          networkId: 'solana:devnet',
          walletAddress: 'Invalid0OIl',
        })
      ).to.be.rejectedWith('Invalid Solana Base58 public key format');

      // Truncated key (less than 32 bytes)
      const shortPub = encodeBase58(Buffer.alloc(16));
      await expect(
        createWalletLinkChallenge({
          identityId: profile.id,
          chainFamily: 'solana',
          networkId: 'solana:devnet',
          walletAddress: shortPub,
        })
      ).to.be.rejectedWith('Solana public key must be exactly 32 bytes');
    });
  });

  // ==========================================================================
  // 4. Solana RPC Health Check, Failover & Error Parsing
  // ==========================================================================
  describe('Solana Devnet RPC Resilience & Adapter Error Handling', () => {
    it('reports healthy when RPC returns valid slot height', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: 510319000 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        rpcUrl: 'https://mock.solana.devnet',
        fetchFn: mockFetch,
      });

      const health = await adapter.checkHealth();
      expect(health.ok).to.be.true;
      expect(health.slot).to.equal(510319000n);
    });

    it('reports unavailable on HTTP error (e.g. 503 Service Unavailable or 429 Rate Limit)', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response('Rate limited', { status: 429 });
      };

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        rpcUrl: 'https://mock.solana.devnet',
        fetchFn: mockFetch,
      });

      const health = await adapter.checkHealth();
      expect(health.ok).to.be.false;
      expect(health.slot).to.equal(0n);
    });

    it('reports unavailable on RPC JSON error payload', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32005, message: 'Node is behind by 100 slots' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        rpcUrl: 'https://mock.solana.devnet',
        fetchFn: mockFetch,
      });

      const health = await adapter.checkHealth();
      expect(health.ok).to.be.false;
    });

    it('reports unavailable on fetch timeout or network failure', async () => {
      const mockFetch: typeof fetch = async () => {
        throw new Error('Connection refused / ECONNREFUSED');
      };

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        rpcUrl: 'https://mock.solana.devnet',
        fetchFn: mockFetch,
      });

      const health = await adapter.checkHealth();
      expect(health.ok).to.be.false;
    });

    it('validates address format distinguishing EVM from Solana Base58', () => {
      const adapter = new SolanaChainAdapter({ networkId: 'solana:devnet' });

      // Valid Solana Base58
      expect(adapter.isValidAddress(solAddress)).to.be.true;
      // EVM hex address must be rejected by Solana adapter
      expect(adapter.isValidAddress(evmAddress)).to.be.false;
      // Empty or invalid characters
      expect(adapter.isValidAddress('')).to.be.false;
      expect(adapter.isValidAddress('0OIlinvalid')).to.be.false;
    });

    it('isolates test database from development identities_db.json', async () => {
      const store = getIdentityPersistenceStore() as any;
      if (store.getDbFile) {
        const testDbFile = store.getDbFile();
        expect(testDbFile).to.include('identities_db_test.json');
      }
    });

    it('correctly handles Base58 vectors including leading zeroes', () => {
      // 32-byte key with leading zero bytes
      const zeros32 = Buffer.alloc(32, 0);
      zeros32[31] = 0x01;
      const encZeros = encodeBase58(zeros32);
      expect(encZeros.startsWith('1111111111111111111111111111111')).to.be.true;
      expect(encZeros.endsWith('2')).to.be.true;
    });
  });
});
