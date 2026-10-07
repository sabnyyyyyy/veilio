export const MAX_ASSET_UPLOAD_BYTES = 100 * 1024 * 1024;

const allowedExtensions: Record<string, Set<string>> = {
  dataset: new Set(['.csv', '.json', '.parquet']),
  'ai-model': new Set(['.onnx', '.pt', '.pth', '.safetensors', '.gguf', '.tflite', '.model', '.bin', '.pb', '.h5', '.keras', '.ckpt', '.mlmodel', '.zip']),
  'data-license': new Set(['.csv', '.json', '.parquet', '.pdf', '.txt', '.md', '.zip']),
  'api-license': new Set(['.json', '.yaml', '.yml', '.txt', '.pdf', '.zip']),
  'software-license': new Set(['.pdf', '.txt', '.md', '.zip', '.tar', '.gz']),
  'digital-asset': new Set(['.zip', '.tar', '.gz', '.json', '.bin', '.pdf', '.txt']),
  '3d-asset': new Set(['.stl', '.obj', '.fbx', '.step', '.stp', '.3mf', '.gltf', '.glb', '.iges', '.igs', '.blend', '.usd', '.usdz', '.dae', '.ply', '.3ds', '.gcode', '.zip']),
  'digital-media': new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.tif', '.tiff', '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.flac', '.aiff', '.ogg', '.aac', '.pdf', '.zip']),
};

export function sanitizeAssetFileName(fileName: string) {
  const normalized = fileName.replace(/\\/g, '/');
  return normalized.split('/').pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || '';
}

export function validateAssetUpload(assetType: string, fileName: string, fileSize: number): string | null {
  const safeName = sanitizeAssetFileName(fileName);
  const extensions = allowedExtensions[assetType];
  if (!extensions) return 'This asset type does not support encrypted file uploads.';
  if (!safeName || safeName.length > 180 || safeName === '.' || safeName === '..') return 'Enter a valid file name (up to 180 characters).';
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return 'The uploaded file is empty or has an invalid size.';
  if (fileSize > MAX_ASSET_UPLOAD_BYTES) return `Files must be ${Math.floor(MAX_ASSET_UPLOAD_BYTES / 1024 / 1024)} MB or smaller.`;
  const extension = safeName.slice(safeName.lastIndexOf('.')).toLowerCase();
  if (!extensions.has(extension)) return `File type ${extension || '(no extension)'} is not supported for ${assetType}.`;
  return null;
}
