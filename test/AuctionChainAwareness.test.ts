import { expect } from 'chai';
import crypto from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createAuctionAuthMessage,
  datasetDownloadMessageFor,
  datasetInspectMessageFor,
  datasetLinkMessageFor,
  datasetPreviewMessageFor,
  isValidAuctionIdForNetwork,
  noWinnerRefundText,
  auctionPlatformFeeBps,
  parseAuctionNetwork,
  sameWallet,
  scopedAuctionKey,
} from '../lib/auctionNetwork';
import { datasetDownloadMessage, datasetInspectMessage, datasetLinkMessage, datasetPreviewMessage } from '../lib/assetAuth';
import { VEIL_V3_CONTRACT_ADDRESS, BASE_SEPOLIA_AUCTION_ADDRESS } from '../lib/contract';
import { getNetworkConfig } from '../lib/cross-chain/networkConfig';
import {
  createCreateAuctionInstruction,
  createRevealBidInstruction,
  createReviewRefundInstruction,
  DEFAULT_SOLANA_AUCTION_PROGRAM_ID,
  findAuctionConfigPda,
  findAuctionPda,
} from '../lib/cross-chain/solanaAuction';
import { decodeBase58, encodeBase58, getAnchorDiscriminator } from '../lib/cross-chain/solanaServiceRegistry';
import { readOnchainAuction } from '../lib/server/auctionChainState';
import { verifyAuctionAuth } from '../lib/server/auctionAuth';
import { verifyWalletSignature, normalizeWalletAddress, sameWalletAddress } from '../lib/server/walletSignature';
import { isDatasetLinkedTo } from '../lib/server/datasetDb';

function solanaKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const address = encodeBase58(publicKey.export({ type: 'spki', format: 'der' }).subarray(12));
  const sign = (message: string) => `0x${crypto.sign(null, Buffer.from(message, 'utf8'), privateKey).toString('hex')}`;
  return { address, sign };
}

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

