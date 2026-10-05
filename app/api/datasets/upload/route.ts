import { del, get, put } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { isAddress, verifyMessage } from 'viem';
import { assetUploadMessage } from '@/lib/assetAuth';
import { MAX_ASSET_UPLOAD_BYTES, sanitizeAssetFileName, validateAssetUpload } from '@/lib/assetPolicy';
import { decryptFile } from '@/lib/server/encryption';
import { analyzeAsset } from '@/lib/server/assetManifest';
import {
  assetStorageConfigurationError,
  consumeUploadNonce,
  createPendingAssetUpload,
  deletePendingAssetUpload,
  getDatasetRecord,
  getPendingAssetUpload,
  saveDatasetRecord,
  updatePendingAssetUpload,
  type DatasetRecord,
  type PendingAssetUpload,
} from '@/lib/server/datasetDb';
import { allowAssetUpload } from '@/lib/server/uploadRateLimit';
import { parseAssetMasterKey } from '@/lib/server/datasetVault';
import { scanAssetBuffer } from '@/lib/server/malwareScan';
import { auditAssetEvent } from '@/lib/server/assetAudit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const uploadPath = (id: string) => `veilio/incoming/${id}.enc`;
const storedAssetPath = (id: string) => `veilio/assets/${id}.enc`;

export const maxDuration = 300;

type UploadClientPayload = {
  datasetId: string;
  walletAddress: string;
  assetType: string;
  fileName: string;
  fileSize: number;
  timestamp: number;
  nonce: string;
  signature: string;
  fileHashHex: string;
  keyBase64: string;
  ivBase64: string;
  licenseType?: string;
  accessInstructions?: string;
};

function validBase64(value: unknown, expectedBytes: number) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  return Buffer.from(value, 'base64').length === expectedBytes;
}

function parseClientPayload(value: string | null): UploadClientPayload {
  if (!value || value.length > 12_000) throw new Error('Invalid upload token request.');
  let payload: UploadClientPayload;
  try { payload = JSON.parse(value) as UploadClientPayload; }
  catch { throw new Error('Invalid upload token request.'); }
  const fileName = sanitizeAssetFileName(payload.fileName || '');
  if (
    !UUID.test(payload.datasetId || '') || !isAddress(payload.walletAddress || '') ||
    !Number.isSafeInteger(payload.fileSize) || !Number.isSafeInteger(payload.timestamp) ||
    !UUID.test(payload.nonce || '') || typeof payload.signature !== 'string' ||
    !HASH.test(payload.fileHashHex || '') || !validBase64(payload.keyBase64, 32) || !validBase64(payload.ivBase64, 12) ||
    !fileName || fileName !== payload.fileName
  ) throw new Error('Upload authorization is incomplete or invalid.');
  const validationError = validateAssetUpload(payload.assetType, fileName, payload.fileSize);
  if (validationError) throw new Error(validationError);
  if (Math.abs(Date.now() - payload.timestamp) > 5 * 60 * 1000) throw new Error('Upload authorization expired. Please select the file again.');
  return payload;
}

