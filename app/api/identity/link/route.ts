import { NextRequest, NextResponse } from 'next/server';
import {
  consumeWalletLinkChallenge,
  linkWalletToIdentity,
  getIdentityProfile,
} from '@/lib/server/identityDb';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const { challengeId, walletAddress, signature } = body;

    if (!challengeId || typeof challengeId !== 'string') {
      return NextResponse.json({ error: 'challengeId is required' }, { status: 400 });
    }
    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 });
    }
    if (!signature || typeof signature !== 'string') {
      return NextResponse.json({ error: 'signature is required' }, { status: 400 });
    }

    // 1. Atomically consume and verify challenge
    const result = await consumeWalletLinkChallenge(challengeId, walletAddress, signature);
    if (!result.valid || !result.identityId || !result.challenge) {
      return NextResponse.json(
        { error: result.error || 'Challenge validation failed' },
        { status: 401 }
      );
    }

    // 2. Link verified wallet to identity
    const updatedProfile = await linkWalletToIdentity(result.identityId, {
      address: result.challenge.walletAddress,
      chainFamily: result.challenge.chainFamily,
      networkId: result.challenge.networkId,
      proofType: result.challenge.chainFamily === 'evm' ? 'eip191' : 'ed25519',
    });

    return NextResponse.json({
      success: true,
      profile: updatedProfile,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to link wallet' },
      { status: 400 }
    );
  }
}

export const POST = withJsonStores(handlePOST);
