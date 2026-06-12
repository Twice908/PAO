import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@pulse/db'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

const PAGE_SIZE = 20

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? String(PAGE_SIZE), 10))

  const [events, total] = await Promise.all([
    prisma.alertEvent.findMany({
      where: { projectId: params.id },
      include: { alert: { select: { active: true } } },
      orderBy: { sentAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.alertEvent.count({ where: { projectId: params.id } }),
  ])

  return NextResponse.json({
    success: true,
    data: events.map((e) => ({
      id: e.id,
      alertId: e.alertId,
      alertStatus: e.alertId === null ? 'deleted' : e.alert?.active ? 'active' : 'disabled',
      type: e.type,
      triggeredValue: e.triggeredValue,
      threshold: e.threshold,
      message: e.message,
      channel: e.channel,
      sentAt: e.sentAt.toISOString(),
      agentRunId: e.agentRunId ?? null,
    })),
    total,
    page,
    hasMore: page * limit < total,
  })
}
