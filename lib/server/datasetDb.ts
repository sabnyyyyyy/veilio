import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { decryptDatabase, encryptDatabase, parseAssetMasterKey, type EncryptedDatabase } from './datasetVault';
import { assetRedisCommand, isAssetRedisConfigured } from './redisRest';

export interface DatasetRecord {
  datasetId: string;
  auctionId?: string;
  uploader?: string;
  uploadNonce?: string;
  assetType?: 'dataset' | 'ai-model' | 'data-license' | 'api-license' | 'software-license' | 'nft' | 'digital-asset' | '3d-asset' | 'digital-media';
  deliveryMethod?: 'encrypted-download' | 'nft-transfer' | 'license-access' | 'api-credential';
  assetDetails?: Record<string, string>;
  professionalMetadata?: {
    licenseType?: string;
    usageRights?: string;
    format?: string;
    region?: string;
    language?: string;
    dataPeriod?: string;
    updateFrequency?: string;
    schemaOrSpecification?: string;
    agentCompatible?: boolean;
    [key: string]: unknown;
  };
  fileName: string;
  mimeType: string;
  size: number;
  fileHashHex: string;
  encryptedFilePath: string;
  manifest?: {
    format: string;
    recordCount: number;
    columnCount: number;
    columns: string[];
    schema?: unknown[];
    nullRates?: Record<string, number>;
    duplicateRate?: number;
    sample?: unknown[];
    [key: string]: unknown;
  };
  publicPreviewEnabled?: boolean;
  // The whole database, including this per-file key, is encrypted at rest.
  encryptionVersion: 'aes-256-gcm';
  keyBase64: string;
  ivBase64: string;
  authTagBase64: string;
  createdAt: number;
}

interface DatasetDatabase {
  records: Record<string, DatasetRecord>;
  consumedUploadNonces: Record<string, number>;
}

const DATA_DIR = process.env.VEILIO_ASSET_STORAGE_DIR || path.join(process.cwd(), 'data');
const ENCRYPTED_DIR = path.join(DATA_DIR, 'encrypted');
const DB_FILE = path.join(DATA_DIR, 'db', 'datasets.json');
const REDIS_RECORD_PREFIX = 'veilio:asset:record:';
const REDIS_AUCTION_PREFIX = 'veilio:asset:auction:';
const REDIS_PENDING_PREFIX = 'veilio:asset:pending:';
const REDIS_DATASET_LINK_PREFIX = 'veilio:asset:dataset-link:';
const LINK_ASSET_SCRIPT = [
  "if not redis.call('GET', KEYS[1]) then return -1 end",
  "local linkedAuction = redis.call('GET', KEYS[3])",
  "if linkedAuction and linkedAuction ~= ARGV[1] then return 0 end",
  "local linkedDataset = redis.call('GET', KEYS[2])",
  "if linkedDataset and linkedDataset ~= ARGV[2] then return 0 end",
  "redis.call('SET', KEYS[1], ARGV[3])",
  "redis.call('SET', KEYS[2], ARGV[2])",
  "redis.call('SET', KEYS[3], ARGV[1])",
  'return 1',
].join('\n');

export function assetStorageConfigurationError(): string | null {
  if (process.env.NODE_ENV !== 'production') return null;
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 'Private Vercel Blob is not configured. Connect a private Blob store to this Vercel project.';
  if (!isAssetRedisConfigured()) return 'Persistent asset metadata storage is not configured. Connect an HTTPS Redis REST database.';
  if (!process.env.MALWARE_SCAN_API_KEY) return 'Malware scanning is not configured. Set MALWARE_SCAN_API_KEY before accepting product files.';
  return null;
}

const emptyDatabase = (): DatasetDatabase => ({ records: {}, consumedUploadNonces: {} });

function secureDirectory(directory: string) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

function ensureDirectories() {
  secureDirectory(DATA_DIR);
  secureDirectory(ENCRYPTED_DIR);
  secureDirectory(path.dirname(DB_FILE));
}