function safeDatasetResponse(record: DatasetRecord) {
  return {
    datasetId: record.datasetId,
    fileName: record.fileName,
    size: record.size,
    fileHashHex: record.fileHashHex,
    mimeType: record.mimeType,
    manifest: record.manifest,
  };
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ASSET_UPLOAD_BYTES + 16) throw new Error('Encrypted upload exceeded the allowed size.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function finishPrivateBlobUpload(blob: { pathname: string }, datasetId: string) {
  if (!UUID.test(datasetId)) throw new Error('Invalid completed upload reference.');
  const existing = await getDatasetRecord(datasetId);
  if (existing?.encryptedFilePath === blob.pathname) return;

  const pending = await getPendingAssetUpload(datasetId);
  if (!pending || pending.status === 'rejected' || blob.pathname !== uploadPath(datasetId)) throw new Error('Upload session is missing or does not match the uploaded file.');
  pending.status = 'processing';
  await updatePendingAssetUpload(pending);

  let recordSaved = false;
  let finalPath: string | null = null;
  try {
    const privateBlob = await get(blob.pathname, { access: 'private' });
    if (!privateBlob || privateBlob.statusCode !== 200) throw new Error('Uploaded encrypted asset could not be read from private storage.');
    const encryptedWithTag = await streamToBuffer(privateBlob.stream);
    if (encryptedWithTag.length !== pending.fileSize + 16) throw new Error('Encrypted upload length does not match the signed file size.');

    const ciphertext = encryptedWithTag.subarray(0, -16);
    const authTag = encryptedWithTag.subarray(-16);
    const plain = decryptFile(ciphertext, pending.keyBase64, pending.ivBase64, authTag.toString('base64'));
    const actualHash = createHash('sha256').update(plain).digest('hex');
    if (plain.length !== pending.fileSize || actualHash !== pending.fileHashHex.toLowerCase()) throw new Error('Uploaded file failed its signed integrity check.');

    try {
      await scanAssetBuffer(plain);
    } catch (scanError) {
      const infected = scanError instanceof Error && scanError.message.includes('identified as malware');
      auditAssetEvent({ action: 'upload', result: 'denied', assetType: pending.assetType, sizeBytes: pending.fileSize, walletAddress: pending.address, reasonCode: 'malware_scan_rejected_or_unavailable' });
      throw new Error(infected ? 'The file failed malware scanning and was rejected.' : 'The malware scanning service is unavailable. Try again later.');
    }

    const manifest = analyzeAsset(pending.assetType || 'dataset', pending.fileName, plain);
    const finalBlob = await put(storedAssetPath(datasetId), ciphertext, {
      access: 'private',
      contentType: 'application/octet-stream',
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    finalPath = finalBlob.pathname;
    const record: DatasetRecord = {
      datasetId,
      uploader: pending.address.toLowerCase(),
      uploadNonce: pending.nonce,
      assetType: pending.assetType,
      deliveryMethod: pending.assetType === 'software-license' ? 'license-access' : 'encrypted-download',
      assetDetails: pending.assetType === 'software-license' ? {
        licenseType: (pending.licenseType || '').trim().slice(0, 120),
        accessInstructions: (pending.accessInstructions || '').trim().slice(0, 2000),
      } : undefined,
      fileName: pending.fileName,
      mimeType: 'application/octet-stream',
      size: pending.fileSize,
      fileHashHex: pending.fileHashHex.toLowerCase(),
      encryptedFilePath: finalBlob.pathname,
      encryptionVersion: 'aes-256-gcm',
      keyBase64: pending.keyBase64,
      ivBase64: pending.ivBase64,
      authTagBase64: authTag.toString('base64'),
      manifest,
      createdAt: Date.now(),
    };
    await saveDatasetRecord(record);
    recordSaved = true;
    await deletePendingAssetUpload(datasetId).catch(() => undefined);
    await del(blob.pathname).catch(() => undefined);
    auditAssetEvent({ action: 'upload', result: 'success', assetType: record.assetType || 'dataset', sizeBytes: record.size, walletAddress: pending.address });
  } catch (error) {
    if (recordSaved) throw error;
    const message = error instanceof Error ? error.message : 'Could not verify uploaded asset.';
    pending.status = 'rejected';
    pending.error = message.slice(0, 240);
    await updatePendingAssetUpload(pending).catch(() => undefined);
    await del(blob.pathname).catch(() => undefined);
    if (finalPath) await del(finalPath).catch(() => undefined);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const configurationError = assetStorageConfigurationError();
    if (configurationError) return NextResponse.json({ error: configurationError }, { status: 503 });
    try { parseAssetMasterKey(); }
    catch { return NextResponse.json({ error: 'Asset encryption is not configured. Set ASSET_KEY_ENCRYPTION_KEY on the server.' }, { status: 503 }); }

    const body = await request.json() as HandleUploadBody;
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = parseClientPayload(clientPayload);
        if (pathname !== uploadPath(payload.datasetId)) throw new Error('Upload path does not match its signed session.');
        const message = assetUploadMessage({
          address: payload.walletAddress,
          assetType: payload.assetType,
          fileName: payload.fileName,
          fileSize: payload.fileSize,
          timestamp: payload.timestamp,
          nonce: payload.nonce,
          datasetId: payload.datasetId,
          fileHashHex: payload.fileHashHex,
        });
        const authorized = await verifyMessage({ address: payload.walletAddress as `0x${string}`, message, signature: payload.signature as `0x${string}` });
        if (!authorized) throw new Error('Wallet signature does not authorize this asset upload.');
        if (!await consumeUploadNonce(payload.nonce)) throw new Error('This upload authorization has already been used.');
        if (!await allowAssetUpload(payload.walletAddress, Date.now(), payload.nonce)) throw new Error('Upload limit reached for this wallet. Try again later.');
        const pending: PendingAssetUpload = {
          datasetId: payload.datasetId,
          status: 'uploading',
          address: payload.walletAddress,
          assetType: payload.assetType as DatasetRecord['assetType'],
          fileName: payload.fileName,
          fileSize: payload.fileSize,
          nonce: payload.nonce,
          timestamp: payload.timestamp,
          signature: payload.signature,
          fileHashHex: payload.fileHashHex.toLowerCase(),
          keyBase64: payload.keyBase64,
          ivBase64: payload.ivBase64,
          licenseType: payload.licenseType,
          accessInstructions: payload.accessInstructions,
        };
        await createPendingAssetUpload(pending);
        return {
          addRandomSuffix: false,
          allowOverwrite: false,
          allowedContentTypes: ['application/octet-stream'],
          maximumSizeInBytes: payload.fileSize + 16,
          validUntil: Date.now() + 10 * 60 * 1000,
          tokenPayload: payload.datasetId,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (!tokenPayload || !UUID.test(tokenPayload)) throw new Error('Completed upload has no valid session ID.');
        await finishPrivateBlobUpload(blob, tokenPayload);
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error('[Asset Blob Upload] Request failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not authorize asset upload.' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const datasetId = request.nextUrl.searchParams.get('id') || '';
  const address = request.nextUrl.searchParams.get('address') || '';
  if (!UUID.test(datasetId) || !isAddress(address)) return NextResponse.json({ error: 'Invalid upload status request.' }, { status: 400 });

  try {
    const record = await getDatasetRecord(datasetId);
    if (record) {
      if (record.uploader?.toLowerCase() !== address.toLowerCase()) return NextResponse.json({ error: 'Upload session belongs to another wallet.' }, { status: 403 });
      return NextResponse.json({ status: 'ready', dataset: safeDatasetResponse(record) });
    }
    const pending = await getPendingAssetUpload(datasetId);
    if (!pending) return NextResponse.json({ error: 'Upload session expired. Please select the file again.' }, { status: 404 });
    if (pending.address.toLowerCase() !== address.toLowerCase()) return NextResponse.json({ error: 'Upload session belongs to another wallet.' }, { status: 403 });
    if (pending.status === 'rejected') return NextResponse.json({ status: 'rejected', error: pending.error || 'Asset verification failed.' }, { status: 422 });
    return NextResponse.json({ status: pending.status });
  } catch {
    return NextResponse.json({ error: 'Could not read upload status from persistent storage.' }, { status: 503 });
  }
}
