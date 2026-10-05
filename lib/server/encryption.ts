import crypto from 'crypto';

/**
 * Encrypts a buffer using AES-256-GCM.
 * @param buffer The plaintext data.
 * @returns An object containing the encrypted buffer, IV (base64), Auth Tag (base64), and File Hash (sha256 hex).
 */
export function encryptFile(buffer: Buffer): {
  encryptedBuffer: Buffer;
  keyBase64: string;
  ivBase64: string;
  authTagBase64: string;
  fileHashHex: string;
} {
  // 1. Generate 256-bit (32 byte) key and 96-bit (12 byte) IV
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  // 2. Hash the original file for verification later
  const fileHashHex = crypto.createHash('sha256').update(buffer).digest('hex');

  // 3. Encrypt
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedBuffer = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedBuffer,
    keyBase64: key.toString('base64'),
    ivBase64: iv.toString('base64'),
    authTagBase64: authTag.toString('base64'),
    fileHashHex,
  };
}

/**
 * Server-side decryption (Not typically used since MVP prefers client-side decryption, 
 * but good for tests or admin routes if ever needed).
 */
export function decryptFile(
  encryptedBuffer: Buffer,
  keyBase64: string,
  ivBase64: string,
  authTagBase64: string
): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
}
