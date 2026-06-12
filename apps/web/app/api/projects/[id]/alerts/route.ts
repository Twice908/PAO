import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pulse/db'
import { requireProjectOwnership } from '@/lib/guards/project-ownership'

// PAO is agent-only — alerts are restricted to the three agent alert types.
const ALERT_TYPES = ['agent_error_rate', 'agent_token_threshold', 'agent_execution_time'] as const
const ALERT_CHANNELS = ['email', 'slack'] as const

const agentMetricsSchema = z
  .object({ timeWindowMinutes: z.number().int().min(1).max(1440).optional() })
  .optional()

const createAlertSchema = z
  .object({
    type: z.enum(ALERT_TYPES),
    channel: z.enum(ALERT_CHANNELS),
    destination: z.string().min(1),
    threshold: z.number().min(0),
    active: z.boolean().default(true),
    agentMetrics: agentMetricsSchema,
  })
  .superRefine((val, ctx) => {
    if (val.channel === 'email' && !z.string().email().safeParse(val.destination).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'destination must be a valid email address', path: ['destination'] })
    }
    if (val.channel === 'slack' && !val.destination.startsWith('https://hooks.slack.com/')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'destination must be a Slack webhook URL (https://hooks.slack.com/...)', path: ['destination'] })
    }
    if (val.type === 'agent_error_rate' && (val.threshold < 0 || val.threshold > 100)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'threshold must be between 0 and 100 for agent error rate alerts', path: ['threshold'] })
    }
    if ((val.type === 'agent_token_threshold' || val.type === 'agent_execution_time') && val.threshold <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'threshold must be greater than 0', path: ['threshold'] })
    }
  })

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  const alerts = await prisma.alert.findMany({
    where: { projectId: params.id },
    include: { events: { orderBy: { sentAt: 'desc' }, take: 1 } },
    orderBy: { id: 'desc' },
  })

  return NextResponse.json({
    success: true,
    data: alerts.map((a) => ({
      id: a.id,
      type: a.type,
      channel: a.channel,
      destination: a.destination,
      threshold: a.threshold,
      url: a.url ?? undefined,
      route: a.route ?? undefined,
      active: a.active,
      lastFired: a.events[0]?.sentAt.toISOString() ?? undefined,
      agentMetrics: a.agentMetrics ?? undefined,
    })),
  })
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const denied = await requireProjectOwnership(userId, params.id)
  if (denied) return denied

  const parsed = createAlertSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } },
      { status: 400 },
    )
  }

  const alert = await prisma.alert.create({
    data: {
      projectId: params.id,
      type: parsed.data.type,
      channel: parsed.data.channel,
      destination: parsed.data.destination,
      threshold: parsed.data.threshold,
      active: parsed.data.active,
      agentMetrics: parsed.data.agentMetrics ?? undefined,
    },
  })

  return NextResponse.json(
    {
      success: true,
      data: {
        id: alert.id,
        type: alert.type,
        channel: alert.channel,
        destination: alert.destination,
        threshold: alert.threshold,
        active: alert.active,
        agentMetrics: alert.agentMetrics ?? undefined,
      },
    },
    { status: 201 },
  )
}
