import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { get as getBlob } from '@vercel/blob';
import { getDatasetRecordByAuctionId, getEncryptedFilePath } from '@/lib/server/datasetDb';
import { datasetDownloadMessageFor, isValidAuctionIdForNetwork, parseAuctionNetwork, sameWallet } from '@/lib/auctionNetwork';
import { isWalletAddressForNetwork, readOnchainAuction } from '@/lib/server/auctionChainState';
import { verifyWalletSignature } from '@/lib/server/walletSignature';
import { auditAssetEvent } from '@/lib/server/assetAudit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { auctionId, address, signature, timestamp, network } = body;

    if (!auctionId || !address || !signature || !timestamp) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const networkId = parseAuctionNetwork(network);
    if (!networkId) return NextResponse.json({ error: 'Unsupported auction network.' }, { status: 400 });
    const id = String(auctionId);
    const time = Number(timestamp);
    if (!isValidAuctionIdForNetwork(id, networkId) || !isWalletAddressForNetwork(address, networkId) || !Number.isSafeInteger(time)) {
      return NextResponse.json({ error: 'Invalid auction ID, wallet address, or timestamp.' }, { status: 400 });
    }

    const now = Date.now();
    if (Math.abs(now - time) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired or invalid timestamp' }, { status: 401 });
    }

    const message = datasetDownloadMessageFor(networkId, { auctionId: id, address, timestamp: time });
    const isValidSignature = await verifyWalletSignature({ address, message, signature });

    if (!isValidSignature) {
      auditAssetEvent({ action: 'download', result: 'denied', auctionId: id, walletAddress: address, reasonCode: 'invalid_signature' });
      return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });
    }

    // 3. Verify on-chain state on the auction's own network
    const auction = await readOnchainAuction(networkId, id);
    if (!auction) return NextResponse.json({ error: 'Auction not found' }, { status: 404 });

    // Allowed states for winner to download full dataset: Completed(6) ONLY.
    // If Inspection(3), RefundRequested(4), UnderReview(5), Refunded(7) or Cancelled(8), access is blocked.
    if (auction.state !== 6) {
      auditAssetEvent({ action: 'download', result: 'denied', auctionId: id, walletAddress: address, reasonCode: 'auction_state' });
      return NextResponse.json({ error: 'Data access is only allowed for the winner after successful completion.' }, { status: 403 });
    }

    if (!sameWallet(auction.highestBidder, address, networkId)) {
      auditAssetEvent({ action: 'download', result: 'denied', auctionId: id, walletAddress: address, reasonCode: 'not_winner' });
      return NextResponse.json({ error: 'Wallet is not the winning bidder' }, { status: 403 });
    }

    // 4. Retrieve Dataset Record & Key
    const record = await getDatasetRecordByAuctionId(id, networkId);
    if (!record) {
      return NextResponse.json({ error: 'Dataset record not found for this auction' }, { status: 404 });
    }

    const metadata = Buffer.from(JSON.stringify({
      fileName: record.fileName,
      mimeType: record.mimeType,
      encryptionVersion: record.encryptionVersion,
      fileHashHex: record.fileHashHex,
      keyBase64: record.keyBase64,
      ivBase64: record.ivBase64,
      authTagBase64: record.authTagBase64,
    }), 'utf8');
    const prefix = Buffer.allocUnsafe(4 + metadata.length);
    prefix.writeUInt32BE(metadata.length, 0);
    metadata.copy(prefix, 4);

    // 5. Read Encrypted File Buffer
    let encryptedSize: number;
    let stream: ReadableStream<Uint8Array>;
    if (process.env.NODE_ENV === 'production') {
      const storedBlob = await getBlob(record.encryptedFilePath, { access: 'private' });
      if (!storedBlob || storedBlob.statusCode !== 200) return NextResponse.json({ error: 'Encrypted file missing from storage' }, { status: 500 });
      encryptedSize = storedBlob.blob.size;
      const reader = storedBlob.stream.getReader();
      stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new Uint8Array(prefix));
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          } catch (error) { controller.error(error); }
          finally { reader.releaseLock(); }
        },
        cancel() { void reader.cancel(); },
      });
    } else {
      const encryptedFilePath = getEncryptedFilePath(record.encryptedFilePath);
      if (!encryptedFilePath) return NextResponse.json({ error: 'Encrypted file missing from storage' }, { status: 500 });
      const stat = await fs.stat(encryptedFilePath).catch(() => null);
      if (!stat?.isFile()) return NextResponse.json({ error: 'Encrypted file missing from storage' }, { status: 500 });
      encryptedSize = stat.size;
      const fileStream = createReadStream(encryptedFilePath);
      stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new Uint8Array(prefix));
          try {
            for await (const chunk of fileStream) controller.enqueue(new Uint8Array(chunk as Buffer));
            controller.close();
          } catch (error) { controller.error(error); }
        },
        cancel() { fileStream.destroy(); },
      });
    }

    auditAssetEvent({ action: 'download', result: 'success', assetType: record.assetType || 'dataset', sizeBytes: record.size, auctionId: id, walletAddress: address });
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.veilio.encrypted-asset',
        'Content-Length': String(prefix.length + encryptedSize),
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });

  } catch (err: unknown) {
    auditAssetEvent({ action: 'download', result: 'error', reasonCode: 'unexpected_error' });
    console.error('[Dataset Download] Unexpected failure:', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ error: 'Could not complete the asset download request.' }, { status: 500 });
  }
}
