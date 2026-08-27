import { Worker } from 'bullmq'
import type { ConnectionOptions, Job } from 'bullmq'
import pino from 'pino'
import { prisma, Prisma } from '@pulse/db'
import { redis } from '../lib/redis'
import { evaluateAgentRunAlerts } from '../lib/alert-evaluator'
import { deriveCostUsd } from '../lib/pricing'

const logger = pino({ name: 'agent-span-processor' })

export type SpanType = 'llm_call' | 'tool_call' | 'memory_read' | 'agent_message' | 'error'

export interface AgentSpanJobData {
  type: 'span' | 'run_start' | 'run_end'
  projectId: string
  runId: string
  spanId?: string
  parentSpanId?: string
  task?: string
  agentName?: string
  spanType?: SpanType
  name?: string
  model?: string
  startedAt: string
  endedAt?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  inputPreview?: string
  outputPreview?: string
  status?: 'success' | 'error' | 'timeout' | 'completed' | 'failed' | 'interrupted'
  errorMessage?: string
  metadata?: Record<string, unknown>
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleRunStart(data: AgentSpanJobData): Promise<void> {
  const { runId, projectId, task, startedAt } = data

  // Spans can outrun their run_start (OTLP exports each span in its own
  // request, and PAO's own guard creates a placeholder run with an empty
  // task). Fill in the real task when we finally learn it, but never clear an
  // existing one with a blank.
  await prisma.agentRun.upsert({
    where: { id: runId },
    update: task ? { task } : {},
    create: {
      id: runId,
      projectId,
      task: task ?? '',
      status: 'running',
      startedAt: new Date(startedAt),
      totalTokens: 0,
      totalCostUsd: 0,
    },
  })

  await redis.publish(
    `agent-runs:${projectId}`,
    JSON.stringify({
      id: runId,
      projectId,
      task: task ?? '',
      status: 'running',
      startedAt,
      endedAt: null,
      totalTokens: 0,
      totalCostUsd: null,
      spanCount: 0,
    }),
  )
}

async function handleSpan(data: AgentSpanJobData): Promise<void> {
  const {
    runId,
    projectId,
    spanId,
    agentName,
    spanType,
    name,
    startedAt,
    endedAt,
    inputTokens,
    outputTokens,
    costUsd,
  } = data

  if (!runId) {
    logger.warn({ data }, 'Agent-span job missing runId — skipping span handler')
    return
  }

  let agentDefinitionId: string | undefined

  if (agentName) {
    const agentDef = await prisma.agentDefinition.upsert({
      where: { projectId_name: { projectId, name: agentName } },
      update: {},
      create: { projectId, name: agentName },
    })
    agentDefinitionId = agentDef.id
  }

  // Derive cost when the caller did not supply one. Non-SDK sources (n8n,
  // Make, Zapier, OTLP exporters) report tokens but never costUsd; without
  // this they would roll up as $0. An explicit costUsd always wins.
  const effectiveCostUsd = costUsd ?? deriveCostUsd(data.model, inputTokens, outputTokens)

  const startMs = new Date(startedAt).getTime()
  const endMs = endedAt ? new Date(endedAt).getTime() : undefined
  const durationMs = endMs !== undefined ? endMs - startMs : undefined
  const spanTotalTokens = (inputTokens ?? 0) + (outputTokens ?? 0)
  const hasTokens = inputTokens != null || outputTokens != null

  // Guard: ensure the parent AgentRun exists before writing the span so FK
  // constraints never fire if run_start somehow hasn't landed yet.
  await prisma.agentRun.upsert({
    where: { id: runId },
    update: {},
    create: {
      id: runId,
      projectId,
      task: '',
      status: 'running',
      startedAt: new Date(startedAt),
      totalTokens: 0,
      totalCostUsd: 0,
    },
  })

  const spanRow = {
    id: spanId!,
    runId,
    projectId,
    agentDefinitionId,
    parentSpanId: data.parentSpanId,
    spanType: spanType!,
    name: name!,
    startedAt: new Date(startedAt),
    endedAt: endMs !== undefined ? new Date(endedAt!) : undefined,
    durationMs,
    inputTokens,
    outputTokens,
    totalTokens: hasTokens ? spanTotalTokens : undefined,
    costUsd: effectiveCostUsd,
    model: data.model,
    inputPreview: data.inputPreview,
    outputPreview: data.outputPreview,
    statusCode: data.status,
    errorMessage: data.errorMessage,
    metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
  }

  // Upsert so duplicate span jobs (from SDK re-sending on complete()) are
  // silently ignored rather than raising a unique-constraint error.
  await prisma.agentSpan.upsert({
    where: { id_startedAt: { id: spanId!, startedAt: new Date(startedAt) } },
    create: spanRow,
    update: {},
  })

  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      totalTokens: { increment: spanTotalTokens },
      totalCostUsd: { increment: effectiveCostUsd ?? 0 },
    },
  })
}

