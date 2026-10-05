import fs from 'fs';
import path from 'path';

export interface AuctionViewStats {
  totalViews: number;
  uniqueVisitors: string[];
  daily: Record<string, number>;
  lastViewedAt: number | null;
}

const FILE = path.join(process.cwd(), 'data', 'db', 'auction-views.json');

function readDb(): Record<string, AuctionViewStats> {
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function writeDb(db: Record<string, AuctionViewStats>) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8');
}

export function recordAuctionView(auctionId: string, visitorId: string) {
  const db = readDb();
  const stats = db[auctionId] ?? { totalViews: 0, uniqueVisitors: [], daily: {}, lastViewedAt: null };
  if (!stats.uniqueVisitors.includes(visitorId)) {
    const now = new Date();
    const day = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    stats.totalViews += 1;
    stats.uniqueVisitors.push(visitorId);
    stats.daily[day] = (stats.daily[day] || 0) + 1;
    stats.lastViewedAt = now.getTime();
    // Keep the aggregate file bounded for an MVP deployment.
    if (stats.uniqueVisitors.length > 10000) stats.uniqueVisitors = stats.uniqueVisitors.slice(-10000);
  }
  db[auctionId] = stats;
  writeDb(db);
  return { totalViews: stats.totalViews, daily: stats.daily, lastViewedAt: stats.lastViewedAt };
}

export function getAuctionViewStats(auctionId: string) {
  const stats = readDb()[auctionId];
  if (!stats) return { totalViews: 0, daily: {}, lastViewedAt: null };
  return { totalViews: stats.totalViews, daily: stats.daily, lastViewedAt: stats.lastViewedAt };
}
