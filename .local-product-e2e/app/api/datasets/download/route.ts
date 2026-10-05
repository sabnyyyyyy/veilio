import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { verifyMessage, createPublicClient, http, isAddress } from 'viem';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_CONTRACT_ADDRESS, VEIL_V3_ABI } from '@/lib/contract';
import { getDatasetRecordByAuctionId, getEncryptedFilePath } from '@/lib/server/datasetDb';
import { datasetDownloadMessage } from '@/lib/assetAuth';
import { auditAssetEvent } from '@/lib/server/assetAudit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { auctionId, address, signature, timestamp } = body;

    if (!auctionId || !address || !signature || !timestamp) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const id = String(auctionId);
    const time = Number(timestamp);
    if (!/^[1-9]\d{0,77}$/.test(id) || !isAddress(String(address)) || !Number.isSafeInteger(time)) {
      return NextResponse.json({ error: 'Invalid auction ID, wallet address, or timestamp.' }, { status: 400 });
    }

    const now = Date.now();
    if (Math.abs(now - time) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired or invalid timestamp' }, { status: 401 });
    }

    const message = datasetDownloadMessage({ auctionId: id, address: String(address), timestamp: time });
    const isValidSignature = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValidSignature) {
      auditAssetEvent({ action: 'download', result: 'denied', auctionId: id, walletAddress: String(address), reasonCode: 'invalid_signature' });
      return NextResponse.json({ error: 'Invalid wallet signature' }, { status: 401 });
    }

    // 3. Verify On-Chain State
    const publicClient = createPublicClient({ chain: bnbChain, transport: http(process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || undefined) });

    const auctionRaw = await publicClient.readContract({
      address: VEIL_V3_CONTRACT_ADDRESS,
      abi: VEIL_V3_ABI,
      functionName: 'auctions',
      args: [BigInt(id)],
    });

    const values = auctionRaw as readonly [
      bigint, string, string, string, string,
      bigint, bigint, bigint, bigint, bigint, number, string,
      bigint, bigint, bigint, string, string, string
    ];

    const state = values[10]; // VeilV2 AuctionState
    const highestBidder = values[11];

    // Allowed states for winner to download full dataset: Completed(6) ONLY.
    // If Inspection(3), RefundRequested(4), UnderReview(5), Refunded(7) or Cancelled(8), access is blocked.
    if (state !== 6) {
      auditAssetEvent({ action: 'download', result: 'denied', auctionId: id, walletAddress: String(address), reasonCode: 'auction_state' });
      return NextResponse.json({ error: 'Data access is only allowed for the winner after successful completion.' }, { status: 403 });
    }

    if (highestBidder.toLowerCase() !== address.toLowerCase()) {
      auditAssetEvent({ action: 'download', result: 'denied', auctionId: id, walletAddress: String(address), reasonCode: 'not_winner' });
      return NextResponse.json({ error: 'Wallet is not the winning bidder' }, { status: 403 });
    }

    // 4. Retrieve Dataset Record & Key
    const record = getDatasetRecordByAuctionId(id);
    if (!record) {
      return NextResponse.json({ error: 'Dataset record not found for this auction' }, { status: 404 });
    }

    // 5. Read Encrypted File Buffer
    const encryptedFilePath = getEncryptedFilePath(record.encryptedFilePath);
    if (!encryptedFilePath) {
      return NextResponse.json({ error: 'Encrypted file missing from storage' }, { status: 500 });
    }
    const stat = await fs.stat(encryptedFilePath).catch(() => null);
    if (!stat?.isFile()) return NextResponse.json({ error: 'Encrypted file missing from storage' }, { status: 500 });

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
    const fileStream = createReadStream(encryptedFilePath);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(new Uint8Array(prefix));
        try {
          for await (const chunk of fileStream) controller.enqueue(new Uint8Array(chunk as Buffer));
          controller.close();
        } catch (error) { controller.error(error); }
      },
      cancel() { fileStream.destroy(); },
    });
    auditAssetEvent({ action: 'download', result: 'success', assetType: record.assetType || 'dataset', sizeBytes: record.size, auctionId: id, walletAddress: String(address) });
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.veilio.encrypted-asset',
        'Content-Length': String(prefix.length + stat.size),
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
