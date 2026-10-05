import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isAddress, verifyMessage } from 'viem';
import { encryptFile } from '@/lib/server/encryption';
import { assetStorageConfigurationError, consumeUploadNonce, saveDatasetRecord, getEncryptedDir, type DatasetRecord } from '@/lib/server/datasetDb';
import { allowAssetUpload } from '@/lib/server/uploadRateLimit';
import { MAX_ASSET_UPLOAD_BYTES, sanitizeAssetFileName, validateAssetUpload } from '@/lib/assetPolicy';
import { assetUploadMessage } from '@/lib/assetAuth';
import { parseAssetMasterKey } from '@/lib/server/datasetVault';
import { scanAssetBuffer } from '@/lib/server/malwareScan';
import { auditAssetEvent } from '@/lib/server/assetAudit';
import { parseCsvRows } from '@/lib/csvParser';

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Local file uploads are disabled in production. Use the private direct-upload flow.' }, { status: 404 });
  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (contentLength > MAX_ASSET_UPLOAD_BYTES + 256 * 1024) {
      return NextResponse.json({ error: 'Files must be 100 MB or smaller.' }, { status: 413 });
    }
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
      return NextResponse.json({ error: 'Upload must use multipart/form-data.' }, { status: 415 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const assetType = String(formData.get('assetType') || 'dataset');
    const address = String(formData.get('walletAddress') || '');
    const timestamp = Number(formData.get('timestamp'));
    const nonce = String(formData.get('nonce') || '');
    const signature = String(formData.get('signature') || '');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No dataset file provided' }, { status: 400 });
    }
    const fileName = sanitizeAssetFileName(file.name);
    const validationError = validateAssetUpload(assetType, fileName, file.size);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    if (!isAddress(address) || !Number.isSafeInteger(timestamp) || !/^[0-9a-f-]{36}$/i.test(nonce) || !signature) {
      return NextResponse.json({ error: 'A wallet signature is required to upload an asset.' }, { status: 401 });
    }
    if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Upload authorization expired. Please select the file again.' }, { status: 401 });
    }
    const message = assetUploadMessage({ address, assetType, fileName, fileSize: file.size, timestamp, nonce });
    const authorized = await verifyMessage({ address, message, signature: signature as `0x${string}` });
    if (!authorized) return NextResponse.json({ error: 'Wallet signature does not authorize this file upload.' }, { status: 401 });
    try {
      const storageError = assetStorageConfigurationError();
      if (storageError) return NextResponse.json({ error: storageError }, { status: 503 });
      parseAssetMasterKey();
    } catch {
      return NextResponse.json({ error: 'Asset storage is not configured. Set ASSET_KEY_ENCRYPTION_KEY on the server.' }, { status: 503 });
    }
    try {
      if (!await consumeUploadNonce(nonce)) {
        auditAssetEvent({ action: 'upload', result: 'denied', assetType, walletAddress: address, reasonCode: 'nonce_replay' });
        return NextResponse.json({ error: 'This upload authorization has already been used.' }, { status: 409 });
      }
      if (!await allowAssetUpload(address, Date.now(), nonce)) {
        auditAssetEvent({ action: 'upload', result: 'denied', assetType, walletAddress: address, reasonCode: 'rate_limit' });
        return NextResponse.json({ error: 'Upload limit reached for this wallet. Try again later.' }, { status: 429 });
      }
    } catch {
      return NextResponse.json({ error: 'Shared upload protection is not configured or currently unavailable.' }, { status: 503 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    try {
      await scanAssetBuffer(buffer);
    } catch (scanError) {
      auditAssetEvent({ action: 'upload', result: 'denied', assetType, sizeBytes: file.size, walletAddress: address, reasonCode: 'malware_scan_rejected_or_unavailable' });
      const infected = scanError instanceof Error && scanError.message.includes('identified as malware');
      return NextResponse.json({ error: infected ? 'The file failed malware scanning and was rejected.' : 'The malware scanning service is unavailable. Try again later.' }, { status: infected ? 422 : 503 });
    }

    // Strict Manifest Generation (Phase 8)
    let format = 'UNKNOWN';
    if (file.name.toLowerCase().endsWith('.csv')) format = 'CSV';
    else if (file.name.toLowerCase().endsWith('.json')) format = 'JSON';

    if (format === 'UNKNOWN' && fileName.toLowerCase().endsWith('.parquet')) format = 'PARQUET';

    let recordCount = 0;
    let columnCount = 0;
    let columns: string[] = [];
    let schema: any[] = [];
    let nullRates: Record<string, number> = {};
    let duplicateRate = 0;
    let sample: any[] = [];

    const text = format === 'CSV' || format === 'JSON' ? buffer.toString('utf-8') : '';

    function processRows(parsedRows: any[], cols: string[]) {
      recordCount = parsedRows.length;
      columnCount = cols.length;
      columns = cols;
      
      const nullCounts: Record<string, number> = {};
      cols.forEach(c => nullCounts[c] = 0);
      
      const rowStrings = new Set();
      let duplicates = 0;
      
      for(let i=0; i<parsedRows.length; i++) {
        const rowObj = parsedRows[i];
        const rowStr = JSON.stringify(rowObj);
        if (rowStrings.has(rowStr)) duplicates++;
        rowStrings.add(rowStr);
        
        cols.forEach(col => {
          const val = rowObj[col];
          if (val === null || val === undefined || val === '' || String(val).toLowerCase() === 'null' || String(val).toLowerCase() === 'na') {
            nullCounts[col]++;
          }
        });
      }
      
      cols.forEach(col => {
        let type = 'string';
        for(let i=0; i<parsedRows.length; i++) {
          const val = parsedRows[i][col];
          if (val !== null && val !== undefined && val !== '' && String(val).toLowerCase() !== 'null' && String(val).toLowerCase() !== 'na') {
            if (typeof val === 'number' || !isNaN(Number(val))) type = 'number';
            break;
          }
        }
        schema.push({ name: col, type });
        nullRates[col] = recordCount > 0 ? nullCounts[col] / recordCount : 0;
      });
      
      duplicateRate = recordCount > 0 ? duplicates / recordCount : 0;
      
      sample = parsedRows.slice(0, 100);
    }

    if (format === 'CSV' && assetType === 'dataset') {
      let rows: string[][];
      try {
        rows = parseCsvRows(text);
      } catch {
        return NextResponse.json({ error: 'CSV file contains invalid quoting or formatting.' }, { status: 400 });
      }
      if (rows.length < 2) {
        return NextResponse.json({ error: 'CSV file must contain at least a header and one record row.' }, { status: 400 });
      }
      const cols = rows[0].map((column) => column.trim());
      if (cols.some((column) => !column) || new Set(cols).size !== cols.length) {
        return NextResponse.json({ error: 'CSV column names must be non-empty and unique.' }, { status: 400 });
      }
      const dataRows = rows.slice(1);
      if (dataRows.some((values) => values.length !== cols.length)) {
        return NextResponse.json({ error: 'Every CSV record must have the same number of values as the header.' }, { status: 400 });
      }
      const parsedRows = dataRows.map((values) => Object.fromEntries(cols.map((column, index) => [column, values[index]])));
      processRows(parsedRows, cols);
    } else if (format === 'JSON' && assetType === 'dataset') {
      try {
        const json = JSON.parse(text);
        let parsedRows: any[] = [];
        if (Array.isArray(json)) {
          if (json.length === 0) return NextResponse.json({ error: 'JSON array is empty.' }, { status: 400 });
          parsedRows = json;
        } else if (typeof json === 'object' && json !== null) {
          parsedRows = [json];
        } else {
          return NextResponse.json({ error: 'JSON file must contain an object or array.' }, { status: 400 });
        }

        if (typeof parsedRows[0] === 'object' && parsedRows[0] !== null && !Array.isArray(parsedRows[0])) {
          processRows(parsedRows, Object.keys(parsedRows[0]));
        } else {
           // Array of primitives
          recordCount = parsedRows.length;
          columnCount = 0;
        }
      } catch (e) {
        return NextResponse.json({ error: 'Invalid JSON file format.' }, { status: 400 });
      }
    }

    const manifest = {
      format,
      recordCount,
      columnCount,
      columns,
      schema,
      nullRates,
      duplicateRate,
      sample: assetType === 'dataset' ? sample : []
    };

    // Encrypt the file using AES-256-GCM
    const {
      encryptedBuffer,
      keyBase64,
      ivBase64,
      authTagBase64,
      fileHashHex
    } = encryptFile(buffer);

    // Generate unique dataset ID
    const datasetId = crypto.randomUUID();
    const encryptedFileName = `${datasetId}.enc`;
    const encryptedDir = getEncryptedDir();
    const encryptedFilePath = path.join(encryptedDir, encryptedFileName);

    // Save encrypted file to local private storage
    fs.writeFileSync(encryptedFilePath, encryptedBuffer, { mode: 0o600, flag: 'wx' });

    // Save metadata and keys to private DB
    const record: DatasetRecord = {
      datasetId,
      uploader: address.toLowerCase(),
      uploadNonce: nonce,
      assetType: assetType as DatasetRecord['assetType'],
      deliveryMethod: assetType === 'software-license' ? 'license-access' : 'encrypted-download',
      assetDetails: assetType === 'software-license' ? {
        licenseType: String(formData.get('licenseType') || '').trim().slice(0, 120),
        accessInstructions: String(formData.get('accessInstructions') || '').trim().slice(0, 2000),
      } : undefined,
      fileName,
      mimeType: 'application/octet-stream',
      size: file.size,
      fileHashHex,
      encryptedFilePath: encryptedFileName,
      encryptionVersion: 'aes-256-gcm',
      keyBase64,
      ivBase64,
      authTagBase64,
      manifest,
      createdAt: Date.now(),
    };
    try {
      await saveDatasetRecord(record);
    } catch (error) {
      fs.rmSync(encryptedFilePath, { force: true });
      throw error;
    }

    console.log(`[Dataset Upload] Dataset ${datasetId} encrypted and saved.`);
    auditAssetEvent({ action: 'upload', result: 'success', assetType, sizeBytes: file.size, walletAddress: address });

    // Return public metadata (NEVER RETURN THE KEY HERE)
    return NextResponse.json({
      success: true,
      dataset: {
        datasetId,
        fileName: record.fileName,
        size: record.size,
        fileHashHex: record.fileHashHex,
        mimeType: record.mimeType,
        manifest: record.manifest,
      }
    });

  } catch (err: unknown) {
    auditAssetEvent({ action: 'upload', result: 'error', reasonCode: 'unexpected_error' });
    console.error('[Dataset Upload] Unexpected failure:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Internal server error during asset upload.' }, { status: 500 });
  }
}
