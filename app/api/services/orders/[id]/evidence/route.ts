import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getOrderById, saveServiceEvidenceFile } from '@/lib/server/servicesDb';
import { verifyServiceAuth } from '@/lib/server/serviceAuth';
import { storeServiceEvidence } from '@/lib/server/serviceEvidenceStorage';
import { withJsonStores } from '@/lib/server/jsonStore';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.zip': 'application/zip', '.md': 'text/markdown',
};

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = getOrderById(id);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (!['Funded', 'InProgress', 'InReview', 'RevisionRequested'].includes(order.status) || order.paymentStatus !== 'Funded') {
    return NextResponse.json({ error: 'Evidence can only be uploaded while the order is funded and under delivery/review.' }, { status: 409 });
  }
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an evidence file to upload.' }, { status: 400 });
  const auth = (() => { try { return JSON.parse(String(form.get('auth') || 'null')); } catch { return null; } })();
  const verified = await verifyServiceAuth({ action: 'upload-service-evidence', orderId: id, expectedAddress: order.sellerId, auth });
  if (!verified.valid) return NextResponse.json({ error: verified.error || 'Seller signature is invalid.' }, { status: verified.status || 401 });
  if (!file.size || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'Evidence files must be between 1 byte and 10 MB.' }, { status: 413 });
  const filename = file.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'evidence';
  const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  const expectedMime = MIME_BY_EXTENSION[extension];
  if (!expectedMime) return NextResponse.json({ error: 'Supported evidence formats: PDF, PNG, JPG, WebP, TXT, CSV, JSON, Markdown, and ZIP.' }, { status: 415 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) return NextResponse.json({ error: 'Uploaded file size did not match its metadata.' }, { status: 400 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const evidenceId = randomUUID();
  try {
    const stored = await storeServiceEvidence(evidenceId, filename, bytes, expectedMime);
    saveServiceEvidenceFile({
      id: evidenceId, orderId: id, uploadedBy: order.sellerId, fileName: filename,
      mimeType: expectedMime, size: bytes.length, sha256, ...stored, uploadedAt: Date.now(),
    });
    return NextResponse.json({ success: true, evidence: {
      id: evidenceId, fileName: filename, size: bytes.length, sha256,
      reference: `evidence:${evidenceId}:${sha256}`,
      downloadUrl: `/api/services/orders/${encodeURIComponent(id)}/evidence/${evidenceId}`,
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Evidence upload failed.' }, { status: 503 });
  }
}

export const POST = withJsonStores(handlePOST);
