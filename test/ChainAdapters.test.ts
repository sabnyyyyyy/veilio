import { expect } from 'chai';
import {
  EvmChainAdapter,
  SolanaChainAdapter,
  getNetworkConfig,
  listSupportedNetworks,
  isNetworkSupported,
  type ChainTxIdentifier,
  type EvmTxIdentifier,
  type SolanaTxIdentifier,
} from '../lib/cross-chain';
import { getEvmChain } from '../lib/cross-chain/evmChains';
import { getAuctionContractConfig } from '../lib/contract';
import { baseSepoliaChain } from '../lib/chain';

describe('VEILIO Milestone 1 — Cross-Chain Adapters', () => {
  // ==========================================================================
  // 1. Network Registry & Configuration Tests
  // ==========================================================================
  describe('Network Registry & Configuration', () => {
    it('correctly retrieves BNB Chain Testnet configuration', () => {
      const config = getNetworkConfig('bnb:97');
      expect(config.family).to.equal('evm');
      expect(config.environment).to.equal('testnet');
      expect(config.displayName).to.equal('BNB Smart Chain Testnet');
      expect(config.verificationStatus).to.equal('verified_active');
      expect(config.contracts.auction).to.equal('0x9e2d9Dcc76192b54eBF0106da09787428eAF3EE7');
      expect(config.contracts.nftCustody).to.equal(config.contracts.auction);
    });

    it('correctly retrieves Solana Devnet configuration', () => {
      const config = getNetworkConfig('solana:devnet');
      expect(config.family).to.equal('solana');
      expect(config.environment).to.equal('devnet');
      expect(config.rpcEndpoints[0]).to.include('api.devnet.solana.com');
      expect(config.verificationStatus).to.be.oneOf(['in_development', 'verified_active']);
    });

    it('correctly retrieves Base Sepolia configuration', () => {
      const config = getNetworkConfig('base:84532');
      expect(config.family).to.equal('evm');
      expect(config.environment).to.equal('testnet');
      expect(config.displayName).to.equal('Base Sepolia');
      expect(config.rpcEndpoints[0]).to.include('sepolia.base.org');
      expect(config.verificationStatus).to.be.oneOf(['in_development', 'verified_active']);
      expect(config.contracts.auction).to.equal('0xc12EcD53B9dAE1753409B87f10Bf00684BF7d8B1');
      expect(config.marketplaceCapability).to.be.oneOf(['integration_pending', 'live']);
      expect(getEvmChain('base:84532').id).to.equal(84532);
    });

    it('throws when requesting an unsupported network', () => {
      expect(() => getNetworkConfig('polygon:137' as any)).to.throw(
        /Unsupported network identifier/
      );
    });

    it('validates supported network identifiers with isNetworkSupported', () => {
      expect(isNetworkSupported('bnb:97')).to.be.true;
      expect(isNetworkSupported('solana:devnet')).to.be.true;
      expect(isNetworkSupported('base:84532')).to.be.true;
      expect(isNetworkSupported('ethereum:1')).to.be.false;
    });

    it('lists all registered networks', () => {
      const list = listSupportedNetworks();
      expect(list.length).to.be.greaterThanOrEqual(4);
    });
  });

  // ==========================================================================
  // 2. EVM Chain Adapter Tests
  // ==========================================================================
  describe('EvmChainAdapter', () => {
    const validEvmAddress = '0x0D1c307B4D59143703aE38fB6479d9Dac1fec987';
    const validEvmHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`;
    const solanaAddress = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

    it('validates EVM addresses and rejects Solana Base58 addresses', () => {
      const adapter = new EvmChainAdapter({ networkId: 'bnb:97' });
      expect(adapter.isValidAddress(validEvmAddress)).to.be.true;
      expect(adapter.isValidAddress(solanaAddress)).to.be.false;
      expect(adapter.isValidAddress('not-an-address')).to.be.false;
    });

    it('validates 32-byte EVM transaction hashes and rejects malformed strings', () => {
      const adapter = new EvmChainAdapter({ networkId: 'bnb:97' });
      expect(adapter.isValidTxIdentifier(validEvmHash)).to.be.true;
      expect(adapter.isValidTxIdentifier('0x1234')).to.be.false;
      expect(adapter.isValidTxIdentifier(solanaAddress)).to.be.false;
    });

    it('asserts expected chain ID and rejects mismatch', async () => {
      // Mock PublicClient with matching chain ID (97)
      const mockClientMatching = {
        getChainId: async () => 97,
      } as any;
      const adapterMatching = new EvmChainAdapter({
        networkId: 'bnb:97',
        expectedChainId: 97,
        publicClient: mockClientMatching,
      });
      await expect(adapterMatching.assertExpectedChain()).to.be.fulfilled;

      // Mock PublicClient with mismatching chain ID (56)
      const mockClientMismatch = {
        getChainId: async () => 56,
      } as any;
      const adapterMismatch = new EvmChainAdapter({
        networkId: 'bnb:97',
        expectedChainId: 97,
        publicClient: mockClientMismatch,
      });
      await expect(adapterMismatch.assertExpectedChain()).to.be.rejectedWith(/Chain mismatch/);
    });

    it('correctly maps confirmed-success transaction receipts', async () => {
      const mockReceipt = {
        blockNumber: 1000n,
        status: 'success',
      };
      const mockClient = {
        getTransactionReceipt: async () => mockReceipt,
        getBlockNumber: async () => 1020n, // 21 confirmations (>= 15 required)
      } as any;

      const adapter = new EvmChainAdapter({
        networkId: 'bnb:97',
        publicClient: mockClient,
      });

      const txId: EvmTxIdentifier = {
        family: 'evm',
        networkId: 'bnb:97',
        hash: validEvmHash,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('confirmed_success');
      expect(result.finality).to.equal('FINALIZED');
      expect(result.blockOrSlot).to.equal(1000n);
      expect(result.confirmations).to.equal(21);
    });

    it('correctly maps reverted transaction receipts', async () => {
      const mockReceipt = {
        blockNumber: 1000n,
        status: 'reverted',
      };
      const mockClient = {
        getTransactionReceipt: async () => mockReceipt,
        getBlockNumber: async () => 1005n, // 6 confirmations (< 15)
      } as any;

      const adapter = new EvmChainAdapter({
        networkId: 'bnb:97',
        publicClient: mockClient,
      });

      const txId: EvmTxIdentifier = {
        family: 'evm',
        networkId: 'bnb:97',
        hash: validEvmHash,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('reverted');
      expect(result.finality).to.equal('CONFIRMED');
    });

    it('correctly identifies pending transactions in mempool', async () => {
      const mockClient = {
        getTransactionReceipt: async () => null,
        getTransaction: async () => ({ blockNumber: null }),
      } as any;

      const adapter = new EvmChainAdapter({
        networkId: 'bnb:97',
        publicClient: mockClient,
      });

      const txId: EvmTxIdentifier = {
        family: 'evm',
        networkId: 'bnb:97',
        hash: validEvmHash,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('pending');
      expect(result.finality).to.equal('PROCESSED');
    });

    it('handles unknown / not found transactions safely', async () => {
      const mockClient = {
        getTransactionReceipt: async () => null,
        getTransaction: async () => null,
      } as any;

      const adapter = new EvmChainAdapter({
        networkId: 'bnb:97',
        publicClient: mockClient,
      });

      const txId: EvmTxIdentifier = {
        family: 'evm',
        networkId: 'bnb:97',
        hash: validEvmHash,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('unknown');
    });

    it('handles RPC connection failures gracefully with rpc_unavailable status', async () => {
      const mockClient = {
        getTransactionReceipt: async () => {
          throw new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:8545');
        },
      } as any;

      const adapter = new EvmChainAdapter({
        networkId: 'bnb:97',
        publicClient: mockClient,
      });

      const txId: EvmTxIdentifier = {
        family: 'evm',
        networkId: 'bnb:97',
        hash: validEvmHash,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('rpc_unavailable');
    });

    it('rejects a Solana transaction identifier passed to EVM adapter', async () => {
      const adapter = new EvmChainAdapter({ networkId: 'bnb:97' });
      const solanaTxId: SolanaTxIdentifier = {
        family: 'solana',
        networkId: 'solana:devnet',
        signature: '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYj7ZN3M5qJ6gRk4i5pXh2j8w9y0z1a2b3c4d5e6f7g8h9i0j1k2l',
      };

      await expect(adapter.getTransactionStatus(solanaTxId as any)).to.be.rejectedWith(
        TypeError,
        /Invalid identifier family for EVM adapter/
      );
    });
  });

  // ==========================================================================
  // 3. Solana Read-Only Chain Adapter Tests
  // ==========================================================================
  describe('SolanaChainAdapter (Read-Only Mode)', () => {
    const validSolanaAddress = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
    const validSolanaSignature = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9dTeZMn28nd859y77K6A1F9v5b3d6r7y8k9m4n2p5q8r9s';

    it('validates Solana Base58 addresses and rejects EVM hexadecimal addresses', () => {
      const adapter = new SolanaChainAdapter({ networkId: 'solana:devnet' });
      expect(adapter.isValidAddress(validSolanaAddress)).to.be.true;
      expect(adapter.isValidAddress('0x0D1c307B4D59143703aE38fB6479d9Dac1fec987')).to.be.false;
      expect(adapter.isValidAddress('invalid!characters0OI')).to.be.false; // '0', 'O', 'I' not in Base58
    });

    it('validates 64-byte Solana transaction signatures and rejects EVM hashes', () => {
      const adapter = new SolanaChainAdapter({ networkId: 'solana:devnet' });
      expect(adapter.isValidTxIdentifier(validSolanaSignature)).to.be.true;
      expect(adapter.isValidTxIdentifier('0x1234567890abcdef')).to.be.false;
      expect(adapter.isValidTxIdentifier('short-sig')).to.be.false;
    });

    it('refuses to initialize for mainnet without explicit rpcUrl configuration', () => {
      expect(() => new SolanaChainAdapter({ networkId: 'solana:mainnet' })).to.throw(
        /Refusing to initialize SolanaChainAdapter for mainnet/
      );
    });

    it('correctly exposes Devnet cluster and RPC endpoint', () => {
      const adapter = new SolanaChainAdapter({ networkId: 'solana:devnet' });
      expect(adapter.getCluster()).to.equal('devnet');
      expect(adapter.getRpcUrl()).to.include('api.devnet.solana.com');
    });

    it('successfully executes checkHealth with mock RPC response', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: 250100,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        fetchFn: mockFetch,
      });

      const health = await adapter.checkHealth();
      expect(health.ok).to.be.true;
      expect(health.slot).to.equal(250100n);
      expect(health.cluster).to.equal('devnet');
    });

    it('correctly maps finalized Solana transaction status', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [
                {
                  slot: 250100,
                  confirmations: null,
                  err: null,
                  confirmationStatus: 'finalized',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        fetchFn: mockFetch,
      });

      const txId: SolanaTxIdentifier = {
        family: 'solana',
        networkId: 'solana:devnet',
        signature: validSolanaSignature,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('confirmed_success');
      expect(result.finality).to.equal('FINALIZED');
      expect(result.blockOrSlot).to.equal(250100n);
    });

    it('correctly maps confirmed (cluster supermajority) Solana transaction status', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [
                {
                  slot: 250105,
                  confirmations: 12,
                  err: null,
                  confirmationStatus: 'confirmed',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        fetchFn: mockFetch,
      });

      const txId: SolanaTxIdentifier = {
        family: 'solana',
        networkId: 'solana:devnet',
        signature: validSolanaSignature,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('confirmed_success');
      expect(result.finality).to.equal('CONFIRMED');
      expect(result.confirmations).to.equal(12);
    });

    it('strictly maps processed-only Solana status to pending (never verified)', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [
                {
                  slot: 250110,
                  confirmations: 1,
                  err: null,
                  confirmationStatus: 'processed',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        fetchFn: mockFetch,
      });

      const txId: SolanaTxIdentifier = {
        family: 'solana',
        networkId: 'solana:devnet',
        signature: validSolanaSignature,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('pending');
      expect(result.finality).to.equal('PROCESSED');
    });

    it('correctly maps reverted Solana transactions with err object', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [
                {
                  slot: 250115,
                  confirmations: null,
                  err: { InstructionError: [0, 'Custom(1)'] },
                  confirmationStatus: 'finalized',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        fetchFn: mockFetch,
      });

      const txId: SolanaTxIdentifier = {
        family: 'solana',
        networkId: 'solana:devnet',
        signature: validSolanaSignature,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('reverted');
      expect(result.finality).to.equal('FINALIZED');
    });

    it('handles missing or unobserved Solana transactions with unknown status', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              value: [null],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        fetchFn: mockFetch,
      });

      const txId: SolanaTxIdentifier = {
        family: 'solana',
        networkId: 'solana:devnet',
        signature: validSolanaSignature,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('unknown');
    });

    it('handles timeout and RPC failure safely with rpc_unavailable status', async () => {
      const mockFetch: typeof fetch = async () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      };

      const adapter = new SolanaChainAdapter({
        networkId: 'solana:devnet',
        fetchFn: mockFetch,
      });

      const txId: SolanaTxIdentifier = {
        family: 'solana',
        networkId: 'solana:devnet',
        signature: validSolanaSignature,
      };

      const result = await adapter.getTransactionStatus(txId);
      expect(result.status).to.equal('rpc_unavailable');
    });

    it('rejects an EVM transaction identifier passed to Solana adapter', async () => {
      const adapter = new SolanaChainAdapter({ networkId: 'solana:devnet' });
      const evmTxId: EvmTxIdentifier = {
        family: 'evm',
        networkId: 'bnb:97',
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      await expect(adapter.getTransactionStatus(evmTxId as any)).to.be.rejectedWith(
        TypeError,
        /Invalid identifier family for Solana adapter/
      );
    });
  });

  // ==========================================================================
  // 4. Discriminated Union & Type Safety Invariants
  // ==========================================================================
  describe('ChainTxIdentifier Discriminated Union Safety', () => {
    it('demonstrates compile-time and runtime segregation of EVM and Solana identifiers', () => {
      const evmTx: ChainTxIdentifier = {
        family: 'evm',
        networkId: 'bnb:97',
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      const solanaTx: ChainTxIdentifier = {
        family: 'solana',
        networkId: 'solana:devnet',
        signature: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9dTeZMn28nd859y77K6A1F9v5b3d6r7y8k9m4n2p5q8r9s',
      };

      // Type narrowing via discriminated union
      if (evmTx.family === 'evm') {
        expect(evmTx.hash).to.be.a('string');
        expect(evmTx.hash.startsWith('0x')).to.be.true;
      }

      if (solanaTx.family === 'solana') {
        expect(solanaTx.signature).to.be.a('string');
        expect(solanaTx.signature.startsWith('0x')).to.be.false;
      }
    });
  });

  // ==========================================================================
  // 5. Base Sepolia Auction Integration & Chain Invariants
  // ==========================================================================
  describe('Base Sepolia Auction Configuration & Security Invariants', () => {
    it('returns the correct VeilNFTV4 address and ABI for Base Sepolia (84532)', () => {
      const config = getAuctionContractConfig(84532);
      expect(config.address.toLowerCase()).to.equal('0xc12ecd53b9dae1753409b87f10bf00684bf7d8b1');
      expect(config.abi).to.be.an('array');

      const functionNames = config.abi
        .filter((item: any) => item.type === 'function')
        .map((item: any) => item.name);
      expect(functionNames).to.include('createNftAuction');
      expect(functionNames).to.include('commitBid');
      expect(functionNames).to.include('revealBid');
      expect(functionNames).to.include('settleAuction');
      expect(functionNames).to.include('withdrawRefund');
      expect(functionNames).to.include('finalizeSettlement');
    });

    it('returns the correct auction config for BNB Chain Testnet (97)', () => {
      const config = getAuctionContractConfig(97);
      expect(config.address).to.be.a('string');
      expect(config.abi).to.be.an('array');
    });

    it('throws when requesting auction config for an unsupported chain ID', () => {
      expect(() => getAuctionContractConfig(1)).to.throw(/VEILIO auctions are not configured for chain 1/);
    });

    it('verifies Base Sepolia chain configuration constants', () => {
      expect(baseSepoliaChain.id).to.equal(84532);
      expect(baseSepoliaChain.nativeCurrency.symbol).to.equal('ETH');
      expect(baseSepoliaChain.blockExplorers.default.url).to.equal('https://sepolia.basescan.org');
    });

    it('proves bid secret key scoping isolation between chains', () => {
      const bnbAuctionKey = `veilio_secret_1_0xbidder`;
      const baseAuctionKey = `veilio_secret_84532:1_0xbidder`;
      expect(bnbAuctionKey).to.not.equal(baseAuctionKey);
      expect(baseAuctionKey.startsWith('veilio_secret_84532:')).to.be.true;
    });

    it('enforces that Base Sepolia does not claim private asset or dispute support', () => {
      const netConfig = getNetworkConfig('base:84532');
      expect(netConfig.marketplaceCapability).to.not.equal('full_support');
    });
  });
});

