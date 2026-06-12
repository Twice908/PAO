import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pulse/db'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

const agentMetricsSchema = z
  .object({ timeWindowMinutes: z.number().int().min(1).max(1440).optional() })
  .optional()

const patchAlertSchema = z.object({
  active: z.boolean().optional(),
  threshold: z.number().min(0).optional(),
  destination: z.string().min(1).optional(),
  agentMetrics: agentMetricsSchema,
})

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; alertId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  const parsed = patchAlertSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } },
      { status: 400 },
    )
  }

  const existing = await prisma.alert.findFirst({ where: { id: params.alertId, projectId: params.id } })
  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } },
      { status: 404 },
    )
  }

  const updated = await prisma.alert.update({ where: { id: params.alertId }, data: parsed.data })

  return NextResponse.json({
    success: true,
    data: {
      id: updated.id,
      type: updated.type,
      channel: updated.channel,
      destination: updated.destination,
      threshold: updated.threshold,
      active: updated.active,
      agentMetrics: updated.agentMetrics ?? undefined,
    },
  })
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; alertId: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  const existing = await prisma.alert.findFirst({ where: { id: params.alertId, projectId: params.id } })
  if (!existing) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } },
      { status: 404 },
    )
  }

  await prisma.alert.delete({ where: { id: params.alertId } })

  return NextResponse.json({ success: true })
}
