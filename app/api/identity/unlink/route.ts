import { NextRequest, NextResponse } from 'next/server';
import { unlinkWalletFromIdentity, verifyUnlinkAuth } from '@/lib/server/identityDb';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json();
    const { identityId, walletAddress, chainFamily, auth } = body;

    if (!identityId || typeof identityId !== 'string') {
      return NextResponse.json({ error: 'identityId is required' }, { status: 400 });
    }
    if (!walletAddress || typeof walletAddress !== 'string') {
      return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 });
    }
    if (chainFamily !== 'evm' && chainFamily !== 'solana') {
      return NextResponse.json(
        { error: "chainFamily must be 'evm' or 'solana'" },
        { status: 400 }
      );
    }

    const authCheck = await verifyUnlinkAuth({
      identityId,
      walletAddress,
      chainFamily,
      auth,
    });
    if (!authCheck.valid) {
      return NextResponse.json(
        { error: authCheck.error || 'Unauthorized unlinking request' },
        { status: authCheck.status || 401 }
      );
    }

    const updatedProfile = await unlinkWalletFromIdentity(identityId, walletAddress, chainFamily);

    return NextResponse.json({
      success: true,
      profile: updatedProfile,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to unlink wallet' },
      { status: 400 }
    );
  }
}

export const POST = withJsonStores(handlePOST);
