import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const base = 'http://127.0.0.1:3100';
const contract = '0x13C16c508780639E86cA9d4322Ba9739C15e78Af';
const account = privateKeyToAccount(generatePrivateKey());
const results = [];
const uploads = [];
const signedMessage = ({ type, name, bytes, timestamp, nonce }) => [
  'VEILIO ASSET ACCESS V1', 'Action: upload', 'Chain ID: 97',
  `Contract: ${contract.toLowerCase()}`, `Wallet: ${account.address.toLowerCase()}`,
  `Asset type: ${type}`, `File: ${name}`, `Bytes: ${bytes.length}`,
  `Timestamp: ${timestamp}`, `Nonce: ${nonce}`,
].join('\n');

async function upload({ type, name, bytes, licenseType, accessInstructions, signed = true, nonce = crypto.randomUUID() }) {
  const timestamp = Date.now();
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  form.append('assetType', type);
  if (signed) {
    form.append('walletAddress', account.address);
    form.append('timestamp', String(timestamp));
    form.append('nonce', nonce);
    form.append('signature', await account.signMessage({ message: signedMessage({ type, name, bytes, timestamp, nonce }) }));
  }
  if (licenseType) form.append('licenseType', licenseType);
  if (accessInstructions) form.append('accessInstructions', accessInstructions);
  const response = await fetch(`${base}/api/datasets/upload`, { method: 'POST', body: form });
  return { response, json: await response.json(), nonce };
}

const page = await fetch(`${base}/create`);
assert.equal(page.status, 200, 'create page returns HTTP 200');
const html = await page.text();
const source = fs.readFileSync(path.resolve('app/create/page.tsx'), 'utf8');
assert.ok(source.includes('Product Cover'), 'listing form source shows Product Cover');
assert.ok(!source.includes('V4 NFT ESCROW CONTRACT'), 'listing form source hides contract badge');
assert.ok(source.includes("format === 'PARQUET' ? 'Not analyzed'"), 'Parquet metrics are clearly marked as not analyzed');
assert.ok(!html.includes('V4 NFT ESCROW CONTRACT'), 'initial page render hides contract badge');
results.push({ name: 'Create listing UI', status: 'PASS', checks: ['Product Cover label', 'contract badge hidden', 'Parquet metrics not misleading'] });

const csv = Buffer.from('id,name,price\n' + Array.from({ length: 12 }, (_, i) => `${i + 1},product-${i + 1},${100 + i}`).join('\n') + '\n');
const quoted = Buffer.from('id,name,note\n' + ['1,"Alice, Jr.","said ""hello"""', ...Array.from({ length: 10 }, (_, i) => `${i + 2},User${i + 2},note`)].join('\n') + '\n');
const json = Buffer.from(JSON.stringify([{ id: 1, label: 'alpha' }, { id: 2, label: 'beta' }]));
const parquet = Buffer.from('PAR1sample parquet fixturePAR1');
const ai = Buffer.from([0x4f, 0x4e, 0x4e, 0x58, 0, 1, 255, 42]);
const cad = Buffer.from('solid test\n facet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 1 0 0\n vertex 0 1 0\n endloop\n endfacet\nendsolid test\n');
const license = Buffer.from('TEST LICENSE\nFor local integration testing only.');
const media = Buffer.from('RIFFTEST WAVE fixture bytes');
const cases = [
  { type: 'dataset', name: 'products.csv', bytes: csv, format: 'CSV', records: 12, columns: 3 },
  { type: 'dataset', name: 'quoted.csv', bytes: quoted, format: 'CSV', records: 11, columns: 3, firstSample: { id: '1', name: 'Alice, Jr.', note: 'said "hello"' } },
  { type: 'dataset', name: 'products.json', bytes: json, format: 'JSON', records: 2, columns: 2 },
  { type: 'dataset', name: 'sample.parquet', bytes: parquet, format: 'PARQUET', records: 0, columns: 0 },
  { type: 'ai-model', name: 'model.safetensors', bytes: ai, format: 'UNKNOWN', records: 0, columns: 0 },
  { type: '3d-asset', name: 'part.stl', bytes: cad, format: 'UNKNOWN', records: 0, columns: 0 },
  { type: 'software-license', name: 'license.txt', bytes: license, format: 'UNKNOWN', records: 0, columns: 0, licenseType: 'single-user', accessInstructions: 'Local E2E test delivery instructions.' },
  { type: 'digital-media', name: 'sample.wav', bytes: media, format: 'UNKNOWN', records: 0, columns: 0 },
];
for (const item of cases) {
  const result = await upload(item);
  assert.equal(result.response.status, 200, `${item.type}/${item.name}: ${result.json.error || ''}`);
  assert.equal(result.json.success, true);
  assert.equal(result.json.dataset.manifest.format, item.format);
  assert.equal(result.json.dataset.manifest.recordCount, item.records);
  assert.equal(result.json.dataset.manifest.columnCount, item.columns);
  assert.equal(result.json.dataset.fileHashHex, crypto.createHash('sha256').update(item.bytes).digest('hex'));
  if (item.firstSample) assert.deepEqual(result.json.dataset.manifest.sample[0], item.firstSample, 'quoted CSV values parse correctly');
  for (const key of ['keyBase64', 'ivBase64', 'authTagBase64', 'accessInstructions']) assert.ok(!(key in result.json.dataset), `response does not leak ${key}`);
  uploads.push({ ...item, datasetId: result.json.dataset.datasetId, hash: result.json.dataset.fileHashHex, nonce: result.nonce });
  results.push({ name: `Upload ${item.type}/${item.name}`, status: 'PASS', format: item.format, records: item.records, columns: item.columns });
}

