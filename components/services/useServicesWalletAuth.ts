'use client';

import { useCallback } from 'react';
import { useSignMessage } from 'wagmi';
import {
  createServiceAuthMessage,
  createServiceSessionMessage,
  encodeServiceAuthHeader,
  generateAuthNonce,
  isServiceSessionFresh,
  type ServiceAuthPayload,
} from '@/lib/serviceAuth';

/**
 * Client helpers for Services wallet authorization (EVM via wagmi, Solana via the injected
 * Phantom-compatible provider). See lib/serviceAuth.ts for the session scheme.
 */

const SESSION_STORAGE_PREFIX = 'veilio:services-session:';
const memorySessions = new Map<string, ServiceAuthPayload>();

export function isSolanaWalletAddress(address: string | null | undefined): boolean {
  return Boolean(address) && !String(address).startsWith('0x');
}

function cacheKey(address: string): string {
  return isSolanaWalletAddress(address) ? address : address.toLowerCase();
}

function readCachedSession(address: string): ServiceAuthPayload | null {
  const key = cacheKey(address);
  const inMemory = memorySessions.get(key);
  if (inMemory && isServiceSessionFresh(inMemory, address)) return inMemory;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as ServiceAuthPayload;
      if (isServiceSessionFresh(parsed, address)) {
        memorySessions.set(key, parsed);
        return parsed;
      }
    }
  } catch {
    // Storage unavailable (private mode / blocked): fall back to signing again.
  }
  return null;
}

function writeCachedSession(address: string, session: ServiceAuthPayload): void {
  const key = cacheKey(address);
  memorySessions.set(key, session);
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_PREFIX + key, JSON.stringify(session));
  } catch {
    // Non-critical convenience cache.
  }
}

export function clearServicesSession(address: string): void {
  const key = cacheKey(address);
  memorySessions.delete(key);
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_PREFIX + key);
  } catch {
    // ignore
  }
}

/** Signs a UTF-8 message with the injected Solana wallet; returns a 0x-hex Ed25519 signature. */
export async function signWithSolanaWallet(message: string): Promise<string> {
  const provider = typeof window !== 'undefined' ? (window as any).solana : null;
  if (!provider?.signMessage) {
    throw new Error('Connected Solana wallet does not support message signing.');
  }
  const res = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
  const sigBytes = res?.signature || res;
  return '0x' + Buffer.from(sigBytes).toString('hex');
}

export function useServicesWalletAuth() {
  const { signMessageAsync } = useSignMessage();

  const signMessageFor = useCallback(
    async (address: string, message: string): Promise<string> => {
      if (isSolanaWalletAddress(address)) return signWithSolanaWallet(message);
      return signMessageAsync({ message });
    },
    [signMessageAsync]
  );

  /** Returns a cached, still-valid read/chat session or asks the wallet to sign a new one. */
  const getSession = useCallback(
    async (address: string): Promise<ServiceAuthPayload> => {
      const cached = readCachedSession(address);
      if (cached) return cached;
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const signature = await signMessageFor(address, createServiceSessionMessage({ address, timestamp, nonce }));
      const session: ServiceAuthPayload = { address, signature, timestamp, nonce };
      writeCachedSession(address, session);
      return session;
    },
    [signMessageFor]
  );

  /** Header map carrying the session for GET requests. */
  const getSessionHeaders = useCallback(
    async (address: string): Promise<Record<string, string>> => encodeServiceAuthHeader(await getSession(address)),
    [getSession]
  );

  /** One-time, nonce-consuming signature for a state-changing action. */
  const signAction = useCallback(
    async (address: string, action: string, scopeId: string): Promise<ServiceAuthPayload> => {
      const timestamp = Date.now();
      const nonce = generateAuthNonce();
      const message = createServiceAuthMessage({ action, orderId: scopeId, address, timestamp, nonce });
      const signature = await signMessageFor(address, message);
      return { address, signature, timestamp, nonce };
    },
    [signMessageFor]
  );

  return { getSession, getSessionHeaders, signAction, signMessageFor };
}
