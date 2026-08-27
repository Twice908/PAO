import type { FastifyInstance } from 'fastify'
import { prisma } from '@pulse/db'
import { hashApiKey } from '../../lib/api-key'
import { agentSpansQueue } from '../../lib/queue'
import { randomUUID } from 'node:crypto'
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

    // Accept a bare object as a one-element batch. No-code HTTP modules
    // frequently cannot express a top-level JSON array.
    const rawBody = Array.isArray(request.body) ? request.body : [request.body]

    const parsed = AgentSpanBatchSchema.safeParse(rawBody)
    if (!parsed.success) {
      // Field-level detail: a raw Zod message string is undebuggable for
      // someone assembling this payload in an n8n or Make expression editor.
      return reply.status(400).send({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'One or more payloads failed validation',
          issues: parsed.error.issues.map((issue) => ({
            index: typeof issue.path[0] === 'number' ? issue.path[0] : null,
            field: issue.path.slice(1).join('.') || null,
            message: issue.message,
          })),
        },
      })
    }

    // Fire and forget — never block the response path on the queue push
    for (const span of parsed.data) {
      // Mint spanId server-side when omitted. It is the span's primary key,
      // and no-code callers often have no UUID generator available.
      const payload =
        span.type === 'span' && !span.spanId ? { ...span, spanId: randomUUID() } : span

      agentSpansQueue.add('process', { ...payload, projectId: project.id }).catch((err: unknown) => {
        request.log.warn({ err }, 'Failed to enqueue agent span')
      })
    }

    return reply.status(202).send({ success: true, accepted: parsed.data.length })
  })
}
