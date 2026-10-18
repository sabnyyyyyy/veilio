import { get as getBlob, put } from '@vercel/blob';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir } from './dataDir';

const localDir = path.join(getDataDir(), 'service-evidence');

export async function storeServiceEvidence(id: string, fileName: string, bytes: Uint8Array, contentType: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'evidence';
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Private evidence storage is not configured. Set BLOB_READ_WRITE_TOKEN on the server.');
    const bodyBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(bodyBuffer).set(bytes);
    const body = new Blob([bodyBuffer], { type: contentType });
    const blob = await put(`veilio/service-evidence/${id}/${safeName}`, body, {
      access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false,
    });
    return { storage: 'blob' as const, storagePath: blob.pathname };
  }
  await fs.mkdir(localDir, { recursive: true });
  const storagePath = path.join(localDir, `${id}.bin`);
  await fs.writeFile(storagePath, bytes, { flag: 'wx' });
  return { storage: 'local' as const, storagePath };
}

export async function readServiceEvidence(storage: 'blob' | 'local', storagePath: string): Promise<Buffer> {
  if (storage === 'blob') {
    const blob = await getBlob(storagePath, { access: 'private' });
    if (!blob || blob.statusCode !== 200) throw new Error('Private evidence file was not found.');
    return Buffer.from(await new Response(blob.stream).arrayBuffer());
  }
  const root = path.resolve(localDir) + path.sep;
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(root)) throw new Error('Evidence file path is invalid.');
  return fs.readFile(resolved);
}
