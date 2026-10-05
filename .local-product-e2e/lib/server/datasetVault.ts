import crypto from 'crypto';

const DATABASE_AAD = Buffer.from('VEILIO_ASSET_DATABASE_V1', 'utf8');

export interface EncryptedDatabase {
  version: 1;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function parseAssetMasterKey(value = process.env.ASSET_KEY_ENCRYPTION_KEY): Buffer {
  if (!value) throw new Error('ASSET_KEY_ENCRYPTION_KEY is required to read or write asset storage.');
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== value.trim().replace(/=+$/, '')) {
    throw new Error('ASSET_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function encryptDatabase(plainText: string, masterKey: Buffer): EncryptedDatabase {
  if (masterKey.length !== 32) throw new Error('Asset master key must be 32 bytes.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(DATABASE_AAD);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptDatabase(envelope: EncryptedDatabase, masterKey: Buffer): string {
  if (envelope.version !== 1 || masterKey.length !== 32) throw new Error('Unsupported encrypted asset database format.');
  const iv = Buffer.from(envelope.iv, 'base64');
  const authTag = Buffer.from(envelope.authTag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  if (iv.length !== 12 || authTag.length !== 16) throw new Error('Encrypted asset database metadata is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAAD(DATABASE_AAD);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
