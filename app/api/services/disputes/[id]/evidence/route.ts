import { NextRequest, NextResponse } from 'next/server';
import { addDisputeEvidence, getDisputeById } from '@/lib/server/servicesDb';

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

    const body = await req.json();
    const { submittedBy, evidenceType, title, description, references } = body;

    if (!submittedBy || !title || !description) {
      return NextResponse.json(
        { error: 'Missing required fields: submittedBy, title, and description are required' },
        { status: 400 }
      );
    }

    const validTypes = ['claim', 'file_url', 'milestone_proof', 'contract_log', 'chat_excerpt'];
    const resolvedType = validTypes.includes(evidenceType) ? evidenceType : 'claim';

    const evidence = addDisputeEvidence({
      disputeId,
      submittedBy,
      evidenceType: resolvedType as any,
      title: String(title).slice(0, 200),
      description: String(description).slice(0, 4000),
      references: Array.isArray(references) ? references.map((r: any) => String(r).slice(0, 500)) : [],
    });

    const updatedDispute = getDisputeById(disputeId);

    return NextResponse.json({
      success: true,
      evidence,
      dispute: updatedDispute,
      message: 'Evidence submitted successfully.',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
