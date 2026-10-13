import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedServicesForIdentity } from '@/lib/server/identityDb';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const identityId = searchParams.get('identityId');

    if (!identityId) {
      return NextResponse.json({ error: 'identityId is required' }, { status: 400 });
    }

    const services = await getUnifiedServicesForIdentity(identityId);
    return NextResponse.json({ services, count: services.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to retrieve unified services' },
      { status: 500 }
    );
  }
}
