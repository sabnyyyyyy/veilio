import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-side IPFS proxy.
 * GET /api/ipfs/proxy?cid=<CID>
 *
 * Tries multiple public IPFS gateways in sequence.
 * Returns the raw content with correct Content-Type and cache headers.
 * 429, 403, 4xx, 5xx are all treated as failure and trigger the next gateway.
 * Keeps Pinata credentials server-side only.
 */

const GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get('cid');

  if (!cid) {
    return NextResponse.json({ error: 'Missing cid parameter' }, { status: 400 });
  }

  // Sanitise: strip any leading /ipfs/ or ipfs:// prefix
  const cleanCid = cid.replace(/^\/ipfs\//, '').replace(/^ipfs:\/\//, '');

  console.log(`[IPFS proxy] CID: ${cleanCid}`);

  for (const gateway of GATEWAYS) {
    const url = `${gateway}${cleanCid}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: req.headers.get('accept') || '*/*',
        },
      });

      const contentType =
        response.headers.get('content-type') || 'application/octet-stream';

      if (!response.ok) {
        // 429 = rate limited, 403 = forbidden, 4xx/5xx = failure — try next
        console.warn(
          `[IPFS proxy] Gateway ${gateway} returned ${response.status} for CID ${cleanCid}`
        );
        continue;
      }

      const body = await response.arrayBuffer();

      console.log(
        `[IPFS proxy] SUCCESS via ${gateway} | CID: ${cleanCid} | ` +
        `Status: ${response.status} | Content-Type: ${contentType} | Size: ${body.byteLength} bytes`
      );

      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          'Access-Control-Allow-Origin': '*',
          'X-IPFS-Gateway': gateway,
          'X-IPFS-CID': cleanCid,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[IPFS proxy] Gateway ${gateway} error: ${message}`);
      continue;
    }
  }

  console.error(`[IPFS proxy] ALL gateways failed for CID: ${cleanCid}`);
  return NextResponse.json(
    {
      error: 'All IPFS gateways failed or CID does not exist on IPFS network',
      cid: cleanCid,
    },
    { status: 502 }
  );
}
