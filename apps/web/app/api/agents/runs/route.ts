import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export async function GET(request: Request): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const projectId = url.searchParams.get('project')
  if (!projectId) return NextResponse.json({ error: 'Missing project' }, { status: 400 })

  const denied = await requireProjectOwnership(userId, projectId)
  if (denied) return denied

  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(MAX_LIMIT, parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT)))
  const statusFilter = url.searchParams.get('status')

  const where: Record<string, unknown> = { projectId }
  if (statusFilter) where['status'] = statusFilter

  const [runs, total] = await Promise.all([
    prisma.agentRun.findMany({
      where,
      include: { _count: { select: { spans: true } } },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.agentRun.count({ where }),
  ])

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      task: r.task,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
      totalTokens: r.totalTokens,
      totalCostUsd: r.totalCostUsd?.toNumber() ?? null,
      metadata: r.metadata,
      spanCount: r._count.spans,
    })),
    total,
    page,
    hasMore: runs.length === limit,
  })
}
