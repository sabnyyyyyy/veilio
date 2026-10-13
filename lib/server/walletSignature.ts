/**
 * Wallet signature verification shared by auction/asset API routes.
 * EVM: EIP-191 personal_sign (viem verifyMessage). Solana: ed25519 over the
 * UTF-8 message bytes (Phantom `signMessage`), signature as 0x-hex or base58.
 */

import { isAddress, verifyMessage } from 'viem';
import { ed25519 } from '@noble/curves/ed25519';
import { decodeBase58 } from '../cross-chain/solanaServiceRegistry';

export function isSolanaWalletAddress(address: string): boolean {
  if (typeof address !== 'string' || address.length < 32 || address.length > 44) return false;
  try {
    return decodeBase58(address).length === 32;
  } catch {
    return false;
  }
}

function parseSolanaSignature(signature: string): Uint8Array | null {
  try {
    if (/^0x[0-9a-fA-F]{128}$/.test(signature)) return new Uint8Array(Buffer.from(signature.slice(2), 'hex'));
    const decoded = decodeBase58(signature);
    return decoded.length === 64 ? decoded : null;
  } catch {
    return null;
  }
}

/** Returns true only for a valid signature of `message` by `address`. Never throws. */
export async function verifyWalletSignature(params: { address: string; message: string; signature: unknown }): Promise<boolean> {
  const { address, message, signature } = params;
  if (typeof signature !== 'string' || !signature) return false;
  try {
    if (isAddress(address, { strict: false })) {
      if (!signature.startsWith('0x')) return false;
      return await verifyMessage({ address, message, signature: signature as `0x${string}` });
    }
    if (isSolanaWalletAddress(address)) {
      const sig = parseSolanaSignature(signature);
      if (!sig) return false;
      return ed25519.verify(sig, new Uint8Array(Buffer.from(message, 'utf8')), decodeBase58(address));
    }
  } catch {
    return false;
  }
  return false;
}

/** True for a 20-byte EVM address or a 32-byte base58 Solana public key. */
export function isSupportedWalletAddress(address: unknown): address is string {
  return typeof address === 'string' && (isAddress(address, { strict: false }) || isSolanaWalletAddress(address));
}

/** Lowercases EVM addresses only; Solana base58 keys are case-sensitive. */
export function normalizeWalletAddress(address: string): string {
  return isAddress(address, { strict: false }) ? address.toLowerCase() : address;
}

export function sameWalletAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeWalletAddress(a) === normalizeWalletAddress(b);
}
