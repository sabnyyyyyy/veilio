import path from 'path';

/**
 * Root directory of the file-backed stores (services, refunds, transactions, replays, ...).
 * `VEILIO_DATA_DIR` points them elsewhere: `hardhat test` sets it to a throwaway temp dir so
 * test fixtures never land in the real `data/` folder; a deployment can point it at a volume.
 */
export function getDataDir(): string {
  return process.env.VEILIO_DATA_DIR ? path.resolve(process.env.VEILIO_DATA_DIR) : path.join(process.cwd(), 'data');
}
