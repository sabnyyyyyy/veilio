import { expect } from 'chai';
import {
  isSolanaAddress,
  getMergedActivities,
  saveServiceActivity,
  getServiceActivities,
  type ServiceActivityItem,
} from '../lib/walletStorage';
import { saveUserActivity } from '../lib/secretStorage';

// Mock browser localStorage for node test environment
class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

describe('VEILIO — Dashboard Wallet & Activity Consistency Test Suite', () => {
  const evmAddress = '0x1111111111111111111111111111111111111111';
  const solAddress = '6CMoJyQmBobLTk4M9ZoygMShRB6A6i77e6viq2Lew2KY';

  beforeEach(() => {
    (globalThis as any).window = globalThis;
    (globalThis as any).localStorage = new MockLocalStorage();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  describe('P0: Solana Address Validation & Detection', () => {
    it('validates genuine Solana public key addresses', () => {
      expect(isSolanaAddress(solAddress)).to.be.true;
      expect(isSolanaAddress('5Vj4y8BT74PDe5VwLuDp9agTR5ak4vtZdwxnBfRW3R8s')).to.be.true;
    });

    it('rejects invalid or malformed Solana addresses', () => {
      expect(isSolanaAddress(evmAddress)).to.be.false;
      expect(isSolanaAddress('')).to.be.false;
      expect(isSolanaAddress(null)).to.be.false;
      expect(isSolanaAddress('not-a-sol-address')).to.be.false;
    });
  });

  describe('P1: Service Order Activity Persistence & On-Chain Confirmation Distinction', () => {
    it('saves and retrieves confirmed on-chain service escrow funding', () => {
      const confirmedAct: ServiceActivityItem = {
        id: 'act_dep_100',
        type: 'service_order_funded',
        orderId: 'ord_100',
        title: 'Smart Contract Audit Service',
        amount: '1.5',
        currency: 'BNB',
        userAddress: evmAddress,
        role: 'buyer',
        txHash: '0xabc123',
        networkId: 'bnb:97',
        timestamp: 1000,
        status: 'InProgress',
        isOnChainConfirmed: true,
      };

      saveServiceActivity(confirmedAct);
      const list = getServiceActivities(evmAddress);
      expect(list.length).to.equal(1);
      expect(list[0].id).to.equal('act_dep_100');
      expect(list[0].isOnChainConfirmed).to.be.true;
      expect(list[0].status).to.equal('InProgress');
    });

    it('distinguishes unfunded payment requests from confirmed on-chain escrow orders', () => {
      const unfundedRequest: ServiceActivityItem = {
        id: 'pr_55',
        type: 'payment_request_created',
        orderId: 'pr_55',
        title: 'Custom Feature Payment Request',
        amount: '0.8',
        currency: 'ETH',
        userAddress: evmAddress,
        role: 'seller',
        networkId: 'base:84532',
        timestamp: 500,
        status: 'AwaitingPayment',
        isOnChainConfirmed: false,
      };

      const fundedOrder: ServiceActivityItem = {
        id: 'act_dep_55',
        type: 'service_order_funded',
        orderId: 'ord_55',
        title: 'Custom Feature Escrow Funded',
        amount: '0.8',
        currency: 'ETH',
        userAddress: evmAddress,
        role: 'buyer',
        txHash: '0xbase999',
        networkId: 'base:84532',
        timestamp: 800,
        status: 'InProgress',
        isOnChainConfirmed: true,
      };

      saveServiceActivity(unfundedRequest);
      saveServiceActivity(fundedOrder);

      const activities = getMergedActivities(evmAddress, null);
      expect(activities.length).to.equal(2);

      const unconfirmed = activities.find((a) => a.id === 'pr_55');
      const confirmed = activities.find((a) => a.id === 'act_dep_55');

      expect(unconfirmed).to.exist;
      expect(unconfirmed?.isOnChainConfirmed).to.be.false;
      expect(unconfirmed?.status).to.equal('AwaitingPayment');

      expect(confirmed).to.exist;
      expect(confirmed?.isOnChainConfirmed).to.be.true;
      expect(confirmed?.status).to.equal('InProgress');
    });

    it('merges auction and service activities across both EVM and Solana', () => {
      // 1. Add auction activity for EVM
      saveUserActivity({
        id: 'act_auc_1',
        type: 'bid_committed',
        auctionId: '10',
        itemName: 'Rare Domain NFT',
        amount: '0.5',
        timestamp: 300,
        userAddress: evmAddress,
      });

      // 2. Add service escrow activity for Solana
      saveServiceActivity({
        id: 'act_sol_dep_1',
        type: 'service_order_funded',
        orderId: 'sol_ord_1',
        title: 'Rust Anchor Program Audit',
        amount: '2.0',
        currency: 'SOL',
        userAddress: solAddress,
        role: 'buyer',
        txHash: '5SigTestOnSolana',
        networkId: 'solana:devnet',
        timestamp: 600,
        status: 'InProgress',
        isOnChainConfirmed: true,
      });

      const merged = getMergedActivities(evmAddress, solAddress);
      expect(merged.length).to.equal(2);

      // Verify sorted newest first
      expect(merged[0].id).to.equal('act_sol_dep_1');
      expect(merged[0].kind).to.equal('service');
      expect(merged[0].href).to.equal('/services/orders/sol_ord_1');

      expect(merged[1].id).to.equal('act_auc_1');
      expect(merged[1].kind).to.equal('auction');
      expect(merged[1].href).to.equal('/auctions/10');
    });

    it('works when ONLY Solana wallet is connected without EVM address', () => {
      saveServiceActivity({
        id: 'act_sol_only',
        type: 'service_order_funded',
        orderId: 'sol_only_order',
        title: 'Solana Devnet Service Order',
        amount: '5.0',
        currency: 'SOL',
        userAddress: solAddress,
        role: 'buyer',
        networkId: 'solana:devnet',
        timestamp: 900,
        status: 'InProgress',
        isOnChainConfirmed: true,
      });

      // evmAddress is null, solAddress is provided
      const merged = getMergedActivities(null, solAddress);
      expect(merged.length).to.equal(1);
      expect(merged[0].targetId).to.equal('sol_only_order');
      expect(merged[0].userAddress).to.equal(solAddress);
      expect(merged[0].isOnChainConfirmed).to.be.true;
    });
  });
});