function writeDb(database: DatasetDatabase) {
  ensureDirectories();
  const masterKey = parseAssetMasterKey();
  const envelope = encryptDatabase(JSON.stringify(database), masterKey);
  const temporaryFile = `${DB_FILE}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    fs.renameSync(temporaryFile, DB_FILE);
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true });
    throw error;
  }
  if (process.platform !== 'win32') fs.chmodSync(DB_FILE, 0o600);
}

function readDb(): DatasetDatabase {
  ensureDirectories();
  if (!fs.existsSync(DB_FILE)) return emptyDatabase();
  const serialized = fs.readFileSync(DB_FILE, 'utf8');
  const parsed = JSON.parse(serialized) as Partial<EncryptedDatabase> & Record<string, unknown>;

  if (parsed.version === 1 && typeof parsed.ciphertext === 'string') {
    const masterKey = parseAssetMasterKey();
    const plain = decryptDatabase(parsed as EncryptedDatabase, masterKey);
    const database = JSON.parse(plain) as DatasetDatabase;
    if (!database.records || !database.consumedUploadNonces) throw new Error('Asset database contents are invalid.');
    return database;
  }

  // Migrate the previous plaintext JSON database on first access. Once saved,
  // replace it with the encrypted envelope so file keys and samples are not
  // left readable at rest.
  const legacyDatabase: DatasetDatabase = {
    records: parsed as Record<string, DatasetRecord>,
    consumedUploadNonces: {},
  };
  writeDb(legacyDatabase);
  return legacyDatabase;
}

function redisRecordKey(datasetId: string) { return `${REDIS_RECORD_PREFIX}${datasetId}`; }
function redisAuctionKey(auctionId: string) { return `${REDIS_AUCTION_PREFIX}${auctionId}`; }
function encryptStoredJson(value: unknown) {
  return JSON.stringify(encryptDatabase(JSON.stringify(value), parseAssetMasterKey()));
}
function decryptStoredJson<T>(serialized: string): T {
  const envelope = JSON.parse(serialized) as EncryptedDatabase;
  return JSON.parse(decryptDatabase(envelope, parseAssetMasterKey())) as T;
}

export interface PendingAssetUpload {
  datasetId: string;
  status: 'uploading' | 'processing' | 'rejected';
  address: string;
  assetType: DatasetRecord['assetType'];
  fileName: string;
  fileSize: number;
  nonce: string;
  timestamp: number;
  signature: string;
  fileHashHex: string;
  keyBase64: string;
  ivBase64: string;
  licenseType?: string;
  accessInstructions?: string;
  error?: string;
}

export async function createPendingAssetUpload(upload: PendingAssetUpload) {
  if (!isAssetRedisConfigured()) throw new Error('Persistent upload state requires Redis REST.');
  const result = await assetRedisCommand<string | null>([
    'SET', `${REDIS_PENDING_PREFIX}${upload.datasetId}`, encryptStoredJson(upload), 'EX', '3600', 'NX',
  ]);
  if (result !== 'OK') throw new Error('This upload session already exists or expired.');
}

export async function getPendingAssetUpload(datasetId: string): Promise<PendingAssetUpload | null> {
  if (!isAssetRedisConfigured()) return null;
  const value = await assetRedisCommand<string | null>(['GET', `${REDIS_PENDING_PREFIX}${datasetId}`]);
  return value ? decryptStoredJson<PendingAssetUpload>(value) : null;
}

export async function updatePendingAssetUpload(upload: PendingAssetUpload) {
  await assetRedisCommand(['SET', `${REDIS_PENDING_PREFIX}${upload.datasetId}`, encryptStoredJson(upload), 'EX', '3600']);
}

export async function deletePendingAssetUpload(datasetId: string) {
  if (isAssetRedisConfigured()) await assetRedisCommand(['DEL', `${REDIS_PENDING_PREFIX}${datasetId}`]);
}

export async function saveDatasetRecord(record: DatasetRecord) {
  if (isAssetRedisConfigured()) {
    const result = await assetRedisCommand<string | null>(['SET', redisRecordKey(record.datasetId), encryptStoredJson(record), 'NX']);
    if (result !== 'OK') throw new Error('Asset record already exists.');
    return;
  }
  const database = readDb();
  database.records[record.datasetId] = record;
  writeDb(database);
}

export async function getDatasetRecord(datasetId: string): Promise<DatasetRecord | null> {
  if (isAssetRedisConfigured()) {
    const value = await assetRedisCommand<string | null>(['GET', redisRecordKey(datasetId)]);
    return value ? decryptStoredJson<DatasetRecord>(value) : null;
  }
  const database = readDb();
  return database.records[datasetId] || null;
}

export async function updateDatasetRecord(record: DatasetRecord) {
  if (isAssetRedisConfigured()) {
    const result = await assetRedisCommand<number>([
      'EVAL',
      "if not redis.call('GET', KEYS[1]) then return 0 end; redis.call('SET', KEYS[1], ARGV[1]); return 1",
      '1', redisRecordKey(record.datasetId), encryptStoredJson(record),
    ]);
    if (Number(result) !== 1) throw new Error('Asset record no longer exists.');
    return;
  }
  const database = readDb();
  if (!database.records[record.datasetId]) throw new Error('Asset record no longer exists.');
  database.records[record.datasetId] = record;
  writeDb(database);
}

export async function linkAuctionToDataset(datasetId: string, auctionId: string) {
  if (isAssetRedisConfigured()) {
    const record = await getDatasetRecord(datasetId);
    if (!record) return;
    if (record.auctionId && record.auctionId !== auctionId) throw new Error('Asset is already linked to another auction.');
    record.auctionId = auctionId;
    const result = await assetRedisCommand<number>([
      'EVAL', LINK_ASSET_SCRIPT, '3',
      redisRecordKey(datasetId), redisAuctionKey(auctionId), `${REDIS_DATASET_LINK_PREFIX}${datasetId}`,
      datasetId, auctionId, encryptStoredJson(record),
    ]);
    if (Number(result) === -1) throw new Error('Uploaded asset record no longer exists.');
    if (Number(result) !== 1) throw new Error('Auction or asset is already linked to a different record.');
    return;
  }
  const database = readDb();
  if (database.records[datasetId]) {
    database.records[datasetId].auctionId = auctionId;
    writeDb(database);
  }
}

export async function getDatasetRecordByAuctionId(auctionId: string): Promise<DatasetRecord | null> {
  if (isAssetRedisConfigured()) {
    const datasetId = await assetRedisCommand<string | null>(['GET', redisAuctionKey(auctionId)]);
    return datasetId ? getDatasetRecord(datasetId) : null;
  }
  const database = readDb();
  return Object.values(database.records).find((record) => record.auctionId === auctionId) || null;
}

/** Consume a signed upload nonce once; the nonce table is encrypted with the asset database. */
export async function consumeUploadNonce(nonce: string, now = Date.now()): Promise<boolean> {
  if (isAssetRedisConfigured()) {
    const result = await assetRedisCommand<string | null>(['SET', `veilio:asset-upload-nonce:${nonce}`, '1', 'EX', '600', 'NX']);
    return result === 'OK';
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Shared asset nonce store is not configured.');
  const database = readDb();
  const cutoff = now - 10 * 60 * 1000;
  for (const [key, timestamp] of Object.entries(database.consumedUploadNonces)) {
    if (timestamp < cutoff) delete database.consumedUploadNonces[key];
  }
  if (database.consumedUploadNonces[nonce]) return false;
  database.consumedUploadNonces[nonce] = now;
  writeDb(database);
  return true;
}

export function getEncryptedDir() {
  ensureDirectories();
  return ENCRYPTED_DIR;
}

export function getEncryptedFilePath(fileName: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.enc$/i.test(fileName)) return null;
  return path.join(getEncryptedDir(), fileName);
}
