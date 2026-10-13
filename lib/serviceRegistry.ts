import { sha256, toHex, stringToHex, pad } from 'viem';

export interface CanonicalServiceMetadata {
  id: string;
  seller: string;
  sellerType: 'human' | 'agent';
  sellerName: string;
  title: string;
  description: string;
  category: string;
  price: string;
  currency: string;
  deliveryTime: string;
  sampleDeliverables: string[];
  version: string;
  createdAt: number;
}

/**
 * Formats human-readable string ID into bytes32 representation for on-chain contract.
 * Throws for ids longer than 32 UTF-8 bytes (the old fallback silently produced a value
 * longer than bytes32 that could never match the on-chain record).
 */
export function formatServiceRegistryId(idStr: string): `0x${string}` {
  const hex = stringToHex(idStr);
  if ((hex.length - 2) / 2 > 32) {
    throw new Error(`Service id "${idStr}" exceeds 32 bytes and cannot be used as a bytes32 registry id`);
  }
  return pad(hex, { size: 32, dir: 'right' });
}

/**
 * Creates deterministic canonical metadata object with sorted keys.
 *
 * `createdAt` is REQUIRED and is part of the hash: the create page generates it once,
 * hashes it into the on-chain metadataHash, sends it to POST /api/services, the DB stores
 * it verbatim, and every verifier (API GET, agent API, serviceRegistryVerification)
 * passes the stored value back in. There is deliberately no Date.now() default, because
 * a default made every caller hash a different timestamp.
 *
 * Seller: EVM (0x) addresses are lowercased; Solana base58 keys are case-sensitive and
 * kept verbatim.
 */
export function buildCanonicalMetadata(params: {
  id: string;
  seller: string;
  sellerType: 'human' | 'agent';
  sellerName: string;
  title: string;
  description: string;
  category: string;
  price: string;
  currency: string;
  deliveryTime: string;
  sampleDeliverables: string[];
  createdAt: number;
}): CanonicalServiceMetadata {
  if (!Number.isSafeInteger(params.createdAt) || params.createdAt <= 0) {
    throw new Error('buildCanonicalMetadata: createdAt must be a positive integer millisecond timestamp');
  }
  const seller = params.seller.trim();
  return {
    id: params.id.trim(),
    seller: /^0x[0-9a-fA-F]{40}$/.test(seller) ? seller.toLowerCase() : seller,
    sellerType: params.sellerType,
    sellerName: params.sellerName.trim(),
    title: params.title.trim(),
    description: params.description.trim(),
    category: params.category.trim(),
    price: String(Number(params.price)),
    currency: params.currency.toUpperCase().trim(),
    deliveryTime: params.deliveryTime.trim(),
    sampleDeliverables: (params.sampleDeliverables || []).map((s) => s.trim()).filter((s) => s.length > 0),
    version: '1.0.0',
    createdAt: params.createdAt,
  };
}

/**
 * Computes deterministic SHA-256 content hash of canonical metadata.
 */
export function hashCanonicalMetadata(metadata: CanonicalServiceMetadata): `0x${string}` {
  const canonicalString = JSON.stringify({
    category: metadata.category,
    createdAt: metadata.createdAt,
    currency: metadata.currency,
    deliveryTime: metadata.deliveryTime,
    description: metadata.description,
    id: metadata.id,
    price: metadata.price,
    sampleDeliverables: metadata.sampleDeliverables,
    seller: metadata.seller,
    sellerName: metadata.sellerName,
    sellerType: metadata.sellerType,
    title: metadata.title,
    version: metadata.version,
  });

  return sha256(toHex(canonicalString));
}

/**
 * Verifies whether provided metadata matches expected on-chain content hash.
 */
export function verifyMetadataHash(
  metadata: CanonicalServiceMetadata,
  expectedHash: string
): boolean {
  if (!expectedHash || !/^0x[a-fA-F0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  const computed = hashCanonicalMetadata(metadata);
  return computed.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Sanitizes untrusted seller text inputs before feeding into AI context
 * to protect against adversarial prompt injection and delimiter hijacking.
 */
export function sanitizeSellerPromptInput(text: string): string {
  if (!text) return '';
  return text
    .replace(/<system>[\s\S]*?<\/system>/gi, '')
    .replace(/<\/?(script|iframe|prompt|instruction|override)>/gi, '')
    .replace(/\[(SYSTEM|INST|INSTRUCTION|OVERRIDE)\][\s\S]*?\[\/(SYSTEM|INST|INSTRUCTION|OVERRIDE)\]/gi, '')
    .replace(/```[a-z]*\s*(system|instruction|ignore all)[\s\S]*?```/gi, '')
    .trim();
}
