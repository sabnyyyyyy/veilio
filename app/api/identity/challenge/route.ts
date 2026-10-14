import { NextRequest, NextResponse } from 'next/server';
import { createWalletLinkChallenge } from '@/lib/server/identityDb';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const { identityId, chainFamily, networkId, walletAddress } = body;

    if (!identityId || typeof identityId !== 'string') {
      return NextResponse.json({ error: 'identityId is required' }, { status: 400 });
    }
    if (chainFamily !== 'evm' && chainFamily !== 'solana') {
      return NextResponse.json(
        { error: "chainFamily must be either 'evm' or 'solana'" },
        { status: 400 }
      );
    }
    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 });
    }

    const host = req.headers.get('host') || 'veilio.network';
    const origin = req.headers.get('origin') || `https://${host}`;

    const challenge = await createWalletLinkChallenge({
      identityId,
      chainFamily,
      networkId,
      walletAddress,
      domain: host,
      uri: origin,
    });

    return NextResponse.json({
      challengeId: challenge.challengeId,
      message: challenge.message,
      expiresAt: challenge.expiresAt,
      nonce: challenge.nonce,
    });
  } catch (err: any) {
    const message = err?.message || 'Failed to generate challenge';
    const isNotFound = message.includes('not found');
    return NextResponse.json(
      { error: message },
      { status: isNotFound ? 404 : 400 }
    );
  }
}

export const POST = withJsonStores(handlePOST);
