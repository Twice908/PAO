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
const VALID_RUN_END = { type: 'run_end', runId: RUN_ID, startedAt: NOW, status: 'completed' }

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

  // ── Gap 1: payloads that would pass validation then die in the worker ──────

  it('returns 400 for a span missing spanType (non-nullable in DB)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [{ type: 'span', runId: RUN_ID, name: 'x', startedAt: NOW }],
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for a span missing name (non-nullable in DB)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [{ type: 'span', runId: RUN_ID, spanType: 'llm_call', startedAt: NOW }],
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a span-level status on run_end', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [{ type: 'run_end', runId: RUN_ID, startedAt: NOW, status: 'success' }],
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a run-level status on a span', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [{ ...VALID_SPAN, status: 'completed' }],
    })
    expect(res.statusCode).toBe(400)
  })

  // ── No-code ergonomics ────────────────────────────────────────────────────

  it('mints a spanId server-side when the caller omits it', async () => {
    const { agentSpansQueue } = await import('../../lib/queue')
    const { spanId: _omitted, ...noSpanId } = VALID_SPAN

    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [noSpanId],
    })

    expect(res.statusCode).toBe(202)
    const enqueued = vi.mocked(agentSpansQueue.add).mock.calls[0]?.[1] as { spanId?: string }
    expect(enqueued.spanId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('accepts a bare object as a one-element batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: VALID_RUN_START,
    })
    expect(res.statusCode).toBe(202)
    expect(res.json().accepted).toBe(1)
  })

  it('accepts ISO-8601 timestamps carrying a UTC offset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [{ type: 'run_start', runId: RUN_ID, startedAt: '2026-01-01T00:00:00+05:30' }],
    })
    expect(res.statusCode).toBe(202)
  })

  it('reports the offending index and field on validation failure', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ingest/agent-span',
      headers: AUTH,
      body: [VALID_RUN_START, { type: 'span', runId: RUN_ID, startedAt: NOW }],
    })
    expect(res.statusCode).toBe(400)
    const { issues } = res.json().error
    expect(issues.some((i: { index: number }) => i.index === 1)).toBe(true)
    expect(issues.some((i: { field: string }) => i.field === 'spanType')).toBe(true)
  })
})