async function handleRunEnd(data: AgentSpanJobData): Promise<void> {
  const { runId, projectId, endedAt, status } = data

  const aggregate = await prisma.agentSpan.aggregate({
    where: { runId },
    _sum: { totalTokens: true, costUsd: true },
  })

  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: status ?? 'completed',
      endedAt: endedAt ? new Date(endedAt) : new Date(),
      totalTokens: aggregate._sum.totalTokens ?? 0,
      totalCostUsd: aggregate._sum.costUsd ?? 0,
    },
  })

  const updatedRun = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: { _count: { select: { spans: true } } },
  })

  if (updatedRun) {
    await redis.publish(
      `agent-runs:${projectId}`,
      JSON.stringify({
        id: updatedRun.id,
        projectId: updatedRun.projectId,
        task: updatedRun.task,
        status: updatedRun.status,
        startedAt: updatedRun.startedAt.toISOString(),
        endedAt: updatedRun.endedAt?.toISOString() ?? null,
        totalTokens: updatedRun.totalTokens,
        totalCostUsd: updatedRun.totalCostUsd?.toNumber() ?? null,
        spanCount: updatedRun._count.spans,
      }),
    )

    evaluateAgentRunAlerts(projectId, runId, {
      totalTokens: updatedRun.totalTokens,
      startedAt: updatedRun.startedAt,
      endedAt: updatedRun.endedAt,
    }).catch((err: unknown) => {
      logger.error({ runId, err }, 'Failed to evaluate agent run alerts')
    })
  }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function processAgentSpan(job: Job<AgentSpanJobData>): Promise<void> {
  const { type } = job.data

  switch (type) {
    case 'run_start':
      await handleRunStart(job.data)
      break
    case 'span':
      await handleSpan(job.data)
      break
    case 'run_end':
      await handleRunEnd(job.data)
      break
    default:
      logger.warn({ jobId: job.id, type }, 'Unknown agent-span job type — skipping')
  }

  logger.info({ jobId: job.id, type, projectId: job.data.projectId }, 'Processed agent-span job')
}

// ── Worker factory ────────────────────────────────────────────────────────────

export function startAgentSpanWorker(connection: ConnectionOptions): Worker<AgentSpanJobData> {
  const worker = new Worker<AgentSpanJobData>('agent-spans', processAgentSpan, {
    connection,
    concurrency: 1,
  })

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Agent-span job completed')
  })

  worker.on('failed', (job, err) => {
    const attemptsAllowed = job?.opts?.attempts ?? 1
    const attemptsMade = job?.attemptsMade ?? 0

    if (attemptsMade >= attemptsAllowed) {
      logger.error(
        { jobId: job?.id, payload: job?.data, error: err.message, stack: err.stack },
        'Agent-span job permanently failed — dead-lettered',
      )
    } else {
      logger.warn(
        { jobId: job?.id, attempt: attemptsMade, error: err.message },
        'Agent-span job failed — will retry',
      )
    }
  })

  return worker
}
