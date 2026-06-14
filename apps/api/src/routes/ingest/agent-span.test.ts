import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import { agentSpanRoutes } from './agent-span'

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../env', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: '3001',
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgresql://localhost/test',
    API_KEY_SECRET: 'test_secret_at_least_32_characters_long',
    CLERK_SECRET_KEY: 'sk_test_xxx',
    CLERK_WEBHOOK_SECRET: 'whsec_xxx',
  },
}))

vi.mock('@pulse/db', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}))

vi.mock('../../lib/queue', () => ({
  agentSpansQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(agentSpanRoutes)
  return app
}

const AUTH = { authorization: 'Bearer pk_live_testkey' }
const NOW = new Date().toISOString()
const RUN_ID = '123e4567-e89b-12d3-a456-426614174000'

const VALID_RUN_START = { type: 'run_start', runId: RUN_ID, task: 'Summarize report', startedAt: NOW }
const VALID_SPAN = {
  type: 'span',
  runId: RUN_ID,
  spanId: '223e4567-e89b-12d3-a456-426614174001',
  spanType: 'llm_call',
  name: 'gpt-4o completion',
  startedAt: NOW,
  model: 'gpt-4o',
}
const VALID_RUN_END = { type: 'run_end', runId: RUN_ID, startedAt: NOW, status: 'success' }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /ingest/agent-span', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    app = await buildApp()
    const { prisma } = await import('@pulse/db')
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'proj_test' } as never)
  })

  afterEach(async () => {
    await app.close()
    vi.clearAllMocks()
  })

  it('returns 202 for valid run_start payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [VALID_RUN_START],
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().success).toBe(true)
  })

  it('returns 202 for valid span payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [VALID_SPAN],
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().success).toBe(true)
  })

  it('returns 202 for valid run_end payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [VALID_RUN_END],
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().success).toBe(true)
  })

  it('returns 401 when Authorization header is absent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      body: [VALID_RUN_START],
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: { authorization: 'Token pk_live_testkey' },
      body: [VALID_RUN_START],
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when API key is not found in DB', async () => {
    const { prisma } = await import('@pulse/db')
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: { authorization: 'Bearer pk_live_unknown' },
      body: [VALID_RUN_START],
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('INVALID_KEY')
  })

  it('returns 400 when type field is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [{ runId: RUN_ID, startedAt: NOW }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('BAD_REQUEST')
  })

  it('returns 400 when runId field is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [{ type: 'run_start', startedAt: NOW }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('BAD_REQUEST')
  })

  it('returns 400 when startedAt is not a valid datetime', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [{ type: 'run_start', runId: RUN_ID, startedAt: 'not-a-date' }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('BAD_REQUEST')
  })

  it('enqueues with projectId after successful auth + validation', async () => {
    const { agentSpansQueue } = await import('../../lib/queue')

    await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [VALID_SPAN],
    })

    expect(agentSpansQueue.add).toHaveBeenCalledOnce()
    expect(vi.mocked(agentSpansQueue.add)).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ projectId: 'proj_test', type: 'span' }),
    )
  })
})
