import { NextRequest, NextResponse } from 'next/server';
import { getDatasetRecord, isDatasetLinkedTo, linkAuctionToDataset } from '@/lib/server/datasetDb';
import { datasetLinkMessageFor, isValidAuctionIdForNetwork, parseAuctionNetwork, sameWallet } from '@/lib/auctionNetwork';
import { isWalletAddressForNetwork, readOnchainAuction } from '@/lib/server/auctionChainState';
import { verifyWalletSignature } from '@/lib/server/walletSignature';
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
    const { datasetId, auctionId, address, signature, timestamp, network } = await req.json();

    if (!datasetId || !auctionId || !address || !signature || !timestamp) {
      return NextResponse.json({ error: 'Missing signed seller authorization' }, { status: 400 });
    }
    const networkId = parseAuctionNetwork(network);
    if (!networkId) return NextResponse.json({ error: 'Unsupported auction network.' }, { status: 400 });
    const id = String(auctionId);
    const time = Number(timestamp);
    if (!isValidAuctionIdForNetwork(id, networkId) || !isWalletAddressForNetwork(address, networkId) || !Number.isSafeInteger(time)) {
      return NextResponse.json({ error: 'Invalid auction ID, wallet address, or timestamp.' }, { status: 400 });
    }
    if (Math.abs(Date.now() - time) > 5 * 60 * 1000) return NextResponse.json({ error: 'Authorization expired' }, { status: 401 });
    const message = datasetLinkMessageFor(networkId, { datasetId: String(datasetId), auctionId: id, address, timestamp: time });
    const valid = await verifyWalletSignature({ address, message, signature });
    if (!valid) {
      auditAssetEvent({ action: 'link', result: 'denied', auctionId: id, walletAddress: address, reasonCode: 'invalid_signature' });
      return NextResponse.json({ error: 'Invalid seller signature' }, { status: 401 });
    }

    const record = await getDatasetRecord(datasetId);
    if (!record) return NextResponse.json({ error: 'Dataset record not found' }, { status: 404 });
    if (record.uploader && !sameWallet(record.uploader, address, networkId)) {
      auditAssetEvent({ action: 'link', result: 'denied', assetType: record.assetType, auctionId: id, walletAddress: address, reasonCode: 'uploader_mismatch' });
      return NextResponse.json({ error: 'Only the wallet that uploaded this asset may link it.' }, { status: 403 });
    }
    if (record.auctionId && !isDatasetLinkedTo(record, id, networkId)) return NextResponse.json({ error: 'Asset is already linked to another auction' }, { status: 409 });
    const auction = await readOnchainAuction(networkId, id);
    if (!auction) return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    if (!sameWallet(auction.seller, address, networkId)) {
      auditAssetEvent({ action: 'link', result: 'denied', assetType: record.assetType, auctionId: id, walletAddress: address, reasonCode: 'onchain_seller_mismatch' });
      return NextResponse.json({ error: 'Only the on-chain seller may link an asset' }, { status: 403 });
    }

    const metadata = await loadAuctionMetadata(auction.imageURI);
    const asset = metadata.asset as Record<string, unknown> | undefined;
    if (!asset || asset.assetType !== (record.assetType || 'dataset')) {
      auditAssetEvent({ action: 'link', result: 'denied', assetType: record.assetType, sizeBytes: record.size, auctionId: id, walletAddress: address, reasonCode: 'metadata_mismatch' });
      return NextResponse.json({ error: 'Public auction metadata does not match the uploaded asset type.' }, { status: 409 });
    }

    await linkAuctionToDataset(datasetId, id, networkId);
    auditAssetEvent({ action: 'link', result: 'success', assetType: record.assetType || 'dataset', sizeBytes: record.size, auctionId: id, walletAddress: address });
    
    return NextResponse.json({ success: true, networkId });
  } catch (err: unknown) {
    auditAssetEvent({ action: 'link', result: 'error', reasonCode: 'unexpected_error' });
    return NextResponse.json({ error: 'Could not verify or link the uploaded asset to this auction.' }, { status: 500 });
  }
}
