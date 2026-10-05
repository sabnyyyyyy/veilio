/**
 * Client-side decryption utility using Web Crypto API.
 */

// Helper: base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decryptDatasetClientSide(
  encryptedDataInput: string | Uint8Array,
  keyBase64: string,
  ivBase64: string,
  authTagBase64: string,
  expectedSha256?: string,
): Promise<Blob> {
  const encryptedData = typeof encryptedDataInput === 'string' ? base64ToUint8Array(encryptedDataInput) : encryptedDataInput;
  const keyBytes = base64ToUint8Array(keyBase64);
  const iv = base64ToUint8Array(ivBase64);
  const authTag = base64ToUint8Array(authTagBase64);

  // In Web Crypto API, the ciphertext and the auth tag must be concatenated
  // AES-GCM expects: [ciphertext...][authTag (typically 16 bytes)]
  const ciphertextAndTag = new Uint8Array(encryptedData.length + authTag.length);
  ciphertextAndTag.set(encryptedData, 0);
  ciphertextAndTag.set(authTag, encryptedData.length);

  // Import the raw AES key
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      // tagLength is in bits
      tagLength: authTag.length * 8,
    },
    cryptoKey,
    ciphertextAndTag as BufferSource
  );

  if (expectedSha256) {
    const digest = await window.crypto.subtle.digest('SHA-256', decryptedBuffer);
    const actualHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error('Asset integrity check failed. The decrypted file does not match its published SHA-256 hash.');
    }
  }

  return new Blob([decryptedBuffer]);
}

export interface EncryptedAssetBundle {
  metadata: {
    fileName: string;
    mimeType: string;
    encryptionVersion: 'aes-256-gcm';
    fileHashHex: string;
    keyBase64: string;
    ivBase64: string;
    authTagBase64: string;
  };
  encryptedData: Uint8Array;
}

/** Bundle format: 4-byte big-endian metadata length, UTF-8 JSON metadata, then ciphertext bytes. */
export function unpackEncryptedAssetBundle(buffer: ArrayBuffer): EncryptedAssetBundle {
  if (buffer.byteLength < 5) throw new Error('Encrypted asset response is incomplete.');
  const view = new DataView(buffer);
  const metadataLength = view.getUint32(0, false);
  if (metadataLength <= 0 || metadataLength > 16 * 1024 || 4 + metadataLength >= buffer.byteLength) {
    throw new Error('Encrypted asset response header is invalid.');
  }
  const decoder = new TextDecoder();
  const metadata = JSON.parse(decoder.decode(new Uint8Array(buffer, 4, metadataLength))) as EncryptedAssetBundle['metadata'];
  if (
    metadata.encryptionVersion !== 'aes-256-gcm' ||
    typeof metadata.keyBase64 !== 'string' || typeof metadata.ivBase64 !== 'string' ||
    typeof metadata.authTagBase64 !== 'string' || typeof metadata.fileHashHex !== 'string' ||
    typeof metadata.fileName !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.fileHashHex)
  ) throw new Error('Encrypted asset response metadata is invalid.');
  return { metadata, encryptedData: new Uint8Array(buffer, 4 + metadataLength) };
}

/**
 * Triggers a browser download of a Blob.
 */
export function triggerDownload(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
