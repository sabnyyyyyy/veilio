import { expect } from 'chai';
import crypto from 'crypto';
import { verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assetUploadMessage } from '../lib/assetAuth';
import { sanitizeAssetFileName, validateAssetUpload, MAX_ASSET_UPLOAD_BYTES } from '../lib/assetPolicy';
import { decryptFile, encryptFile } from '../lib/server/encryption';
import { decryptDatabase, encryptDatabase, parseAssetMasterKey } from '../lib/server/datasetVault';
import { analyzeAsset } from '../lib/server/assetManifest';
import { allowAssetUpload } from '../lib/server/uploadRateLimit';
import { scanAssetBuffer } from '../lib/server/malwareScan';
import { unpackEncryptedAssetBundle } from '../lib/client/decryption';
import { assetStorageConfigurationError } from '../lib/server/datasetDb';
import { parseCsvRows } from '../lib/csvParser';
import { contractReadErrorMessage } from '../lib/contractReadError';

describe('VEILIO encrypted asset security', function () {
  it('explains when the configured auction address has no compatible contract response', function () {
    const address = '0x0000000000000000000000000000000000000001';
    const message = contractReadErrorMessage(new Error('The contract function "auctionCount" returned no data ("0x").'), address);
    expect(message).to.contain(address);
    expect(message).to.contain('NEXT_PUBLIC_V4_CONTRACT_ADDRESS');
    expect(contractReadErrorMessage(new Error('RPC timeout'), address)).to.contain('network connection');
  });

  it('allows representative formats for every file-backed asset category', function () {
    const examples = [
      ['dataset', 'sales.csv'],
      ['ai-model', 'forecast.safetensors'],
      ['3d-asset', 'assembly.step'],
      ['software-license', 'license-notes.pdf'],
      ['digital-media', 'campaign.mp4'],
    ];

    for (const [assetType, fileName] of examples) {
      expect(validateAssetUpload(assetType, fileName, 256)).to.equal(null);
    }
  });

  it('parses quoted CSV commas, escaped quotes, and embedded line breaks', function () {
    expect(parseCsvRows('\uFEFFid,name,note\r\n1,"Alice, Jr.","said ""hello"""\r\n2,Bob,"line one\r\nline two"\r\n'))
      .to.deep.equal([
        ['id', 'name', 'note'],
        ['1', 'Alice, Jr.', 'said "hello"'],
        ['2', 'Bob', 'line one\r\nline two'],
      ]);
    expect(() => parseCsvRows('id,name\n1,"unfinished')).to.throw('Unclosed quoted CSV field');
  });

  it('creates dataset manifests and leaves non-dataset assets opaque', function () {
    const dataset = analyzeAsset('dataset', 'metrics.csv', Buffer.from('id,value\n1,10\n2,20\n'));
    expect(dataset.format).to.equal('CSV');
    expect(dataset.recordCount).to.equal(2);
    expect(dataset.columns).to.deep.equal(['id', 'value']);
    expect(analyzeAsset('ai-model', 'model.onnx', Buffer.from([1, 2, 3]))).to.include({ format: 'UNKNOWN', recordCount: 0 });
  });

  it('sanitizes client filenames and rejects mismatched, empty, and oversized uploads', function () {
    expect(sanitizeAssetFileName('C:\\fakepath\\weights.onnx')).to.equal('weights.onnx');
    expect(validateAssetUpload('ai-model', 'weights.exe', 100)).to.contain('not supported');
    expect(validateAssetUpload('nft', 'token.png', 100)).to.contain('does not support');
    expect(validateAssetUpload('3d-asset', 'empty.obj', 0)).to.contain('empty');
    expect(validateAssetUpload('digital-media', 'large.mp4', MAX_ASSET_UPLOAD_BYTES + 1)).to.contain('100 MB');
  });

  it('round-trips binary asset files and detects ciphertext tampering', function () {
    const original = Buffer.from([0, 1, 2, 255, 10, 13, 42]);
    const encrypted = encryptFile(original);
    expect(encrypted.encryptedBuffer.equals(original)).to.equal(false);
    expect(decryptFile(encrypted.encryptedBuffer, encrypted.keyBase64, encrypted.ivBase64, encrypted.authTagBase64).equals(original)).to.equal(true);

    const damaged = Buffer.from(encrypted.encryptedBuffer);
    damaged[0] ^= 1;
    expect(() => decryptFile(damaged, encrypted.keyBase64, encrypted.ivBase64, encrypted.authTagBase64)).to.throw();
    expect(encrypted.fileHashHex).to.equal(crypto.createHash('sha256').update(original).digest('hex'));
  });

  it('encrypts the asset database envelope and rejects a wrong or tampered key', function () {
    const masterKey = crypto.randomBytes(32);
    const privateRecord = JSON.stringify({ keyBase64: 'sensitive-file-key', accessInstructions: 'private delivery notes' });
    const envelope = encryptDatabase(privateRecord, masterKey);
    expect(JSON.stringify(envelope)).not.to.contain('sensitive-file-key');
    expect(decryptDatabase(envelope, masterKey)).to.equal(privateRecord);
    expect(() => decryptDatabase(envelope, crypto.randomBytes(32))).to.throw();
    expect(() => parseAssetMasterKey('not-a-key')).to.throw('32-byte key');
  });

  it('binds upload authorization to wallet, chain, contract, asset kind, file, and one-time nonce', async function () {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
    const input = {
      address: account.address,
      assetType: 'ai-model',
      fileName: 'model.onnx',
      fileSize: 4096,
      timestamp: Date.now(),
      nonce: '11111111-1111-4111-8111-111111111111',
    };
    const message = assetUploadMessage(input);
    const signature = await account.signMessage({ message });
    expect(await verifyMessage({ address: account.address, message, signature })).to.equal(true);
    expect(await verifyMessage({ address: account.address, message: assetUploadMessage({ ...input, assetType: 'digital-media' }), signature })).to.equal(false);
  });

  it('enforces the per-wallet rolling upload cap in development mode', async function () {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRedisUrl = process.env.ASSET_REDIS_REST_URL;
    const previousRedisToken = process.env.ASSET_REDIS_REST_TOKEN;
    delete process.env.ASSET_REDIS_REST_URL;
    delete process.env.ASSET_REDIS_REST_TOKEN;
    process.env.NODE_ENV = 'test';
    try {
      const address = `0x${crypto.randomBytes(20).toString('hex')}`;
      const now = Date.now();
      for (let index = 0; index < 12; index++) {
        expect(await allowAssetUpload(address, now, `nonce-${index}`)).to.equal(true);
      }
      expect(await allowAssetUpload(address, now, 'nonce-over-limit')).to.equal(false);
    } finally {
      if (previousRedisUrl === undefined) delete process.env.ASSET_REDIS_REST_URL;
      else process.env.ASSET_REDIS_REST_URL = previousRedisUrl;
      if (previousRedisToken === undefined) delete process.env.ASSET_REDIS_REST_TOKEN;
      else process.env.ASSET_REDIS_REST_TOKEN = previousRedisToken;
      if (previousNodeEnv) process.env.NODE_ENV = previousNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  it('uses the shared Redis limiter when configured', async function () {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRedisUrl = process.env.ASSET_REDIS_REST_URL;
    const previousRedisToken = process.env.ASSET_REDIS_REST_TOKEN;
    const previousFetch = globalThis.fetch;
    process.env.NODE_ENV = 'production';
    process.env.ASSET_REDIS_REST_URL = 'https://redis.example.test';
    process.env.ASSET_REDIS_REST_TOKEN = 'test-token';
    let commandBody = '';
    globalThis.fetch = (async (_input, init) => {
      commandBody = String(init?.body || '');
      return new Response(JSON.stringify({ result: 1 }), { status: 200 });
    }) as typeof fetch;
    try {
      expect(await allowAssetUpload(`0x${'22'.repeat(20)}`, Date.now(), 'signed-nonce')).to.equal(true);
      expect(commandBody).to.contain('EVAL');
    } finally {
      globalThis.fetch = previousFetch;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousRedisUrl === undefined) delete process.env.ASSET_REDIS_REST_URL;
      else process.env.ASSET_REDIS_REST_URL = previousRedisUrl;
      if (previousRedisToken === undefined) delete process.env.ASSET_REDIS_REST_TOKEN;
      else process.env.ASSET_REDIS_REST_TOKEN = previousRedisToken;
    }
  });

  it('requires private Blob, persistent Redis, and malware scanning in production', function () {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const previousRedisUrl = process.env.ASSET_REDIS_REST_URL;
    const previousRedisToken = process.env.ASSET_REDIS_REST_TOKEN;
    const previousScannerKey = process.env.MALWARE_SCAN_API_KEY;
    process.env.NODE_ENV = 'production';
    try {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      process.env.ASSET_REDIS_REST_URL = 'https://redis.example.test';
      process.env.ASSET_REDIS_REST_TOKEN = 'test-token';
      process.env.MALWARE_SCAN_API_KEY = 'test-api-key';
      expect(assetStorageConfigurationError()).to.contain('Private Vercel Blob');
      process.env.BLOB_READ_WRITE_TOKEN = 'blob-token';
      delete process.env.ASSET_REDIS_REST_URL;
      expect(assetStorageConfigurationError()).to.contain('Redis REST');
      process.env.ASSET_REDIS_REST_URL = 'https://redis.example.test';
      delete process.env.MALWARE_SCAN_API_KEY;
      expect(assetStorageConfigurationError()).to.contain('Malware scanning');
      process.env.MALWARE_SCAN_API_KEY = 'test-api-key';
      expect(assetStorageConfigurationError()).to.equal(null);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken;
      if (previousRedisUrl === undefined) delete process.env.ASSET_REDIS_REST_URL;
      else process.env.ASSET_REDIS_REST_URL = previousRedisUrl;
      if (previousRedisToken === undefined) delete process.env.ASSET_REDIS_REST_TOKEN;
      else process.env.ASSET_REDIS_REST_TOKEN = previousRedisToken;
      if (previousScannerKey === undefined) delete process.env.MALWARE_SCAN_API_KEY;
      else process.env.MALWARE_SCAN_API_KEY = previousScannerKey;
    }
  });

  it('fails closed when the managed scanner detects malware and accepts a clean scan', async function () {
    const previousKey = process.env.MALWARE_SCAN_API_KEY;
    const previousRegion = process.env.MALWARE_SCAN_REGION;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFetch = globalThis.fetch;
    process.env.MALWARE_SCAN_API_KEY = 'test-api-key';
    process.env.MALWARE_SCAN_REGION = 'ap1';
    globalThis.fetch = (async (input, init) => {
      expect(String(input)).to.equal('https://ap1.api.av.ionxsolutions.com/v1/malware/scan/file');
      expect(new Headers(init?.headers).get('X-API-Key')).to.equal('test-api-key');
      expect(init?.body).to.be.instanceOf(FormData);
      expect((init?.body as FormData).get('file')).to.be.instanceOf(Blob);
      return new Response(JSON.stringify({ status: 'clean' }), { status: 201 });
    }) as typeof fetch;
    try {
      expect(await scanAssetBuffer(Buffer.from('dummy file'))).to.equal('clean');
      globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'threat' }), { status: 201 })) as typeof fetch;
      try {
        await scanAssetBuffer(Buffer.from('infected file'));
        expect.fail('infected file should be rejected');
      } catch (error) {
        expect((error as Error).message).to.contain('identified as malware');
      }
      delete process.env.MALWARE_SCAN_API_KEY;
      process.env.NODE_ENV = 'production';
      try {
        await scanAssetBuffer(Buffer.from('unscanned'));
        expect.fail('production should reject unscanned assets');
      } catch (error) {
        expect((error as Error).message).to.contain('not configured');
      }
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.MALWARE_SCAN_API_KEY;
      else process.env.MALWARE_SCAN_API_KEY = previousKey;
      if (previousRegion === undefined) delete process.env.MALWARE_SCAN_REGION;
      else process.env.MALWARE_SCAN_REGION = previousRegion;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('unpacks the streamed encrypted asset bundle and rejects malformed headers', function () {
    const metadata = {
      fileName: 'file.bin', mimeType: 'application/octet-stream', encryptionVersion: 'aes-256-gcm',
      fileHashHex: 'ab'.repeat(32), keyBase64: 'a2V5', ivBase64: 'aXY=', authTagBase64: 'dGFn',
    };
    const header = Buffer.from(JSON.stringify(metadata));
    const output = Buffer.alloc(4 + header.length + 3);
    output.writeUInt32BE(header.length, 0);
    header.copy(output, 4);
    output.set([1, 2, 3], 4 + header.length);
    const unpacked = unpackEncryptedAssetBundle(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength));
    expect(unpacked.metadata.fileName).to.equal('file.bin');
    expect(Array.from(unpacked.encryptedData)).to.deep.equal([1, 2, 3]);
    expect(() => unpackEncryptedAssetBundle(new ArrayBuffer(4))).to.throw('incomplete');
  });

});
