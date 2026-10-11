import { NextRequest } from 'next/server';
import { GET as getHandler, POST as postHandler } from '@/app/api/services/orders/[id]/disputes/route';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return getHandler(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return postHandler(req, context);
}
