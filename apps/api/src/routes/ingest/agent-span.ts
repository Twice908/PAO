import type { FastifyInstance } from 'fastify'
import { prisma } from '@pulse/db'
import { hashApiKey } from '../../lib/api-key'
import { agentSpansQueue } from '../../lib/queue'
import { AgentSpanBatchSchema } from '../../schemas/agent-span.schema'

export async function agentSpanRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ingest/agent-span', async (request, reply) => {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key' },
      })
    }

    const rawApiKey = authHeader.slice('Bearer '.length)
    const apiKeyHash = hashApiKey(rawApiKey)

    const project = await prisma.project.findUnique({
      where: { apiKeyHash },
    })

    if (!project) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_KEY', message: 'Invalid API key' },
      })
    }

    const parsed = AgentSpanBatchSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      })
    }

    // Fire and forget — never block the response path on the queue push
    for (const span of parsed.data) {
      agentSpansQueue.add('process', { ...span, projectId: project.id }).catch((err: unknown) => {
        request.log.warn({ err }, 'Failed to enqueue agent span')
      })
    }

    return reply.status(202).send({ success: true })
  })
}
