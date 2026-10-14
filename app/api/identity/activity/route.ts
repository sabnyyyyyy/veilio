import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedActivityHistory } from '@/lib/server/identityDb';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const identityId = searchParams.get('identityId');

    if (!identityId) {
      return NextResponse.json({ error: 'identityId is required' }, { status: 400 });
    }

    const chainFamily = searchParams.get('chainFamily') as 'evm' | 'solana' | undefined;
    const networkId = searchParams.get('networkId') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined;

    const result = await getUnifiedActivityHistory(identityId, {
      chainFamily: chainFamily || undefined,
      networkId,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to retrieve activity history' },
      { status: 500 }
    );
  }
}

async function handlePOST() {
  return NextResponse.json(
    { error: 'Activity ingestion is restricted to trusted chain indexers.' },
    { status: 403 }
  );
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
