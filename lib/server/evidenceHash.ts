import crypto from 'crypto';

export interface CanonicalEvidencePackage {
  auctionId: string;
  buyerAddress: string;
  sellerAddress?: string;
  issueCategory: string;
  expectedCondition: string;
  actualCondition: string;
  description: string;
  evidenceReferences: string[];
  requestedResolution: string;
  timestamp: number;
}

/**
 * Normalizes an evidence package into a canonical deterministic object
 * with stable sorted keys, lowercased addresses, and trimmed strings.
 */
export function normalizeEvidencePackage(pkg: CanonicalEvidencePackage): Record<string, unknown> {
  return {
    actualCondition: (pkg.actualCondition || '').trim(),
    auctionId: String(pkg.auctionId || '').trim(),
    buyerAddress: (pkg.buyerAddress || '').toLowerCase().trim(),
    description: (pkg.description || '').trim(),
    evidenceReferences: [...(pkg.evidenceReferences || [])].map((r) => r.trim()).sort(),
    expectedCondition: (pkg.expectedCondition || '').trim(),
    issueCategory: (pkg.issueCategory || '').trim().toLowerCase(),
    requestedResolution: (pkg.requestedResolution || '').trim(),
    sellerAddress: pkg.sellerAddress ? pkg.sellerAddress.toLowerCase().trim() : '',
    timestamp: Number.isSafeInteger(pkg.timestamp) ? pkg.timestamp : 0,
  };
}

/**
 * Computes a deterministic SHA-256 canonical hash formatted as a 0x-hex string.
 * This guarantees that identical evidence content yields the exact same hash,
 * replacing previous random UUID placeholders.
 */
export function computeCanonicalEvidenceHash(pkg: CanonicalEvidencePackage): string {
  const normalized = normalizeEvidencePackage(pkg);
  const canonicalString = JSON.stringify(normalized);
  const hash = crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  return `0x${hash}`;
}
