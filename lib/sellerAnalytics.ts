import { decodeBase58 } from './cross-chain/solanaServiceRegistry';

export type NetworkKey = 'bnb' | 'base' | 'solana';

export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  try {
    const bytes = decodeBase58(address.trim());
    return bytes.length === 32;
  } catch {
    return false;
  }
}

export function formatShortAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function getExplorerLink(network: NetworkKey, type: 'address' | 'tx', identifier: string): string {
  if (!identifier) return '#';
  if (network === 'bnb') {
    return `https://testnet.bscscan.com/${type}/${encodeURIComponent(identifier)}`;
  }
  if (network === 'base') {
    return `https://sepolia.basescan.org/${type}/${encodeURIComponent(identifier)}`;
  }
  return `https://explorer.solana.com/${type}/${encodeURIComponent(identifier)}?cluster=devnet`;
}
