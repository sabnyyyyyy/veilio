import { NextRequest, NextResponse } from 'next/server';
import {
  getDisputeById,
  getOrderById,
  getOrderSubmissions,
  getOrderRevisions,
  getConversationMessages,
  saveDisputeRecommendation,
} from '@/lib/server/servicesDb';
import { evaluateDisputeWithAi } from '@/lib/server/disputeAiEvaluator';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: disputeId } = await params;
    const dispute = getDisputeById(disputeId);
    if (!dispute) {
      return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
    }

    const order = getOrderById(dispute.orderId);
    if (!order) {
      return NextResponse.json({ error: 'Associated order not found' }, { status: 404 });
    }

    const submissions = getOrderSubmissions(order.id);
    const revisions = getOrderRevisions(order.id);
    const messages = getConversationMessages(order.conversationId);

    // Run AI Evaluation
    const recommendation = await evaluateDisputeWithAi({
      dispute,
      order,
      submissions,
      revisions,
      messages,
    });

    // Persist recommendation in DB
    const updatedDispute = saveDisputeRecommendation(disputeId, recommendation);

    return NextResponse.json({
      success: true,
      recommendation,
      dispute: updatedDispute,
      message: 'AI dispute evaluation completed successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
