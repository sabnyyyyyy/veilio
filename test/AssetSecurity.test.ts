import { expect } from 'chai';
import crypto from 'crypto';
import net from 'node:net';
import path from 'node:path';
import { verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assetUploadMessage } from '../lib/assetAuth';
import { sanitizeAssetFileName, validateAssetUpload, MAX_ASSET_UPLOAD_BYTES } from '../lib/assetPolicy';
import { decryptFile, encryptFile } from '../lib/server/encryption';
import { decryptDatabase, encryptDatabase, parseAssetMasterKey } from '../lib/server/datasetVault';
import { allowAssetUpload } from '../lib/server/uploadRateLimit';
import { scanAssetBuffer } from '../lib/server/malwareScan';
import { unpackEncryptedAssetBundle } from '../lib/client/decryption';
import { assetStorageConfigurationError } from '../lib/server/datasetDb';
import { parseCsvRows } from '../lib/csvParser';

describe('VEILIO encrypted asset security', function () {
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

  it('requires an explicit durable private asset volume in production', function () {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousStorage = process.env.VEILIO_ASSET_STORAGE_DIR;
    process.env.NODE_ENV = 'production';
    try {
      delete process.env.VEILIO_ASSET_STORAGE_DIR;
      expect(assetStorageConfigurationError()).to.contain('durable absolute');
      process.env.VEILIO_ASSET_STORAGE_DIR = path.resolve(process.cwd(), 'public', 'assets');
      expect(assetStorageConfigurationError()).to.contain('public directory');
      process.env.VEILIO_ASSET_STORAGE_DIR = path.resolve(process.cwd(), 'private-asset-volume');
      expect(assetStorageConfigurationError()).to.equal(null);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousStorage === undefined) delete process.env.VEILIO_ASSET_STORAGE_DIR;
      else process.env.VEILIO_ASSET_STORAGE_DIR = previousStorage;
    }
  });

  it('fails closed when ClamAV detects malware and accepts a clean scan', async function () {
    const previousHost = process.env.CLAMAV_HOST;
    const previousPort = process.env.CLAMAV_PORT;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.CLAMAV_HOST = '127.0.0.1';
    const runScanner = async (reply: string) => {
      const server = net.createServer((socket) => {
        let request = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          request = Buffer.concat([request, chunk]);
          if (request.length >= 4 && request.subarray(-4).every((byte) => byte === 0)) socket.end(reply + '\0');
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addressInfo = server.address();
      if (!addressInfo || typeof addressInfo === 'string') throw new Error('Could not start fake ClamAV server.');
      process.env.CLAMAV_PORT = String(addressInfo.port);
      try { return await scanAssetBuffer(Buffer.from('dummy file')); }
      finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    };
    try {
      expect(await runScanner('stream: OK')).to.equal('clean');
      try {
        await runScanner('stream: Eicar-Test-Signature FOUND');
        expect.fail('infected file should be rejected');
      } catch (error) {
        expect((error as Error).message).to.contain('identified as malware');
      }
      delete process.env.CLAMAV_HOST;
      process.env.NODE_ENV = 'production';
      try {
        await scanAssetBuffer(Buffer.from('unscanned'));
        expect.fail('production should reject unscanned assets');
      } catch (error) {
        expect((error as Error).message).to.contain('not configured');
      }
    } finally {
      if (previousHost === undefined) delete process.env.CLAMAV_HOST;
      else process.env.CLAMAV_HOST = previousHost;
      if (previousPort === undefined) delete process.env.CLAMAV_PORT;
      else process.env.CLAMAV_PORT = previousPort;
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
