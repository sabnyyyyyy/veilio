import { NextRequest } from 'next/server';
import { POST as postHandler } from '@/app/api/services/orders/[id]/disputes/route';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return postHandler(req, context);
}
