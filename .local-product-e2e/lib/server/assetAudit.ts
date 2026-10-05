import { createHash, randomUUID } from 'node:crypto';

type AssetAuditEvent = {
  action: 'upload' | 'inspect' | 'download' | 'link';
  result: 'success' | 'denied' | 'error';
  requestId?: string;
  assetType?: string;
  sizeBytes?: number;
  auctionId?: string;
  walletAddress?: string;
  reasonCode?: string;
};

/** Structured, redacted event for the host's central log collector. Never log filenames, data, signatures, keys, or content hashes. */
export function auditAssetEvent(event: AssetAuditEvent) {
  const walletFingerprint = event.walletAddress
    ? createHash('sha256').update(event.walletAddress.toLowerCase()).digest('hex').slice(0, 16)
    : undefined;
  console.info(JSON.stringify({
    event: 'veilio.asset_access',
    timestamp: new Date().toISOString(),
    requestId: event.requestId || randomUUID(),
    action: event.action,
    result: event.result,
    assetType: event.assetType,
    sizeBytes: event.sizeBytes,
    auctionId: event.auctionId,
    walletFingerprint,
    reasonCode: event.reasonCode,
  }));
}
