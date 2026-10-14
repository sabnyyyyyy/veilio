import { NextRequest, NextResponse } from 'next/server';
import {
  getIdentityProfile,
  getIdentityByWallet,
  getOrCreateIdentityForWallet,
  verifyProfileInitAuth,
  type ProfileInitAuthPayload,
} from '@/lib/server/identityDb';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handleGET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const wallet = searchParams.get('wallet');
    const chain = searchParams.get('chain') as 'evm' | 'solana' | null;

    if (id) {
      const profile = await getIdentityProfile(id);
      if (!profile) {
        return NextResponse.json({ error: `Veilio identity ${id} not found` }, { status: 404 });
      }
      return NextResponse.json({ profile });
    }

    if (wallet && chain) {
      const profile = await getIdentityByWallet(wallet, chain);
      if (!profile) {
        return NextResponse.json({ error: `Identity not found for wallet ${wallet}` }, { status: 404 });
      }
      return NextResponse.json({ profile });
    }

    return NextResponse.json(
      { error: 'Provide either id or (wallet and chain) parameter' },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to retrieve profile' },
      { status: 500 }
    );
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet, chain, networkId, auth } = body;

    if (!wallet || typeof wallet !== 'string') {
      return NextResponse.json({ error: 'wallet is required' }, { status: 400 });
    }
    if (chain !== 'evm' && chain !== 'solana') {
      return NextResponse.json(
        { error: "chain must be 'evm' or 'solana'" },
        { status: 400 }
      );
    }

    // 1. Idempotent check: if profile already exists for this wallet, return it safely without requiring re-auth
    const existing = await getIdentityByWallet(wallet, chain);
    if (existing) {
      return NextResponse.json({ profile: existing });
    }

    // 2. Fresh initialization requires cryptographic proof-of-control
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication signature required to initialize new identity profile' },
        { status: 401 }
      );
    }

    const authCheck = await verifyProfileInitAuth({
      walletAddress: wallet,
      chainFamily: chain,
      auth,
    });

    if (!authCheck.valid) {
      return NextResponse.json(
        { error: authCheck.error || 'Unauthorized profile initialization request' },
        { status: authCheck.status || 403 }
      );
    }

    const profile = await getOrCreateIdentityForWallet(wallet, chain, networkId);
    return NextResponse.json({ profile });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to initialize profile' },
      { status: 500 }
    );
  }
}

export const GET = withJsonStores(handleGET);
export const POST = withJsonStores(handlePOST);
