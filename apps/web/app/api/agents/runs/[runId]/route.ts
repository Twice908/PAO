import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

export async function GET(
  _request: Request,
  { params }: { params: { runId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const run = await prisma.agentRun.findUnique({ where: { id: params.runId } })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const denied = await requireProjectOwnership(userId, run.projectId)
  if (denied) return denied

  const spans = await prisma.agentSpan.findMany({
    where: { runId: params.runId },
    orderBy: { startedAt: 'asc' },
  })

  return NextResponse.json({
    run: {
      id: run.id,
      projectId: run.projectId,
      task: run.task,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt?.toISOString() ?? null,
      totalTokens: run.totalTokens,
      totalCostUsd: run.totalCostUsd?.toNumber() ?? null,
      metadata: run.metadata,
    },
    spans: spans.map((s) => ({
      id: s.id,
      runId: s.runId,
      projectId: s.projectId,
      agentDefinitionId: s.agentDefinitionId,
      parentSpanId: s.parentSpanId,
      spanType: s.spanType,
      name: s.name,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
      durationMs: s.durationMs,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      totalTokens: s.totalTokens,
      costUsd: s.costUsd?.toNumber() ?? null,
      model: s.model,
      inputPreview: s.inputPreview,
      outputPreview: s.outputPreview,
      statusCode: s.statusCode,
      errorMessage: s.errorMessage,
      metadata: s.metadata,
    })),
  })
}
