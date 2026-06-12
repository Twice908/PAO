import type { FastifyInstance } from 'fastify'
import IORedis from 'ioredis'
import { prisma } from '@pulse/db'
import { verifyClerkJwt } from '../lib/auth'
import { env } from '../env'

const HEARTBEAT_INTERVAL_MS = 30_000
const INITIAL_RUN_LIMIT = 20

async function getOwnedProject(clerkId: string, projectId: string) {
  const user = await prisma.user.findUnique({ where: { clerkId } })
  if (!user) return null
  return prisma.project.findFirst({ where: { id: projectId, userId: user.id } })
}

export async function agentsStreamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/projects/:projectId/agents/stream', async (request, reply) => {
    const clerkId = await verifyClerkJwt(request.headers.authorization, reply)
    if (!clerkId) return

    const { projectId } = request.params as { projectId: string }
    const project = await getOwnedProject(clerkId, projectId)
    if (!project) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Project not found' },
      })
    }

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const write = (chunk: string) => {
      if (!res.writableEnded) res.write(chunk)
    }

    const initialRuns = await prisma.agentRun.findMany({
      where: { projectId },
      include: { _count: { select: { spans: true } } },
      orderBy: { startedAt: 'desc' },
      take: INITIAL_RUN_LIMIT,
    })

    for (const run of initialRuns.reverse()) {
      const payload = JSON.stringify({
        id: run.id,
        projectId: run.projectId,
        task: run.task,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        endedAt: run.endedAt?.toISOString() ?? null,
        totalTokens: run.totalTokens,
        totalCostUsd: run.totalCostUsd?.toNumber() ?? null,
        spanCount: run._count.spans,
      })
      write(`data: ${payload}\n\n`)
    }

    const subscriber = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })
    await subscriber.subscribe(`agent-runs:${projectId}`)

    subscriber.on('message', (_channel: string, message: string) => {
      write(`data: ${message}\n\n`)
    })

    const heartbeat = setInterval(() => write(': heartbeat\n\n'), HEARTBEAT_INTERVAL_MS)

    res.on('close', () => {
      clearInterval(heartbeat)
      subscriber.unsubscribe().finally(() => subscriber.disconnect())
    })
  })
}