describe('Auction chain awareness (BNB / Base / Solana)', () => {
  const evm = privateKeyToAccount(`0x${'22'.repeat(32)}`);

  describe('network parsing and keys', () => {
    it('defaults missing network to BNB for backward compatibility and rejects unknown ones', () => {
      expect(parseAuctionNetwork(undefined)).to.equal('bnb:97');
      expect(parseAuctionNetwork('')).to.equal('bnb:97');
      expect(parseAuctionNetwork('base')).to.equal('base:84532');
      expect(parseAuctionNetwork(84532)).to.equal('base:84532');
      expect(parseAuctionNetwork('solana')).to.equal('solana:devnet');
      expect(parseAuctionNetwork('polygon:137')).to.equal(null);
      expect(parseAuctionNetwork({})).to.equal(null);
    });

    it('scopes record keys by network but keeps legacy BNB keys bare', () => {
      expect(scopedAuctionKey('bnb:97', '5')).to.equal('5');
      expect(scopedAuctionKey('base:84532', '5')).to.equal('base:84532:5');
      expect(scopedAuctionKey('solana:devnet', '5')).to.not.equal(scopedAuctionKey('base:84532', '5'));
    });

    it('matches dataset records by (network, auction) and treats legacy records as BNB', () => {
      expect(isDatasetLinkedTo({ auctionId: '5' }, '5', 'bnb:97')).to.equal(true);
      expect(isDatasetLinkedTo({ auctionId: '5' }, '5', 'base:84532')).to.equal(false);
      expect(isDatasetLinkedTo({ auctionId: '5', networkId: 'base:84532' }, '5', 'base:84532')).to.equal(true);
      expect(isDatasetLinkedTo({ auctionId: '5', networkId: 'base:84532' }, '5', 'bnb:97')).to.equal(false);
    });

    it('limits Solana auction IDs to u64', () => {
      expect(isValidAuctionIdForNetwork('18446744073709551615', 'solana:devnet')).to.equal(true);
      expect(isValidAuctionIdForNetwork('18446744073709551616', 'solana:devnet')).to.equal(false);
      expect(isValidAuctionIdForNetwork('18446744073709551616', 'bnb:97')).to.equal(true);
      expect(isValidAuctionIdForNetwork('0', 'bnb:97')).to.equal(false);
    });

    it('compares EVM addresses case-insensitively and Solana keys exactly', () => {
      expect(sameWallet(evm.address, evm.address.toLowerCase(), 'bnb:97')).to.equal(true);
      const sol = solanaKeypair().address;
      expect(sameWallet(sol, sol, 'solana:devnet')).to.equal(true);
      expect(sameWallet(sol, sol.toLowerCase(), 'solana:devnet')).to.equal(false);
      expect(normalizeWalletAddress(sol)).to.equal(sol);
      expect(sameWalletAddress(evm.address.toUpperCase().replace('0X', '0x'), evm.address)).to.equal(true);
    });
  });

  describe('signed asset messages', () => {
    const input = { datasetId: 'd1', auctionId: '7', address: evm.address, timestamp: 1700000000000 };

    it('keeps BNB messages byte-identical to the legacy lib/assetAuth format', () => {
      expect(datasetLinkMessageFor('bnb:97', input)).to.equal(datasetLinkMessage(input));
      expect(datasetInspectMessageFor('bnb:97', input)).to.equal(datasetInspectMessage(input));
      expect(datasetDownloadMessageFor('bnb:97', input)).to.equal(datasetDownloadMessage(input));
      expect(datasetPreviewMessageFor('bnb:97', input)).to.equal(datasetPreviewMessage(input));
    });

    it('binds Base and Solana messages to their own chain/contract so signatures cannot be replayed across chains', () => {
      const base = datasetDownloadMessageFor('base:84532', input);
      expect(base).to.include('Chain ID: 84532');
      expect(base).to.include(BASE_SEPOLIA_AUCTION_ADDRESS.toLowerCase());
      expect(base).to.not.equal(datasetDownloadMessage(input));
      const sol = solanaKeypair().address;
      const solMsg = datasetDownloadMessageFor('solana:devnet', { ...input, address: sol });
      expect(solMsg).to.include('Network: solana:devnet');
      expect(solMsg).to.include(DEFAULT_SOLANA_AUCTION_PROGRAM_ID);
      expect(solMsg).to.include(`Wallet: ${sol}`); // base58 is not lowercased
    });
  });

  describe('wallet signatures', () => {
    it('verifies EIP-191 and ed25519 signatures and rejects mismatches', async () => {
      const message = 'hello veilio';
      const evmSig = await evm.signMessage({ message });
      expect(await verifyWalletSignature({ address: evm.address, message, signature: evmSig })).to.equal(true);
      expect(await verifyWalletSignature({ address: evm.address, message: 'other', signature: evmSig })).to.equal(false);

      const sol = solanaKeypair();
      expect(await verifyWalletSignature({ address: sol.address, message, signature: sol.sign(message) })).to.equal(true);
      expect(await verifyWalletSignature({ address: sol.address, message: 'other', signature: sol.sign(message) })).to.equal(false);
      expect(await verifyWalletSignature({ address: solanaKeypair().address, message, signature: sol.sign(message) })).to.equal(false);
      expect(await verifyWalletSignature({ address: sol.address, message, signature: 'garbage' })).to.equal(false);
    });

    it('verifyAuctionAuth binds action, network and auction, and rejects replays', async () => {
      const timestamp = Date.now();
      const nonce = crypto.randomUUID();
      const message = createAuctionAuthMessage({ action: 'submit-dispute', networkId: 'base:84532', auctionId: '9', address: evm.address, timestamp, nonce });
      const auth = { address: evm.address, signature: await evm.signMessage({ message }), timestamp, nonce };

      const wrongNetwork = await verifyAuctionAuth({ action: 'submit-dispute', networkId: 'bnb:97', auctionId: '9', auth });
      expect(wrongNetwork.valid).to.equal(false);
      const wrongAuction = await verifyAuctionAuth({ action: 'submit-dispute', networkId: 'base:84532', auctionId: '10', auth });
      expect(wrongAuction.valid).to.equal(false);

      const ok = await verifyAuctionAuth({ action: 'submit-dispute', networkId: 'base:84532', auctionId: '9', auth });
      expect(ok.valid).to.equal(true);
      const replay = await verifyAuctionAuth({ action: 'submit-dispute', networkId: 'base:84532', auctionId: '9', auth });
      expect(replay.valid).to.equal(false);
    });

    it('verifyAuctionAuth accepts Solana ed25519 and rejects expired or unsigned requests', async () => {
      const sol = solanaKeypair();
      const timestamp = Date.now();
      const nonce = crypto.randomUUID();
      const message = createAuctionAuthMessage({ action: 'list-refunds', networkId: 'solana:devnet', auctionId: '*', address: sol.address, timestamp, nonce });
      const ok = await verifyAuctionAuth({ action: 'list-refunds', networkId: 'solana:devnet', auctionId: '*', auth: { address: sol.address, signature: sol.sign(message), timestamp, nonce } });
      expect(ok.valid).to.equal(true);

      const expired = await verifyAuctionAuth({ action: 'list-refunds', networkId: 'solana:devnet', auctionId: '*', auth: { address: sol.address, signature: sol.sign(message), timestamp, nonce: crypto.randomUUID() }, now: timestamp + 10 * 60 * 1000 });
      expect(expired.valid).to.equal(false);
      const missing = await verifyAuctionAuth({ action: 'list-refunds', networkId: 'solana:devnet', auctionId: '*', auth: undefined });
      expect(missing.valid).to.equal(false);
      // An EVM address is not a valid signer for a Solana auction.
      const wrongFamily = await verifyAuctionAuth({ action: 'list-refunds', networkId: 'solana:devnet', auctionId: '*', auth: { address: evm.address, signature: '0x00', timestamp, nonce: crypto.randomUUID() } });
      expect(wrongFamily.valid).to.equal(false);
    });
  });

  describe('address / fee / text consistency', () => {
    it('networkConfig BNB auction address matches lib/contract.ts', () => {
      expect(getNetworkConfig('bnb:97').contracts.auction?.toLowerCase()).to.equal(VEIL_V3_CONTRACT_ADDRESS.toLowerCase());
      expect(getNetworkConfig('base:84532').contracts.auction?.toLowerCase()).to.equal(BASE_SEPOLIA_AUCTION_ADDRESS.toLowerCase());
    });

    it('describes no penalty and 7% fee for Solana, 5% penalty and 7% fee for EVM', () => {
      expect(noWinnerRefundText('solana:devnet', 'SOL')).to.not.match(/5%|penalty for unrevealed/);
      expect(noWinnerRefundText('bnb:97', 'BNB')).to.include('5%');
      expect(auctionPlatformFeeBps('solana:devnet')).to.equal(700);
      expect(auctionPlatformFeeBps('base:84532')).to.equal(700);
    });

    it('marks the reveal bidder writable so over-deposit refunds work even with a relayer fee payer', () => {
      const ix = createRevealBidInstruction({
        auctionId: 1n,
        bidder: solanaKeypair().address,
        maxBidLamports: 1n,
        salt: Buffer.alloc(32, 1),
      });
      expect(ix.accounts[2].isSigner).to.equal(true);
      expect(ix.accounts[2].isWritable).to.equal(true);
    });

    it('appends the read-only AuctionConfig PDA last on create_auction and review_refund', () => {
      const seller = solanaKeypair().address;
      const reviewer = solanaKeypair().address;
      const winner = solanaKeypair().address;
      const config = findAuctionConfigPda(DEFAULT_SOLANA_AUCTION_PROGRAM_ID).pda;
      const create = createCreateAuctionInstruction({
        seller, reviewer, auctionId: 7n, itemName: 'x', description: 'y', imageUri: 'z',
        startingPriceLamports: 1n, commitDurationSeconds: 60, revealDurationSeconds: 60, inspectionDurationSeconds: 3600,
      });
      const review = createReviewRefundInstruction({ auctionId: 7n, seller, reviewer, winner, approve: false, feeRecipient: seller });
      expect(create.accounts[create.accounts.length - 1]).to.deep.equal({ pubkey: config, isSigner: false, isWritable: false });
      expect(review.accounts[5]).to.deep.equal({ pubkey: config, isSigner: false, isWritable: false });
      expect(create.accounts).to.have.length(5);
      expect(review.accounts).to.have.length(8);
    });
  });

  describe('Solana reviewer comes from the on-chain AuctionConfig after the upgrade', () => {
    const programId = DEFAULT_SOLANA_AUCTION_PROGRAM_ID;
    const seller = solanaKeypair().address;
    const storedReviewer = solanaKeypair().address;
    const configReviewer = solanaKeypair().address;
    const auctionId = 4242n;

    function encodeAuction(): Buffer {
      const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
      const u32 = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
      return Buffer.concat([
        getAnchorDiscriminator('account', 'AuctionStateAccount'),
        Buffer.from(decodeBase58(seller)), Buffer.from(decodeBase58(storedReviewer)), u64(auctionId),
        u32(0), u32(0), u32(0), // item name, description, image uri
        u64(1n), u64(1n), u64(2n), u64(3600n), u64(0n), u64(0n), // price, commit/reveal end, insp dur/end, refund requested
        Buffer.from([4]), Buffer.alloc(32), u64(0n), u32(0), u32(0), Buffer.alloc(32), u32(0), Buffer.from([255]),
      ]);
    }

    function encodeConfig(): Buffer {
      return Buffer.concat([
        getAnchorDiscriminator('account', 'AuctionConfig'),
        Buffer.from(decodeBase58(solanaKeypair().address)), Buffer.from(decodeBase58(configReviewer)), Buffer.from([254]),
      ]);
    }

    async function withRpc<T>(withConfig: boolean, fn: () => Promise<T>): Promise<T> {
      const auctionPda = findAuctionPda(auctionId, programId).pda;
      const configPda = findAuctionConfigPda(programId).pda;
      const original = globalThis.fetch;
      globalThis.fetch = (async (_url: unknown, init: any) => {
        const { params } = JSON.parse(init.body);
        const data = params[0] === auctionPda ? encodeAuction() : params[0] === configPda && withConfig ? encodeConfig() : null;
        const value = data ? { owner: programId, data: [data.toString('base64'), 'base64'] } : null;
        return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: { value } }) };
      }) as unknown as typeof fetch;
      try {
        return await fn();
      } finally {
        globalThis.fetch = original;
      }
    }

    it('uses the config reviewer when the AuctionConfig exists', async () => {
      const snapshot = await withRpc(true, () => readOnchainAuction('solana:devnet', auctionId.toString()));
      expect(snapshot?.reviewer).to.equal(configReviewer);
      expect(snapshot?.storedReviewer).to.equal(storedReviewer);
      expect(snapshot?.reviewerSource).to.equal('onchain-config');
    });

    it('falls back to the per-auction reviewer before the upgrade (no config account)', async () => {
      const snapshot = await withRpc(false, () => readOnchainAuction('solana:devnet', auctionId.toString()));
      expect(snapshot?.reviewer).to.equal(storedReviewer);
      expect(snapshot?.reviewerSource).to.equal('auction');
    });
  });

  describe('bid secret persistence', () => {
    const g = globalThis as any;
    let storage: MemoryStorage;
    let secrets: typeof import('../lib/secretStorage');

    before(async () => {
      secrets = await import('../lib/secretStorage');
    });
    beforeEach(() => {
      storage = new MemoryStorage();
      g.window = g.window || {};
      g.localStorage = storage;
    });
    after(() => {
      delete g.localStorage;
      delete g.window;
    });

    const base = { auctionId: '42', bidder: '0xAbC0000000000000000000000000000000000001', maxBid: '1', timestamp: 1 };

    it('stores a pending secret before sending and only discards it on a definite failure', () => {
      secrets.savePendingBidSecret({ ...base, secret: '0x01', commitment: '0xaa' });
      expect(secrets.getBidSecret('42', base.bidder)?.status).to.equal('pending');
      // Wrong commitment: no-op (never deletes a different secret).
      secrets.discardPendingBidSecret('42', base.bidder, '0xbb');
      expect(secrets.getBidSecret('42', base.bidder)?.secret).to.equal('0x01');
      secrets.discardPendingBidSecret('42', base.bidder, '0xaa');
      expect(secrets.getBidSecret('42', base.bidder)).to.equal(null);
    });

    it('never discards a confirmed secret and archives older secrets on retry', () => {
      secrets.savePendingBidSecret({ ...base, secret: '0x01', commitment: '0xaa' });
      secrets.confirmBidSecret('42', base.bidder, '0xhash');
      secrets.discardPendingBidSecret('42', base.bidder, '0xaa');
      expect(secrets.getBidSecret('42', base.bidder)?.status).to.equal('confirmed');

      // A second attempt archives the first secret instead of overwriting it.
      secrets.savePendingBidSecret({ ...base, secret: '0x02', commitment: '0xbb', timestamp: 2 });
      expect(secrets.findBidSecretForCommitment('42', base.bidder, '0xAA')?.secret).to.equal('0x01');
      expect(secrets.findBidSecretForCommitment('42', base.bidder, '0xbb')?.secret).to.equal('0x02');
      // Rejecting the second attempt restores the archived (real) secret.
      secrets.discardPendingBidSecret('42', base.bidder, '0xbb');
      expect(secrets.getBidSecret('42', base.bidder)?.secret).to.equal('0x01');
    });

    it('exports and re-imports secrets', () => {
      secrets.savePendingBidSecret({ ...base, secret: '0x01', commitment: '0xaa' });
      const backup = secrets.exportBidSecrets(base.bidder);
      storage.clear();
      expect(secrets.getBidSecret('42', base.bidder)).to.equal(null);
      expect(secrets.importBidSecrets(backup)).to.equal(1);
      expect(secrets.getBidSecret('42', base.bidder)?.secret).to.equal('0x01');
    });

    it('reads secrets stored by older versions (no status field)', () => {
      storage.setItem(`veilio_secret_42_${base.bidder.toLowerCase()}`, JSON.stringify({ ...base, secret: '0x09', commitment: '0xcc' }));
      expect(secrets.getBidSecret('42', base.bidder)?.secret).to.equal('0x09');
      secrets.discardPendingBidSecret('42', base.bidder, '0xcc');
      expect(secrets.getBidSecret('42', base.bidder)?.secret).to.equal('0x09');
    });
  });
});
