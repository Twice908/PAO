import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PulseAgent } from '../agent'

type MockFetch = ReturnType<typeof vi.fn>

describe('PulseAgent SDK', () => {
  let fetchMock: MockFetch

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete process.env['PULSE_DISABLED']
  })

  it('startRun sends correct run_start payload', async () => {
    const agent = new PulseAgent({ apiKey: 'test-key', host: 'http://localhost:3000' })
    await agent.startRun('Summarize report', { metadata: { triggeredBy: 'cron' } })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/ingest/agent-span')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key')

    const body = JSON.parse(init.body as string) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)

    const payload = body[0] as Record<string, unknown>
    expect(payload['type']).toBe('run_start')
    expect(payload['task']).toBe('Summarize report')
    expect(typeof payload['runId']).toBe('string')
    expect(typeof payload['startedAt']).toBe('string')
    expect((payload['metadata'] as Record<string, unknown>)['triggeredBy']).toBe('cron')
  })

  it('span.end buffers payload — does NOT call fetch', async () => {
    const agent = new PulseAgent({ apiKey: 'test-key', host: 'http://localhost:3000' })
    const run = await agent.startRun('Test task')

    fetchMock.mockClear()

    const span = run.startSpan('llm_call', { name: 'gpt-4o', inputPreview: 'Hello' })
    span.end({ outputPreview: 'World', inputTokens: 10, outputTokens: 5, status: 'success' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('run.complete flushes all spans + run_end in one fetch call', async () => {
    const agent = new PulseAgent({ apiKey: 'test-key', host: 'http://localhost:3000' })
    const run = await agent.startRun('Test task')

    fetchMock.mockClear()

    const span1 = run.startSpan('llm_call', { name: 'step-1' })
    span1.end({ status: 'success' })

    const span2 = run.startSpan('tool_call', { name: 'step-2' })
    span2.end({ status: 'success' })

    await run.complete({ status: 'completed' })

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(3)

    const types = (body as Array<Record<string, unknown>>).map((p) => p['type'])
    expect(types).toEqual(['span', 'span', 'run_end'])

    const runEnd = body[2] as Record<string, unknown>
    expect(runEnd['status']).toBe('completed')
  })

  it('inputPreview and outputPreview are truncated at 500 chars', async () => {
    const agent = new PulseAgent({ apiKey: 'test-key', host: 'http://localhost:3000' })
    const run = await agent.startRun('Test task')

    fetchMock.mockClear()

    const longInput = 'i'.repeat(600)
    const longOutput = 'o'.repeat(700)

    const span = run.startSpan('llm_call', { name: 'big-call', inputPreview: longInput })
    span.end({ outputPreview: longOutput })

    await run.complete({ status: 'completed' })

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as unknown[]
    const spanPayload = body[0] as Record<string, unknown>

    expect(spanPayload['inputPreview']).toHaveLength(500)
    expect(spanPayload['outputPreview']).toHaveLength(500)
    expect(spanPayload['inputPreview']).toBe('i'.repeat(500))
    expect(spanPayload['outputPreview']).toBe('o'.repeat(500))
  })

  it('no-op mode: zero fetch calls across the full run lifecycle', async () => {
    process.env['PULSE_DISABLED'] = 'true'

    const agent = new PulseAgent({ apiKey: 'test-key', host: 'http://localhost:3000' })
    const run = await agent.startRun('Test task')
    const span = run.startSpan('llm_call', { name: 'step-1', inputPreview: 'Hello' })
    span.end({ outputPreview: 'World' })
    await run.complete({ status: 'completed' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
