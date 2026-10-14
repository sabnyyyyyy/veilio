import fs from 'fs';
import path from 'path';
import { getDataDir } from './dataDir';
import { readJsonStore, writeJsonStore } from './jsonStore';
import { DEFAULT_AUCTION_NETWORK, scopedAuctionKey, type AuctionNetworkId } from '../auctionNetwork';

export interface RefundEvidence {
  auctionId: string;
  buyer: string;
  disputedCriterion: string;
  expectedValue: string;
  actualValue: string;
  reason: string;
  evidenceHash: string; // Used to link to on-chain evidenceHash
  timestamp: number;
  /** Missing on records written before multi-chain support: those are BNB (`bnb:97`). */
  networkId?: AuctionNetworkId;
}

const DATA_DIR = getDataDir();
const DB_FILE = path.join(DATA_DIR, 'db', 'refunds.json');

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

function readDb(): Record<string, RefundEvidence> {
  const stored = readJsonStore<Record<string, RefundEvidence>>('refunds');
  if (stored !== undefined) return stored || {};

  ensureDirectories();
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading refunds DB:', err);
    return {};
  }
}

function writeDb(data: Record<string, RefundEvidence>) {
  if (writeJsonStore('refunds', data)) return;
  ensureDirectories();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function withNetwork(evidence: RefundEvidence): RefundEvidence & { networkId: AuctionNetworkId } {
  return { ...evidence, networkId: evidence.networkId || DEFAULT_AUCTION_NETWORK };
}

/** Records are keyed by `networkId:auctionId` (bare auctionId for BNB, matching legacy records). */
export function saveRefundEvidence(evidence: RefundEvidence) {
  const db = readDb();
  const networkId = evidence.networkId || DEFAULT_AUCTION_NETWORK;
  db[scopedAuctionKey(networkId, evidence.auctionId)] = { ...evidence, networkId };
  writeDb(db);
}

export function getRefundEvidence(auctionId: string, networkId: AuctionNetworkId = DEFAULT_AUCTION_NETWORK): RefundEvidence | null {
  const db = readDb();
  const record = db[scopedAuctionKey(networkId, auctionId)];
  return record && (record.networkId || DEFAULT_AUCTION_NETWORK) === networkId ? withNetwork(record) : null;
}

export function getAllRefundEvidence(): Array<RefundEvidence & { networkId: AuctionNetworkId }> {
  const db = readDb();
  return Object.values(db).map(withNetwork);
}
