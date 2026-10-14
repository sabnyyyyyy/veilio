import { NextRequest } from 'next/server';
import { POST as postHandler } from '@/app/api/services/orders/[id]/disputes/route';

import { withJsonStores } from '@/lib/server/jsonStore';
async function handlePOST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return postHandler(req, context);
}

export const POST = withJsonStores(handlePOST);
