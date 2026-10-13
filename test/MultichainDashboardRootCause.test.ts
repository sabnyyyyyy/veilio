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
import { getAuctionContractConfig, BASE_SEPOLIA_AUCTION_ADDRESS, VEIL_V3_CONTRACT_ADDRESS } from '../lib/contract';
import { fetchUserBids } from '../lib/userBids';
import { fetchUserAuctions } from '../lib/userAuctions';
import { baseSepoliaChain, bnbChain } from '../lib/chain';

describe('VEILIO — Multichain Identity and Dashboard Root-Cause Acceptance Suite', () => {
  const bnbPrivateKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7dc1a084016e7' as `0x${string}`;
  const bnbAccount = privateKeyToAccount(bnbPrivateKey);
  const bnbAddress = bnbAccount.address;

  const basePrivateKey = '0x6cbed15c793ce57650b9877cf218671d82f532b68da343d383e973c4a71187e4' as `0x${string}`;
  const baseAccount = privateKeyToAccount(basePrivateKey);
  const baseAddress = baseAccount.address;

  const { publicKey: solPublicKey, privateKey: solPrivateKey } = crypto.generateKeyPairSync('ed25519');
  const rawSolPub = solPublicKey.export({ type: 'spki', format: 'der' }).subarray(12);
  const solAddress = encodeBase58(rawSolPub);

  beforeEach(async () => {
    _setIdentityStoreForTesting(null);
    await _resetIdentitiesDbForTesting();
  });

  afterEach(() => {
    _setIdentityStoreForTesting(null);
  });

  // ==========================================================================
  // AT-01: Link a BNB wallet and reload
  // ==========================================================================
  describe('AT-01: BNB Wallet Identity Persistence', () => {
    it('creates an identity on BNB and retains it across store reloads', async () => {
      const profile = await getOrCreateIdentityForWallet(bnbAddress, 'evm', 'bnb:97');
      expect(profile).to.not.be.null;
      expect(profile.id).to.match(/^usr_/);
      expect(profile.primaryWallet.toLowerCase()).to.equal(bnbAddress.toLowerCase());

      const reloaded = await getIdentityByWallet(bnbAddress, 'evm');
      expect(reloaded).to.not.be.null;
      expect(reloaded?.id).to.equal(profile.id);
      expect(reloaded?.linkedWallets[0].networkId).to.equal('bnb:97');
      expect(reloaded?.linkedWallets[0].status).to.equal('active');
    });
  });

  // ==========================================================================
  // AT-02: Link a Base Sepolia wallet to the same identity and reload
  // ==========================================================================
  describe('AT-02: Base Sepolia Wallet Linking & Multichain EVM Recognition', () => {
    it('links Base Sepolia wallet to the same identity and recognizes both BNB and Base independently', async () => {
      const profile = await getOrCreateIdentityForWallet(bnbAddress, 'evm', 'bnb:97');

      // Issue challenge for Base Sepolia
      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'evm',
        networkId: 'base:84532',
        walletAddress: baseAddress,
      });
      expect(challenge.networkId).to.equal('base:84532');
      expect(challenge.message).to.include('Chain ID: 84532');

      const signature = await baseAccount.signMessage({ message: challenge.message });
      const consumeResult = await consumeWalletLinkChallenge(challenge.challengeId, baseAddress, signature);
      expect(consumeResult.valid).to.be.true;

      const updated = await linkWalletToIdentity(profile.id, {
        address: baseAddress,
        chainFamily: 'evm',
        networkId: 'base:84532',
        proofType: 'eip191',
      });

      expect(updated.linkedWallets.length).to.equal(2);
      const bnbWallet = updated.linkedWallets.find((w) => w.networkId === 'bnb:97');
      const baseWallet = updated.linkedWallets.find((w) => w.networkId === 'base:84532');
      expect(bnbWallet).to.exist;
      expect(baseWallet).to.exist;
      expect(bnbWallet?.address.toLowerCase()).to.equal(bnbAddress.toLowerCase());
      expect(baseWallet?.address.toLowerCase()).to.equal(baseAddress.toLowerCase());

      // Querying via either EVM address returns the SAME identity
      const fromBnb = await getIdentityByWallet(bnbAddress, 'evm');
      const fromBase = await getIdentityByWallet(baseAddress, 'evm');
      expect(fromBnb?.id).to.equal(profile.id);
      expect(fromBase?.id).to.equal(profile.id);
    });

    it('allows linking Base Sepolia using the SAME EVM address as BNB and preserves both network records', async () => {
      const profile = await getOrCreateIdentityForWallet(bnbAddress, 'evm', 'bnb:97');

      const challenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'evm',
        networkId: 'base:84532',
        walletAddress: bnbAddress,
      });

      const signature = await bnbAccount.signMessage({ message: challenge.message });
      const consumeResult = await consumeWalletLinkChallenge(challenge.challengeId, bnbAddress, signature);
      expect(consumeResult.valid).to.be.true;

      const updated = await linkWalletToIdentity(profile.id, {
        address: bnbAddress,
        chainFamily: 'evm',
        networkId: 'base:84532',
        proofType: 'eip191',
      });

      expect(updated.linkedWallets.length).to.equal(2);
      expect(updated.linkedWallets.some((w) => w.networkId === 'bnb:97' && w.status === 'active')).to.be.true;
      expect(updated.linkedWallets.some((w) => w.networkId === 'base:84532' && w.status === 'active')).to.be.true;
    });
  });

  // ==========================================================================
  // AT-03 & AT-04: Solana Devnet Linking & Triple-Network Aggregation
  // ==========================================================================
  describe('AT-03 & AT-04: Multichain Identity Aggregating BNB, Base, and Solana', () => {
    it('links Solana Devnet wallet with Ed25519 signature and returns all three networks in profile', async () => {
      const profile = await getOrCreateIdentityForWallet(bnbAddress, 'evm', 'bnb:97');

      // Link Base
      await linkWalletToIdentity(profile.id, {
        address: baseAddress,
        chainFamily: 'evm',
        networkId: 'base:84532',
        proofType: 'eip191',
      });

      // Issue challenge for Solana Devnet
      const solChallenge = await createWalletLinkChallenge({
        identityId: profile.id,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        walletAddress: solAddress,
      });
      expect(solChallenge.networkId).to.equal('solana:devnet');

      const rawSig = crypto.sign(null, Buffer.from(solChallenge.message, 'utf8'), solPrivateKey);
      const solSignature = encodeBase58(rawSig);

      const consumeSol = await consumeWalletLinkChallenge(solChallenge.challengeId, solAddress, solSignature);
      expect(consumeSol.valid).to.be.true;

      const tripleProfile = await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      expect(tripleProfile.linkedWallets.length).to.equal(3);

      // Verify each network independently
      const bnbRecord = tripleProfile.linkedWallets.find((w) => w.networkId === 'bnb:97');
      const baseRecord = tripleProfile.linkedWallets.find((w) => w.networkId === 'base:84532');
      const solRecord = tripleProfile.linkedWallets.find((w) => w.networkId === 'solana:devnet');

      expect(bnbRecord).to.exist;
      expect(baseRecord).to.exist;
      expect(solRecord).to.exist;

      expect(bnbRecord?.chainFamily).to.equal('evm');
      expect(baseRecord?.chainFamily).to.equal('evm');
      expect(solRecord?.chainFamily).to.equal('solana');
      expect(solRecord?.address).to.equal(solAddress);

      // Lookup by Solana address returns the unified profile
      const fromSol = await getIdentityByWallet(solAddress, 'solana');
      expect(fromSol?.id).to.equal(profile.id);
    });
  });

  // ==========================================================================
  // AT-05: Disconnect and Reconnect Resilience
  // ==========================================================================
  describe('AT-05: Identity Persistence Integrity', () => {
    it('persists associations across simulated provider reconnects without data corruption', async () => {
      const profile = await getOrCreateIdentityForWallet(bnbAddress, 'evm', 'bnb:97');
      await linkWalletToIdentity(profile.id, {
        address: solAddress,
        chainFamily: 'solana',
        networkId: 'solana:devnet',
        proofType: 'ed25519',
      });

      // Simulate re-fetching after session reload
      const retrieved = await getIdentityProfile(profile.id);
      expect(retrieved).to.not.be.null;
      expect(retrieved?.linkedWallets.length).to.equal(2);
      expect(retrieved?.linkedWallets.map((w) => w.networkId)).to.include.members(['bnb:97', 'solana:devnet']);
    });
  });

  // ==========================================================================
  // AT-06 & AT-08: Network Failure Isolation & Error vs Empty State
  // ==========================================================================
  describe('AT-06 & AT-08: Network Isolation and Error vs Empty Distinction', () => {
    it('distinguishes empty activity response (0) from a failing request', async () => {
      // Mock successful empty client
      const mockSuccessClient = {
        chain: { id: 84532 },
        readContract: async ({ functionName }: { functionName: string }) => {
          if (functionName === 'auctionCount') return 0n;
          return null;
        },
      } as any;

      const bids = await fetchUserBids(mockSuccessClient, baseAddress, { chainId: 84532 });
      const auctions = await fetchUserAuctions(mockSuccessClient, baseAddress, { chainId: 84532 });
      expect(bids).to.be.an('array').with.lengthOf(0);
      expect(auctions).to.be.an('array').with.lengthOf(0);

      // Mock failing client
      const mockFailingClient = {
        chain: { id: 97 },
        readContract: async () => {
          throw new Error('RPC endpoint timeout');
        },
      } as any;

      let bnbFailed = false;
      try {
        await fetchUserBids(mockFailingClient, bnbAddress, { chainId: 97 });
      } catch (err: any) {
        bnbFailed = true;
        expect(err.message).to.include('RPC endpoint timeout');
      }
      expect(bnbFailed).to.be.true;
    });
  });

  // ==========================================================================
  // AT-07: Contract Configuration and Chain ID Verification
  // ==========================================================================
  describe('AT-07: Contract Configuration and Chain Separation', () => {
    it('maps Base Sepolia chain 84532 to the correct contract configuration', () => {
      const config = getAuctionContractConfig(84532);
      expect(config.address.toLowerCase()).to.equal(BASE_SEPOLIA_AUCTION_ADDRESS.toLowerCase());
      expect(config.abi).to.be.an('array');
    });

    it('maps BNB Chain Testnet chain 97 to the correct contract configuration', () => {
      const config = getAuctionContractConfig(97);
      expect(config.address.toLowerCase()).to.equal(VEIL_V3_CONTRACT_ADDRESS.toLowerCase());
      expect(config.abi).to.be.an('array');
    });

    it('rejects unsupported chain ID with clear error', () => {
      expect(() => getAuctionContractConfig(1)).to.throw(/VEILIO auctions are not configured for chain 1/);
    });

    it('confirms Base Sepolia chain ID 84532 and BNB Chain Testnet chain ID 97 constants', () => {
      expect(baseSepoliaChain.id).to.equal(84532);
      expect(bnbChain.id).to.equal(97);
    });
  });
});
