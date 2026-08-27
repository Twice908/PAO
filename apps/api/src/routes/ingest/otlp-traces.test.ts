import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import Fastify from 'fastify'
import { otlpTraceRoutes } from './otlp-traces'

vi.mock('../../env', () => ({
  env: { NODE_ENV: 'test', PORT: '3001', REDIS_URL: 'redis://localhost:6379', DATABASE_URL: 'postgresql://localhost/test', API_KEY_SECRET: 'test_secret_at_least_32_characters_long', CLERK_SECRET_KEY: 'sk_test_xxx', CLERK_WEBHOOK_SECRET: 'whsec_xxx' },
}))
vi.mock('@pulse/db', () => ({ prisma: { project: { findUnique: vi.fn() } } }))
vi.mock('../../lib/queue', () => ({ agentSpansQueue: { add: vi.fn().mockResolvedValue(undefined) } }))

// ─── Protobuf fixture builder ────────────────────────────────────────────────

function varint(n: number | bigint): number[] {
  let v = BigInt(n)
  const out: number[] = []
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) b |= 0x80
    out.push(b)
  } while (v > 0n)
  return out
}
const tag = (f: number, w: number): number[] => varint((f << 3) | w)
const lenDelim = (f: number, p: number[]): number[] => [...tag(f, 2), ...varint(p.length), ...p]
const str = (f: number, s: string): number[] => lenDelim(f, [...new TextEncoder().encode(s)])
const bytesField = (f: number, b: number[]): number[] => lenDelim(f, b)
function fixed64(f: number, n: bigint): number[] {
  const out = [...tag(f, 1)]
  for (let i = 0; i < 8; i += 1) out.push(Number((n >> BigInt(8 * i)) & 0xffn))
  return out
}
const stringAttr = (key: string, value: string): number[] =>
  lenDelim(9, [...str(1, key), ...lenDelim(2, str(1, value))])
const intAttr = (key: string, value: number): number[] =>
  lenDelim(9, [...str(1, key), ...lenDelim(2, [...tag(3, 0), ...varint(value)])])

const TRACE_ID_BYTES = Array.from({ length: 16 }, (_, i) => i + 1)
const SPAN_ID_BYTES = Array.from({ length: 8 }, (_, i) => i + 1)
const START = 1_756_108_800_000_000_000n

function buildProtobufRequest(): Buffer {
  const span = [
    ...bytesField(1, TRACE_ID_BYTES),
    ...bytesField(2, SPAN_ID_BYTES),
    ...str(5, 'chat gpt-4o'),
    ...fixed64(7, START),
    ...fixed64(8, START + 3_000_000_000n),
    ...stringAttr('gen_ai.operation.name', 'chat'),
    ...stringAttr('gen_ai.request.model', 'gpt-4o'),
    ...intAttr('gen_ai.usage.input_tokens', 1200),
    ...intAttr('gen_ai.usage.output_tokens', 340),
  ]
  const scopeSpans = lenDelim(2, span)
  const resourceSpans = lenDelim(2, scopeSpans)
  return Buffer.from(lenDelim(1, resourceSpans))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(otlpTraceRoutes)
  return app
}

const AUTH = { authorization: 'Bearer pk_live_testkey' }
const URL = '/ingest/otlp/v1/traces'

const JSON_BODY = {
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my-agent' } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: '0102030405060708090a0b0c0d0e0f10',
              spanId: '0102030405060708',
              name: 'chat gpt-4o',
              startTimeUnixNano: '1756108800000000000',
              endTimeUnixNano: '1756108803000000000',
              attributes: [
                { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                { key: 'gen_ai.usage.input_tokens', value: { intValue: '1200' } },
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe('POST /ingest/otlp/v1/traces', () => {
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

  it('returns 401 without an Authorization header', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: JSON_BODY })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 for an unknown API key', async () => {
    const { prisma } = await import('@pulse/db')
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null)
    const res = await app.inject({ method: 'POST', url: URL, headers: AUTH, payload: JSON_BODY })
    expect(res.statusCode).toBe(401)
  })

  it('accepts an OTLP/JSON payload and enqueues run_start, span and run_end', async () => {
    const { agentSpansQueue } = await import('../../lib/queue')
    const res = await app.inject({ method: 'POST', url: URL, headers: AUTH, payload: JSON_BODY })

    expect(res.statusCode).toBe(200)
    // Single root span → run_start + run_end (root is not re-emitted as a span)
    const types = vi.mocked(agentSpansQueue.add).mock.calls.map((c) => (c[1] as { type: string }).type)
    expect(types).toEqual(['run_start', 'run_end'])
  })

  it('stamps projectId on every enqueued payload', async () => {
    const { agentSpansQueue } = await import('../../lib/queue')
    await app.inject({ method: 'POST', url: URL, headers: AUTH, payload: JSON_BODY })
    for (const call of vi.mocked(agentSpansQueue.add).mock.calls) {
      expect(call[1]).toMatchObject({ projectId: 'proj_test' })
    }
  })

  it('accepts a binary protobuf payload', async () => {
    const { agentSpansQueue } = await import('../../lib/queue')
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { ...AUTH, 'content-type': 'application/x-protobuf' },
      payload: buildProtobufRequest(),
    })

    expect(res.statusCode).toBe(200)
    const runStart = vi.mocked(agentSpansQueue.add).mock.calls
      .map((c) => c[1] as Record<string, unknown>)
      .find((p) => p.type === 'run_start')
    expect(runStart).toMatchObject({ runId: '0102030405060708090a0b0c0d0e0f10', task: 'chat gpt-4o' })
  })

  it('accepts a gzipped protobuf payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {
        ...AUTH,
        'content-type': 'application/x-protobuf',
        'content-encoding': 'gzip',
      },
      payload: gzipSync(buildProtobufRequest()),
    })
    expect(res.statusCode).toBe(200)
  })

  it('reports dropped spans as OTLP partial success on a 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: AUTH,
      payload: {
        resourceSpans: [
          { scopeSpans: [{ spans: [{ spanId: '0102030405060708', name: 'no trace id', startTimeUnixNano: '1756108800000000000' }] }] },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().partialSuccess.rejectedSpans).toBe(1)
  })

  it('returns an empty partialSuccess when nothing was dropped', async () => {
    const res = await app.inject({ method: 'POST', url: URL, headers: AUTH, payload: JSON_BODY })
    expect(res.json().partialSuccess).toEqual({})
  })

  it('returns 400 for a malformed protobuf body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { ...AUTH, 'content-type': 'application/x-protobuf' },
      // Declares a 200-byte field inside a 3-byte buffer.
      payload: Buffer.from([0x0a, 0xc8, 0x01]),
    })
    expect(res.statusCode).toBe(400)
  })

  it('accepts an empty trace export without enqueuing anything', async () => {
    const { agentSpansQueue } = await import('../../lib/queue')
    const res = await app.inject({ method: 'POST', url: URL, headers: AUTH, payload: { resourceSpans: [] } })
    expect(res.statusCode).toBe(200)
    expect(agentSpansQueue.add).not.toHaveBeenCalled()
  })
})
