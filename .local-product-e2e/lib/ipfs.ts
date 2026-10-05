/**
 * Helper utility for IPFS URI resolution & uploading via server route.
 *
 * resolveIpfsUri() routes all ipfs:// and /ipfs/ URIs through the
 * local Next.js proxy at /api/ipfs/proxy?cid=... so that browser
 * requests never hit public IPFS gateways directly (avoids 429, 403,
 * CORP and CORS errors).
 *
 * Plain HTTP/HTTPS URLs are returned unchanged.
 */

/**
 * Converts an IPFS or local URI into a URL safe for browser <img> tags and fetch().
 *
 * - ipfs://CID     → /api/ipfs/proxy?cid=CID  (server-side proxy, avoids 429/CORS)
 * - /ipfs/CID      → /api/ipfs/proxy?cid=CID
 * - /uploads/...   → /uploads/... (local file storage fallback, returned unchanged)
 * - https://...    → unchanged
 * - undefined / '' → '' (callers show their own placeholder — do NOT hide broken
 *                    IPFS images behind a fake stock photo)
 */
export function resolveIpfsUri(uri?: string): string {
  if (!uri) return '';

  if (uri.startsWith('ipfs://')) {
    const cid = uri.replace('ipfs://', '');
    return `/api/ipfs/proxy?cid=${encodeURIComponent(cid)}`;
  }

  if (uri.startsWith('/ipfs/')) {
    const cid = uri.replace('/ipfs/', '');
    return `/api/ipfs/proxy?cid=${encodeURIComponent(cid)}`;
  }

  // /uploads/... or https://... or any other plain URL — return as-is
  return uri;
}


export interface IpfsUploadResponse {
  success: boolean;
  cid: string;
  uri: string;
  gatewayUrl: string;
  error?: string;
}

/**
 * Uploads an image File to IPFS via the Next.js server-side API route.
 */
export async function uploadImageToIpfs(file: File): Promise<IpfsUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'image');

  const res = await fetch('/api/ipfs/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to upload image to IPFS');
  }

  return res.json();
}

/**
 * Uploads auction metadata JSON to IPFS via the Next.js server-side API route.
 */
export async function uploadMetadataToIpfs(metadata: {
  name: string;
  description: string;
  image?: string;
  startingPrice?: string;
  dataset?: {
    datasetId: string;
    fileName: string;
    size: number;
    fileHashHex: string;
    mimeType: string;
    manifest?: {
      format: string;
      recordCount: number;
      columnCount: number;
      columns: string[];
    };
  };
  asset?: Record<string, unknown>;
}): Promise<IpfsUploadResponse> {
  const res = await fetch('/api/ipfs/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'metadata',
      metadata,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to upload metadata to IPFS');
  }

  return res.json();
}
