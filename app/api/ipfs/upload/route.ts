import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * POST /api/ipfs/upload
 *
 * Handles two cases:
 *   A) application/json  → upload metadata JSON
 *   B) multipart/form-data → upload image file
 *
 * Priority order for image storage:
 *   1. Pinata IPFS (if PINATA_JWT or PINATA_API_KEY+PINATA_SECRET_API_KEY are set)
 *   2. Local public/uploads/ folder (returns a /uploads/<hash>.<ext> URL that
 *      works immediately without any external service)
 *
 * The old "fake CID" fallback has been removed — it generated a synthetic
 * Qm... hash that was never actually pinned to IPFS, so no gateway could
 * ever serve it.
 */

// Ensure /public/uploads/ exists at startup
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Public auction metadata is permanent and readable by anyone. Keep only fields
 * intended for a public listing; uploaded-file metadata stays in encrypted Redis. */
function publicAuctionMetadata(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'image', 'startingPrice'] as const) {
    const value = input[key];
    if (typeof value === 'string') output[key] = value;
  }

  const source = (input.asset && typeof input.asset === 'object' ? input.asset : input.dataset) as Record<string, unknown> | undefined;
  if (source && typeof source === 'object') {
    const asset: Record<string, unknown> = {};
    for (const key of ['assetType', 'deliveryMethod'] as const) {
      if (typeof source[key] === 'string') asset[key] = source[key];
    }
    // NFT identifiers and the declared license category are public listing facts.
    // Never copy filenames, file IDs, hashes, sizes, manifests, or delivery secrets.
    if (source.assetType === 'nft') {
      for (const key of ['tokenStandard', 'tokenAddress', 'tokenId', 'tokenAmount'] as const) {
        if (typeof source[key] === 'string') asset[key] = source[key];
      }
    }
    if (source.assetType === 'software-license' && typeof source.licenseType === 'string') {
      asset.licenseType = source.licenseType;
    }
    output.asset = asset;
  }
  return output;
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    // ------------------------------------------------------------------
    // CASE A: METADATA JSON UPLOAD
    // ------------------------------------------------------------------
    if (contentType.includes('application/json')) {
      const body = await req.json();
      const metadata = body.metadata;

      if (!metadata) {
        return NextResponse.json({ error: 'Missing metadata object' }, { status: 400 });
      }

      if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        return NextResponse.json({ error: 'Invalid metadata object' }, { status: 400 });
      }
      const publicMetadata = publicAuctionMetadata(metadata as Record<string, unknown>);

      // Try Pinata first
      const pinataJwt = process.env.PINATA_JWT;
      const pinataApiKey = process.env.PINATA_API_KEY;
      const pinataSecret = process.env.PINATA_SECRET_API_KEY;

      if (pinataJwt || (pinataApiKey && pinataSecret)) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (pinataJwt) {
          headers['Authorization'] = `Bearer ${pinataJwt}`;
        } else {
          headers['pinata_api_key'] = pinataApiKey!;
          headers['pinata_secret_api_key'] = pinataSecret!;
        }

        try {
          const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              pinataContent: publicMetadata,
              pinataMetadata: {
                name: `VEILIO_Metadata_${Date.now()}.json`,
              },
            }),
          });

          if (pinataRes.ok) {
            const pinataData = await pinataRes.json();
            const cid = pinataData.IpfsHash;
            console.log('[IPFS upload] Metadata pinned to Pinata. CID:', cid);
            return NextResponse.json({
              success: true,
              cid,
              uri: `ipfs://${cid}`,
              gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
            });
          } else {
            console.warn('[IPFS upload] Pinata metadata pin failed:', await pinataRes.text());
          }
        } catch (pinataErr) {
          console.warn('[IPFS upload] Pinata metadata request error:', pinataErr);
        }
      }

      // Fallback: store metadata as a local JSON file in /public/uploads/
      const jsonStr = JSON.stringify(publicMetadata);
      const hash = crypto.createHash('sha256').update(jsonStr).digest('hex').substring(0, 32);
      const filename = `meta_${hash}.json`;
      const filePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(filePath, jsonStr, 'utf8');
      const localUrl = `/uploads/${filename}`;
      console.log('[IPFS upload] Metadata stored locally:', localUrl);
      return NextResponse.json({
        success: true,
        cid: hash,
        uri: localUrl,           // stored as a plain URL in the contract instead of ipfs://
        gatewayUrl: localUrl,
      });
    }

    // ------------------------------------------------------------------
    // CASE B: IMAGE FILE UPLOAD
    // ------------------------------------------------------------------
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    // Validation: file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Please upload a JPG, PNG, or WebP image.' },
        { status: 400 }
      );
    }

    // Validation: file size max 5 MB
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'Image must be smaller than 5 MB.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Try Pinata IPFS pinning service if credentials present
    const pinataJwt = process.env.PINATA_JWT;
    const pinataApiKey = process.env.PINATA_API_KEY;
    const pinataSecret = process.env.PINATA_SECRET_API_KEY;

    if (pinataJwt || (pinataApiKey && pinataSecret)) {
      const pinataFormData = new FormData();
      const blob = new Blob([buffer], { type: file.type });
      pinataFormData.append('file', blob, file.name);

      const headers: Record<string, string> = {};
      if (pinataJwt) {
        headers['Authorization'] = `Bearer ${pinataJwt}`;
      } else {
        headers['pinata_api_key'] = pinataApiKey!;
        headers['pinata_secret_api_key'] = pinataSecret!;
      }

      try {
        const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
          method: 'POST',
          headers,
          body: pinataFormData,
        });

        if (pinataRes.ok) {
          const pinataData = await pinataRes.json();
          const cid = pinataData.IpfsHash;
          console.log('[IPFS upload] Image pinned to Pinata. CID:', cid);
          return NextResponse.json({
            success: true,
            cid,
            uri: `ipfs://${cid}`,
            gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
          });
        } else {
          console.warn('[IPFS upload] Pinata image pin failed:', await pinataRes.text());
        }
      } catch (pinataErr) {
        console.warn('[IPFS upload] Pinata image request error:', pinataErr);
      }
    }

    // Fallback: store image locally in /public/uploads/<hash>.<ext>
    // This is a real, working URL — not a fake CID.
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 32);
    const ext = EXT_MAP[file.type] || 'jpg';
    const filename = `img_${hash}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    const localUrl = `/uploads/${filename}`;
    console.log('[IPFS upload] Image stored locally:', localUrl);
    return NextResponse.json({
      success: true,
      cid: hash,
      uri: localUrl,            // plain /uploads/... URL, not ipfs://
      gatewayUrl: localUrl,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error during IPFS upload';
    console.error('[IPFS upload] Server route error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
