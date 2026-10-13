'use client';

/**
 * Browser helpers for Solana auction transactions and chain-aware signed
 * messages. Mirrors the commit/reveal path in app/auctions/[id]/page.tsx:
 * build with lib/cross-chain/solanaAuction.ts, sign with the injected wallet,
 * send and confirm on Devnet.
 */

import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { SolanaCompiledInstruction } from '../cross-chain/solanaServiceRegistry';
import {
  createAuctionAuthMessage,
  generateAuctionAuthNonce,
  type AuctionAuthPayload,
  type AuctionNetworkId,
} from '../auctionNetwork';

export function getSolanaRpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
}

function getInjectedSolana(): any {
  return typeof window !== 'undefined' ? (window as any).solana : undefined;
}

export async function connectSolanaWallet(): Promise<string> {
  const provider = getInjectedSolana();
  if (!provider) throw new Error('Install Phantom or another injected Solana wallet to use Solana Devnet auctions.');
  const resp = await provider.connect();
  return resp.publicKey.toString();
}

/** Signs, sends and confirms one or more auction instructions. Returns the signature. */
export async function sendSolanaAuctionInstructions(
  instructions: SolanaCompiledInstruction[],
  feePayer: string,
  label = 'Solana auction'
): Promise<string> {
  const provider = getInjectedSolana();
  if (!provider?.signTransaction) throw new Error('This Solana wallet cannot sign transactions from the app.');
  const connection = new Connection(getSolanaRpcUrl(), 'confirmed');
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: new PublicKey(feePayer), ...latestBlockhash });
  for (const inst of instructions) {
    transaction.add(new TransactionInstruction({
      programId: new PublicKey(inst.programId),
      keys: inst.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
      data: Buffer.from(inst.data),
    }));
  }
  const signed = await provider.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  const confirmation = await connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed');
  if (confirmation.value.err) throw new Error(`${label} transaction failed on Devnet.`);
  return signature;
}

/** Signs a UTF-8 message with the injected Solana wallet; returns 0x-hex ed25519 signature. */
export async function signSolanaMessage(message: string): Promise<string> {
  const provider = getInjectedSolana();
  if (!provider?.signMessage) throw new Error('This Solana wallet does not support message signing.');
  const res = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
  const sigBytes: Uint8Array = res?.signature || res;
  return `0x${Buffer.from(sigBytes).toString('hex')}`;
}

/**
 * Builds a signed auction authorization payload.
 * `signEvm` is wagmi's signMessageAsync for EVM networks; Solana uses the injected wallet.
 */
export async function buildAuctionAuth(params: {
  action: string;
  networkId: AuctionNetworkId;
  auctionId: string;
  address: string;
  signEvm?: (args: { message: string }) => Promise<string>;
}): Promise<AuctionAuthPayload> {
  const timestamp = Date.now();
  const nonce = generateAuctionAuthNonce();
  const message = createAuctionAuthMessage({ ...params, timestamp, nonce });
  let signature: string;
  if (params.networkId === 'solana:devnet') {
    signature = await signSolanaMessage(message);
  } else {
    if (!params.signEvm) throw new Error('Connect an EVM wallet to sign this request.');
    signature = await params.signEvm({ message });
  }
  return { address: params.address, signature, timestamp, nonce };
}

/** Signs an arbitrary message with the right wallet for the network. */
export async function signForNetwork(
  networkId: AuctionNetworkId,
  message: string,
  signEvm?: (args: { message: string }) => Promise<string>
): Promise<string> {
  if (networkId === 'solana:devnet') return signSolanaMessage(message);
  if (!signEvm) throw new Error('Connect an EVM wallet to sign this request.');
  return signEvm({ message });
}
