import { NextRequest, NextResponse } from 'next/server';
import { verifyMessage, createPublicClient, http, isAddress } from 'viem';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_ABI, VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';
import { getDatasetRecord, linkAuctionToDataset } from '@/lib/server/datasetDb';
import { datasetLinkMessage } from '@/lib/assetAuth';
import fs from 'node:fs/promises';
import path from 'node:path';
import { auditAssetEvent } from '@/lib/server/assetAudit';

const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://w3s.link/ipfs/', 'https://dweb.link/ipfs/', 'https://gateway.pinata.cloud/ipfs/'];

async function readBounded(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('Auction metadata is too large.');
  if (!response.body) throw new Error('Auction metadata response is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Auction metadata is too large.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString('utf8');
}

async function loadAuctionMetadata(uri: string): Promise<Record<string, unknown>> {
  const local = /^\/uploads\/(meta_[a-f0-9]{32}\.json)$/i.exec(uri);
  if (local) {
    const file = path.join(process.cwd(), 'public', 'uploads', local[1]);
    const stat = await fs.stat(file);
    if (stat.size > 64 * 1024) throw new Error('Auction metadata is too large.');
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  }

  const cid = uri.startsWith('ipfs://') ? uri.slice('ipfs://'.length).split('/')[0] : '';
  if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(cid)) {
    throw new Error('Auction metadata URI is not a supported IPFS metadata reference.');
  }
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const response = await fetch(`${gateway}${cid}`, { signal: AbortSignal.timeout(7000), headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      return JSON.parse(await readBounded(response, 64 * 1024)) as Record<string, unknown>;
    } catch { /* Try the next public gateway. */ }
  }
  throw new Error('Could not retrieve auction metadata from IPFS. Retry once the metadata is available.');
}

export async function POST(req: NextRequest) {
  try {
    const { datasetId, auctionId, address, signature, timestamp } = await req.json();

    if (!datasetId || !auctionId || !address || !signature || !timestamp) {
      return NextResponse.json({ error: 'Missing signed seller authorization' }, { status: 400 });
    }
    const id = String(auctionId);
    const time = Number(timestamp);
    if (!/^[1-9]\d{0,77}$/.test(id) || !isAddress(String(address)) || !Number.isSafeInteger(time)) {
      return NextResponse.json({ error: 'Invalid auction ID, wallet address, or timestamp.' }, { status: 400 });
    }
    if (Math.abs(Date.now() - time) > 5 * 60 * 1000) return NextResponse.json({ error: 'Authorization expired' }, { status: 401 });
    const message = datasetLinkMessage({ datasetId: String(datasetId), auctionId: id, address: String(address), timestamp: time });
    const valid = await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
    if (!valid) {
      auditAssetEvent({ action: 'link', result: 'denied', auctionId: id, walletAddress: String(address), reasonCode: 'invalid_signature' });
      return NextResponse.json({ error: 'Invalid seller signature' }, { status: 401 });
    }

    const record = getDatasetRecord(datasetId);
    if (!record) return NextResponse.json({ error: 'Dataset record not found' }, { status: 404 });
    if (record.uploader && record.uploader.toLowerCase() !== String(address).toLowerCase()) {
      auditAssetEvent({ action: 'link', result: 'denied', assetType: record.assetType, auctionId: id, walletAddress: String(address), reasonCode: 'uploader_mismatch' });
      return NextResponse.json({ error: 'Only the wallet that uploaded this asset may link it.' }, { status: 403 });
    }
    if (record.auctionId && record.auctionId !== String(auctionId)) return NextResponse.json({ error: 'Asset is already linked to another auction' }, { status: 409 });
    const client = createPublicClient({ chain: bnbChain, transport: http(process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || undefined) });
    const raw = await client.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'auctions', args: [BigInt(id)] }) as readonly unknown[];
    if (String(raw[0]) === '0') return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    if (String(raw[1]).toLowerCase() !== String(address).toLowerCase()) {
      auditAssetEvent({ action: 'link', result: 'denied', assetType: record.assetType, auctionId: id, walletAddress: String(address), reasonCode: 'onchain_seller_mismatch' });
      return NextResponse.json({ error: 'Only the on-chain seller may link an asset' }, { status: 403 });
    }

    const metadata = await loadAuctionMetadata(String(raw[4]));
    const asset = metadata.asset as Record<string, unknown> | undefined;
    if (!asset || asset.datasetId !== datasetId || asset.fileHashHex !== record.fileHashHex || asset.assetType !== (record.assetType || 'dataset')) {
      auditAssetEvent({ action: 'link', result: 'denied', assetType: record.assetType, sizeBytes: record.size, auctionId: id, walletAddress: String(address), reasonCode: 'metadata_mismatch' });
      return NextResponse.json({ error: 'On-chain auction metadata does not match the uploaded asset ID, hash, and type.' }, { status: 409 });
    }

    linkAuctionToDataset(datasetId, auctionId);
    auditAssetEvent({ action: 'link', result: 'success', assetType: record.assetType || 'dataset', sizeBytes: record.size, auctionId: id, walletAddress: String(address) });
    
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    auditAssetEvent({ action: 'link', result: 'error', reasonCode: 'unexpected_error' });
    return NextResponse.json({ error: 'Could not verify or link the uploaded asset to this auction.' }, { status: 500 });
  }
}
