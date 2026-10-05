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
  assetType?: 'dataset' | 'ai-model' | 'nft' | '3d-asset' | 'software-license' | 'digital-media';
  deliveryMethod?: 'encrypted-download' | 'nft-transfer' | 'license-access';
  assetDetails?: Record<string, string>;
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

export function assetStorageConfigurationError(): string | null {
  if (process.env.NODE_ENV !== 'production') return null;
  const configuredPath = process.env.VEILIO_ASSET_STORAGE_DIR;
  if (!configuredPath || !path.isAbsolute(configuredPath)) return 'A durable absolute VEILIO_ASSET_STORAGE_DIR is required in production.';
  const publicDirectory = path.resolve(process.cwd(), 'public').toLowerCase();
  const resolvedPath = path.resolve(configuredPath).toLowerCase();
  if (resolvedPath === publicDirectory || resolvedPath.startsWith(`${publicDirectory}${path.sep.toLowerCase()}`)) return 'Asset storage cannot be placed inside the public directory.';
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

export function saveDatasetRecord(record: DatasetRecord) {
  const database = readDb();
  database.records[record.datasetId] = record;
  writeDb(database);
}

export function getDatasetRecord(datasetId: string): DatasetRecord | null {
  const database = readDb();
  return database.records[datasetId] || null;
}

export function linkAuctionToDataset(datasetId: string, auctionId: string) {
  const database = readDb();
  if (database.records[datasetId]) {
    database.records[datasetId].auctionId = auctionId;
    writeDb(database);
  }
}

export function getDatasetRecordByAuctionId(auctionId: string): DatasetRecord | null {
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
