import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, isAddress, verifyMessage } from 'viem';
import { bnbChain } from '@/lib/chain';
import { VEIL_V3_ABI, VEIL_V3_CONTRACT_ADDRESS } from '@/lib/contract';
import { datasetPreviewMessage } from '@/lib/assetAuth';
import { getDatasetRecordByAuctionId, updateDatasetRecord } from '@/lib/server/datasetDb';

export const runtime = 'nodejs';

function publicSample(record: Awaited<ReturnType<typeof getDatasetRecordByAuctionId>>) {
  if (!record || record.assetType !== 'dataset' || !record.publicPreviewEnabled || !record.manifest) return null;
  const columns = record.manifest.columns.filter((column): column is string => typeof column === 'string' && column.length > 0).slice(0, 50);
  if (!columns.length || new Set(columns).size !== columns.length || !Array.isArray(record.manifest.sample)) return null;
  const rows = record.manifest.sample.slice(0, 10).filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row)).map((row) =>
    Object.fromEntries(columns.map((column) => {
      const value = (row as Record<string, unknown>)[column];
      return [column, typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).slice(0, 200) : ''];
    })),
  );
  return rows.length ? { columns, rows } : null;
}

export async function GET(request: NextRequest) {
  const auctionId = request.nextUrl.searchParams.get('auctionId') || '';
  if (!/^[1-9]\d{0,77}$/.test(auctionId)) return NextResponse.json({ error: 'Invalid auction ID.' }, { status: 400 });
  try {
    const client = createPublicClient({ chain: bnbChain, transport: http(process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || undefined) });
    const raw = await client.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'auctions', args: [BigInt(auctionId)] }) as readonly unknown[];
    if (String(raw[0]) === '0' || Number(raw[6]) * 1000 <= Date.now()) return NextResponse.json({ preview: null });
    const preview = publicSample(await getDatasetRecordByAuctionId(auctionId));
    return NextResponse.json({ preview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not load the public dataset preview.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { auctionId: suppliedAuctionId, address, signature, timestamp } = await request.json();
    const auctionId = String(suppliedAuctionId || '');
    const time = Number(timestamp);
    if (!/^[1-9]\d{0,77}$/.test(auctionId) || !isAddress(String(address)) || typeof signature !== 'string' || !Number.isSafeInteger(time)) {
      return NextResponse.json({ error: 'Invalid seller authorization.' }, { status: 400 });
    }
    if (Math.abs(Date.now() - time) > 5 * 60 * 1000) return NextResponse.json({ error: 'Authorization expired. Please retry.' }, { status: 401 });
    const message = datasetPreviewMessage({ auctionId, address: String(address), timestamp: time });
    if (!await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` })) {
      return NextResponse.json({ error: 'Invalid seller signature.' }, { status: 401 });
    }
    const client = createPublicClient({ chain: bnbChain, transport: http(process.env.NEXT_PUBLIC_BNB_CHAIN_RPC || undefined) });
    const raw = await client.readContract({ address: VEIL_V3_CONTRACT_ADDRESS, abi: VEIL_V3_ABI, functionName: 'auctions', args: [BigInt(auctionId)] }) as readonly unknown[];
    if (String(raw[0]) === '0') return NextResponse.json({ error: 'Auction not found.' }, { status: 404 });
    if (String(raw[1]).toLowerCase() !== String(address).toLowerCase()) return NextResponse.json({ error: 'Only this auction’s seller can publish its preview.' }, { status: 403 });
    if (Number(raw[6]) * 1000 <= Date.now()) return NextResponse.json({ error: 'Preview can only be published before bidding ends.' }, { status: 409 });
    const record = await getDatasetRecordByAuctionId(auctionId);
    if (!record || record.assetType !== 'dataset' || !record.manifest?.sample?.length || !record.manifest.columns?.length) {
      return NextResponse.json({ error: 'No stored dataset sample is available for this auction.' }, { status: 404 });
    }
    record.publicPreviewEnabled = true;
    await updateDatasetRecord(record);
    const preview = publicSample(record);
    if (!preview) return NextResponse.json({ error: 'Stored dataset sample is invalid.' }, { status: 409 });
    return NextResponse.json({ success: true, preview }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not publish the dataset preview.' }, { status: 500 });
  }
}
