import fs from 'fs';
import path from 'path';

export interface RefundEvidence {
  auctionId: string;
  buyer: string;
  disputedCriterion: string;
  expectedValue: string;
  actualValue: string;
  reason: string;
  evidenceHash: string; // Used to link to on-chain evidenceHash
  timestamp: number;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db', 'refunds.json');

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

function readDb(): Record<string, RefundEvidence> {
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
  ensureDirectories();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function saveRefundEvidence(evidence: RefundEvidence) {
  const db = readDb();
  db[evidence.auctionId] = evidence;
  writeDb(db);
}

export function getRefundEvidence(auctionId: string): RefundEvidence | null {
  const db = readDb();
  return db[auctionId] || null;
}

export function getAllRefundEvidence(): RefundEvidence[] {
  const db = readDb();
  return Object.values(db);
}
