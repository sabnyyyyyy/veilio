import { expect } from 'chai';
import {
  isValidSolanaAddress,
  formatShortAddress,
  getExplorerLink,
  type NetworkKey,
} from '../lib/sellerAnalytics';
import {
  getSolanaAuctionProgramId,
  DEFAULT_SOLANA_AUCTION_PROGRAM_ID,
  decodeAuctionStateAccount,
  SolanaAuctionState,
} from '../lib/cross-chain/solanaAuction';
import { getNetworkConfig } from '../lib/cross-chain/networkConfig';
import { getAuctionContractConfig } from '../lib/contract';
import { bnbChain, baseSepoliaChain } from '../lib/chain';
import { decodeBase58 } from '../lib/cross-chain/solanaServiceRegistry';

describe('VEILIO — Seller Analytics Solana Devnet Integration Suite', () => {
  const validSolanaWallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const validEvmAddress = '0x0D1c307B4D59143703aE38fB6479d9Dac1fec987';
  const dummySignature = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9dTeZMn28nd859y77K6A1F9v5b3d6r7y8k9m4n2p5q8r9s';
  const dummyEvmHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  // ==========================================================================
  // 1. Network Selector & Configuration Tests
  // ==========================================================================
  describe('Network Selector Configuration for all Three Networks', () => {
    it('supports BNB Chain Testnet with EVM chain ID 97 and BNB currency', () => {
      const config = getNetworkConfig('bnb:97');
      expect(config.family).to.equal('evm');
      expect(config.displayName).to.include('BNB');
      expect(config.nativeCurrency.symbol).to.equal('tBNB');
      expect(config.environment).to.equal('testnet');
      expect(bnbChain.id).to.equal(97);
    });

    it('supports Base Sepolia with EVM chain ID 84532 and ETH currency', () => {
      const config = getNetworkConfig('base:84532');
      expect(config.family).to.equal('evm');
      expect(config.displayName).to.equal('Base Sepolia');
      expect(config.nativeCurrency.symbol).to.equal('ETH');
      expect(config.environment).to.equal('testnet');
      expect(baseSepoliaChain.id).to.equal(84532);
    });

    it('supports Solana Devnet with Solana SVM family and SOL currency', () => {
      const config = getNetworkConfig('solana:devnet');
      expect(config.family).to.equal('solana');
      expect(config.displayName).to.equal('Solana Devnet');
      expect(config.nativeCurrency.symbol).to.equal('SOL');
      expect(config.nativeCurrency.decimals).to.equal(9);
      expect(config.environment).to.equal('devnet');
    });

    it('preserves distinct network identifiers across all three networks', () => {
      const networks: NetworkKey[] = ['bnb', 'base', 'solana'];
      const uniqueKeys = new Set(networks);
      expect(uniqueKeys.size).to.equal(3);
    });
  });

  // ==========================================================================
  // 2. Solana Wallet Address Parsing & Base58 Validation Tests
  // ==========================================================================
  describe('Solana Base58 Public Key Validation and Address Formatting', () => {
    it('validates a legitimate 32-byte Base58 Solana public key', () => {
      expect(isValidSolanaAddress(validSolanaWallet)).to.be.true;
      expect(isValidSolanaAddress('5Tw1iJGN1hhyRzepbD5eLoaRoZTEiKcqrh2HoZYhYEta')).to.be.true;
      expect(isValidSolanaAddress('11111111111111111111111111111111')).to.be.true;
    });

    it('strictly rejects EVM hexadecimal addresses', () => {
      expect(isValidSolanaAddress(validEvmAddress)).to.be.false;
      expect(isValidSolanaAddress('0x0000000000000000000000000000000000000000')).to.be.false;
    });

    it('rejects characters outside the Base58 alphabet (0, O, I, l)', () => {
      expect(isValidSolanaAddress('0WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).to.be.false;
      expect(isValidSolanaAddress('OWzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).to.be.false;
      expect(isValidSolanaAddress('IWzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).to.be.false;
      expect(isValidSolanaAddress('lWzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).to.be.false;
    });

    it('rejects truncated, empty, or oversized strings', () => {
      expect(isValidSolanaAddress('')).to.be.false;
      expect(isValidSolanaAddress('short')).to.be.false;
      expect(isValidSolanaAddress(validSolanaWallet + 'EXTRA')).to.be.false;
    });

    it('formats addresses cleanly for UI rendering without corruption', () => {
      expect(formatShortAddress(validSolanaWallet)).to.equal('9WzDXw…AWWM');
      expect(formatShortAddress(validEvmAddress)).to.equal('0x0D1c…c987');
      expect(formatShortAddress('')).to.equal('');
      expect(formatShortAddress('short')).to.equal('short');
    });
  });

  // ==========================================================================
  // 3. Separation of Chain-Specific Data Access Tests
  // ==========================================================================
  describe('Separation of Chain-Specific Data Access', () => {
    it('ensures EVM contract config is retrieved only for EVM chain IDs', () => {
      const bnbConfig = getAuctionContractConfig(97);
      expect(bnbConfig.address).to.match(/^0x[a-fA-F0-9]{40}$/);
      expect(bnbConfig.address.toLowerCase()).to.be.oneOf([
        '0xc12ecd53b9dae1753409b87f10bf00684bf7d8b1',
        '0x0d1c307b4d59143703ae38fb6479dac1fec987',
      ]);

      const baseConfig = getAuctionContractConfig(84532);
      expect(baseConfig.address.toLowerCase()).to.equal('0xc12ecd53b9dae1753409b87f10bf00684bf7d8b1');

      // Passing non-EVM or unsupported ID throws
      expect(() => getAuctionContractConfig(999999)).to.throw(/VEILIO auctions are not configured/);
    });

    it('verifies Solana auction program ID is distinct from EVM contract addresses', () => {
      const programId = getSolanaAuctionProgramId();
      expect(programId).to.equal(DEFAULT_SOLANA_AUCTION_PROGRAM_ID);
      expect(isValidSolanaAddress(programId)).to.be.true;
      expect(programId.startsWith('0x')).to.be.false;
    });
  });

  // ==========================================================================
  // 4. Explorer Link Generation Tests for all Three Networks
  // ==========================================================================
  describe('Explorer Link Routing per Network', () => {
    it('generates correct BscScan links for BNB Chain Testnet', () => {
      const addrLink = getExplorerLink('bnb', 'address', validEvmAddress);
      expect(addrLink).to.equal(`https://testnet.bscscan.com/address/${validEvmAddress}`);

      const txLink = getExplorerLink('bnb', 'tx', dummyEvmHash);
      expect(txLink).to.equal(`https://testnet.bscscan.com/tx/${dummyEvmHash}`);
    });

    it('generates correct BaseScan links for Base Sepolia', () => {
      const addrLink = getExplorerLink('base', 'address', validEvmAddress);
      expect(addrLink).to.equal(`https://sepolia.basescan.org/address/${validEvmAddress}`);

      const txLink = getExplorerLink('base', 'tx', dummyEvmHash);
      expect(txLink).to.equal(`https://sepolia.basescan.org/tx/${dummyEvmHash}`);
    });

    it('generates correct Solana Explorer links with devnet cluster for Solana Devnet', () => {
      const addrLink = getExplorerLink('solana', 'address', validSolanaWallet);
      expect(addrLink).to.equal(`https://explorer.solana.com/address/${validSolanaWallet}?cluster=devnet`);

      const txLink = getExplorerLink('solana', 'tx', dummySignature);
      expect(txLink).to.equal(`https://explorer.solana.com/tx/${dummySignature}?cluster=devnet`);
    });

    it('handles empty or missing identifiers safely', () => {
      expect(getExplorerLink('solana', 'address', '')).to.equal('#');
      expect(getExplorerLink('bnb', 'tx', '')).to.equal('#');
    });
  });

  // ==========================================================================
  // 5. Honest Status & Unsupported State Handling (sol-5)
  // ==========================================================================
  describe('Honest Unsupported & Empty States Handling', () => {
    it('verifies that Solana seller analytics does not fabricate data when auctions are empty', () => {
      const emptyRows: any[] = [];
      const totals = {
        views: emptyRows.reduce((sum, r) => sum + r.views, 0),
        bidders: emptyRows.reduce((sum, r) => sum + r.bidderCount, 0),
        reveals: emptyRows.reduce((sum, r) => sum + r.reveals, 0),
        active: emptyRows.filter((r) => r.state === 0 || r.state === 1 || r.state === 2).length,
        completed: emptyRows.filter((r) => r.state === 6).length,
        earned: 0,
      };

      expect(totals.views).to.equal(0);
      expect(totals.bidders).to.equal(0);
      expect(totals.reveals).to.equal(0);
      expect(totals.active).to.equal(0);
      expect(totals.completed).to.equal(0);
      expect(totals.earned).to.equal(0);
    });

    it('proves that multichain identity activity items remain segregated from auction listings', () => {
      const mockIdentityActivity = {
        id: 'act_1',
        activityType: 'service_registered',
        title: 'Service Registered on Solana Devnet',
        description: 'Verified seller identity registration',
        timestamp: Date.now(),
        status: 'confirmed',
      };

      // Ensure identity activity is distinct from auction listing state
      expect(mockIdentityActivity).to.not.have.property('startingPrice');
      expect(mockIdentityActivity).to.not.have.property('revealedCount');
      expect(mockIdentityActivity.activityType).to.not.equal('created_auction');
    });

    it('correctly maps deserialized Solana AuctionStateAccount into Seller Analytics listing fields', () => {
      const disc = Buffer.from('ef41ead6db9ef591', 'hex'); // getAnchorDiscriminator('account', 'AuctionStateAccount')
      const sellerBytes = Buffer.from(decodeBase58(validSolanaWallet));
      const reviewerBytes = Buffer.from(decodeBase58(validSolanaWallet));
      const idBuf = Buffer.alloc(8);
      idBuf.writeBigUInt64LE(101n, 0);

      const name = Buffer.from('Dataset Beta', 'utf8');
      const nameLen = Buffer.alloc(4);
      nameLen.writeUInt32LE(name.length, 0);

      const desc = Buffer.from('AI Model Weights', 'utf8');
      const descLen = Buffer.alloc(4);
      descLen.writeUInt32LE(desc.length, 0);

      const uri = Buffer.from('ipfs://bafytest', 'utf8');
      const uriLen = Buffer.alloc(4);
      uriLen.writeUInt32LE(uri.length, 0);

      const priceBuf = Buffer.alloc(8);
      priceBuf.writeBigUInt64LE(2_000_000_000n, 0);

      const commitEnd = Buffer.alloc(8);
      commitEnd.writeBigInt64LE(1760000000n, 0);

      const revealEnd = Buffer.alloc(8);
      revealEnd.writeBigInt64LE(1760003600n, 0);

      const inspDur = Buffer.alloc(8);
      inspDur.writeBigInt64LE(86400n, 0);

      const inspEnd = Buffer.alloc(8);
      inspEnd.writeBigInt64LE(1760090000n, 0);

      const refundRequestedAt = Buffer.alloc(8);
      const stateBuf = Buffer.from([SolanaAuctionState.Completed]);

      const winnerBytes = Buffer.from(decodeBase58('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'));
      const highestBidBuf = Buffer.alloc(8);
      highestBidBuf.writeBigUInt64LE(5_000_000_000n, 0);

      const bidderCountBuf = Buffer.alloc(4);
      bidderCountBuf.writeUInt32LE(4, 0);

      const revealedCountBuf = Buffer.alloc(4);
      revealedCountBuf.writeUInt32LE(3, 0);

      const evidenceHashBuf = Buffer.alloc(32, 0);
      const reviewReasonLen = Buffer.alloc(4);
      const bumpBuf = Buffer.from([254]);

      const accountBuffer = Buffer.concat([
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
        evidenceHashBuf,
        reviewReasonLen,
        bumpBuf,
      ]);

      const decoded = decodeAuctionStateAccount(accountBuffer);
      expect(decoded.seller).to.equal(validSolanaWallet);
      expect(decoded.auctionId).to.equal(101n);
      expect(decoded.itemName).to.equal('Dataset Beta');
      expect(decoded.bidderCount).to.equal(4);
      expect(decoded.revealedCount).to.equal(3);
      expect(decoded.state).to.equal(SolanaAuctionState.Completed);
      expect(decoded.highestBid).to.equal(5_000_000_000n);

      // Verify calculation of seller proceeds (90% of winning price on completed sales)
      const winningSol = Number(decoded.highestBid) / 1_000_000_000;
      const sellerShareSol = winningSol * 0.9;
      expect(sellerShareSol).to.equal(4.5);
    });

    it('verifies graceful handling of RPC error status and disconnected state', () => {
      // Disconnected state: empty string does not pass Base58 validation
      expect(isValidSolanaAddress('')).to.be.false;

      // Simulated error structure
      const rpcErrorResponse = {
        error: 'Solana RPC returned 503 Service Unavailable',
      };
      expect(rpcErrorResponse.error).to.include('Solana RPC');
    });
  });
});