const malformed = await upload({ type: 'dataset', name: 'malformed.csv', bytes: Buffer.from('id,name\n1,"unfinished') });
assert.equal(malformed.response.status, 400, 'malformed quoted CSV is rejected');
results.push({ name: 'Malformed CSV rejection', status: 'PASS', httpStatus: 400 });
const ragged = await upload({ type: 'dataset', name: 'ragged.csv', bytes: Buffer.from('id,name\n1,one,extra') });
assert.equal(ragged.response.status, 400, 'inconsistent CSV row width is rejected');
results.push({ name: 'Inconsistent CSV row rejection', status: 'PASS', httpStatus: 400 });
const replay = await upload({ ...cases[0], nonce: uploads[0].nonce });
assert.equal(replay.response.status, 409, 'used upload nonce is rejected');
results.push({ name: 'Upload nonce replay protection', status: 'PASS', httpStatus: 409 });
const unsigned = await upload({ ...cases[4], signed: false });
assert.equal(unsigned.response.status, 401, 'unsigned upload is rejected');
results.push({ name: 'Unsigned upload rejection', status: 'PASS', httpStatus: 401 });
const nftFile = await upload({ type: 'nft', name: 'token.png', bytes: Buffer.from('fixture') });
assert.equal(nftFile.response.status, 400);
assert.match(nftFile.json.error, /does not support encrypted file uploads/i);
results.push({ name: 'NFT file-upload routing', status: 'PASS', detail: 'NFT uses token-address/token-ID escrow flow, not file upload' });

const storage = path.resolve(process.cwd(), '..', 'data', 'local-product-e2e-storage');
const envelope = JSON.parse(fs.readFileSync(path.join(storage, 'db', 'datasets.json'), 'utf8'));
const masterKey = Buffer.from('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=', 'base64');
const dbDecipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(envelope.iv, 'base64'));
dbDecipher.setAAD(Buffer.from('VEILIO_ASSET_DATABASE_V1'));
dbDecipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
const database = JSON.parse(Buffer.concat([dbDecipher.update(Buffer.from(envelope.ciphertext, 'base64')), dbDecipher.final()]).toString('utf8'));
for (const item of uploads) {
  const record = database.records[item.datasetId];
  assert.ok(record, `${item.datasetId} persisted in encrypted metadata DB`);
  assert.equal(record.assetType, item.type);
  assert.equal(record.fileHashHex, item.hash);
  const encrypted = fs.readFileSync(path.join(storage, 'encrypted', record.encryptedFilePath));
  assert.ok(!encrypted.equals(item.bytes), `${item.type} is encrypted at rest`);
  const fileDecipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(record.keyBase64, 'base64'), Buffer.from(record.ivBase64, 'base64'));
  fileDecipher.setAuthTag(Buffer.from(record.authTagBase64, 'base64'));
  const original = Buffer.concat([fileDecipher.update(encrypted), fileDecipher.final()]);
  assert.ok(original.equals(item.bytes), `${item.type} decrypts exactly`);
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), item.hash);
  if (item.type === 'software-license') {
    assert.equal(record.deliveryMethod, 'license-access');
    assert.equal(record.assetDetails.licenseType, 'single-user');
    assert.equal(record.assetDetails.accessInstructions, 'Local E2E test delivery instructions.');
  }
}
results.push({ name: 'Encrypted storage and integrity', status: 'PASS', files: uploads.length, checks: ['per-type metadata', 'AES-256-GCM round-trip', 'SHA-256 verified', 'license delivery metadata'] });
console.log(JSON.stringify({ overall: 'PASS', wallet: 'ephemeral local signer only', chainTransactions: 0, results }, null, 2));