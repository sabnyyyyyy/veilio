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
 */
export function formatServiceRegistryId(idStr: string): `0x${string}` {
  try {
    const hex = stringToHex(idStr);
    return pad(hex, { size: 32, dir: 'right' });
  } catch {
    return ('0x' + Buffer.from(idStr.padEnd(32, '\0')).toString('hex')) as `0x${string}`;
  }
}

/**
 * Creates deterministic canonical metadata object with sorted keys.
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
  createdAt?: number;
}): CanonicalServiceMetadata {
  return {
    id: params.id.trim(),
    seller: params.seller.toLowerCase().trim(),
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
    createdAt: params.createdAt || Date.now(),
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
