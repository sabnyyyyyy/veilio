import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getOrderById, getServiceEvidenceFile, sameWalletAddress } from '@/lib/server/servicesDb';
import { extractServiceAuth, verifyServiceAuth } from '@/lib/server/serviceAuth';
import { readServiceEvidence } from '@/lib/server/serviceEvidenceStorage';
import { withJsonStores } from '@/lib/server/jsonStore';

async function handleGET(req: NextRequest, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  const { id, evidenceId } = await params;
  const order = getOrderById(id);
  const evidence = getServiceEvidenceFile(evidenceId);
  if (!order || !evidence || evidence.orderId !== id) return NextResponse.json({ error: 'Evidence file not found.' }, { status: 404 });
  const auth = extractServiceAuth(req.headers);
  const address = typeof auth?.address === 'string' ? auth.address : '';
  if (!sameWalletAddress(address, order.buyerId) && !sameWalletAddress(address, order.sellerId)) {
    return NextResponse.json({ error: 'Only the order buyer and seller can access this evidence file.' }, { status: 403 });
  }
  const verified = await verifyServiceAuth({ action: 'download-service-evidence', orderId: `${id}:${evidenceId}`, expectedAddress: address, auth });
  if (!verified.valid) return NextResponse.json({ error: verified.error || 'Wallet signature is invalid.' }, { status: verified.status || 401 });
  try {
    const bytes = await readServiceEvidence(evidence.storage, evidence.storagePath);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== evidence.size || hash !== evidence.sha256) return NextResponse.json({ error: 'Evidence failed its integrity check.' }, { status: 500 });
    const responseBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(responseBuffer).set(bytes);
    return new Response(responseBuffer, { headers: {
      'Content-Type': evidence.mimeType,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(evidence.fileName)}`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-Content-SHA256': evidence.sha256,
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not download evidence.' }, { status: 503 });
  }
}

export const GET = withJsonStores(handleGET);
