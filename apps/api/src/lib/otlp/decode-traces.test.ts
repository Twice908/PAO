import { describe, it, expect } from 'vitest'
import { decodeTracesJson, toPaoPayloads } from './decode-traces'
import type { MappedSpan } from './map-span'

const TRACE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const START_NANO = '1756108800000000000'
const END_NANO = '1756108803000000000'

function jsonRequest(spans: unknown[], resourceAttrs: unknown[] = []) {
  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttrs },
        scopeSpans: [{ scope: { name: 'test' }, spans }],
      },
    ],
  }
}

describe('decodeTracesJson', () => {
  it('decodes a GenAI llm span', () => {
    const { spans, rejected } = decodeTracesJson(
      jsonRequest([
        {
          traceId: TRACE,
          spanId: 'bbbbbbbbbbbbbbbb',
          name: 'chat gpt-4o',
          startTimeUnixNano: START_NANO,
          endTimeUnixNano: END_NANO,
          attributes: [
            { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
            { key: 'gen_ai.request.model', value: { stringValue: 'gpt-4o' } },
            { key: 'gen_ai.usage.input_tokens', value: { intValue: '1200' } },
            { key: 'gen_ai.usage.output_tokens', value: { intValue: '340' } },
          ],
        },
      ]),
    )

    expect(rejected).toBe(0)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      runId: TRACE,
      spanType: 'llm_call',
      model: 'gpt-4o',
      inputTokens: 1200,
      outputTokens: 340,
    })
  })

  it('parses int64 token counts sent as JSON numbers', () => {
    const { spans } = decodeTracesJson(
      jsonRequest([
        {
          traceId: TRACE,
          spanId: 'bbbbbbbbbbbbbbbb',
          name: 'chat',
          startTimeUnixNano: START_NANO,
          attributes: [{ key: 'gen_ai.usage.input_tokens', value: { intValue: 42 } }],
        },
      ]),
    )
    expect(spans[0]!.inputTokens).toBe(42)
  })

  it('accepts snake_case field names', () => {
    const { spans } = decodeTracesJson({
      resource_spans: [
        {
          scope_spans: [
            {
              spans: [
                {
                  trace_id: TRACE,
                  span_id: 'bbbbbbbbbbbbbbbb',
                  name: 'chat',
                  start_time_unix_nano: START_NANO,
                },
              ],
            },
          ],
        },
      ],
    })
    expect(spans).toHaveLength(1)
    expect(spans[0]!.runId).toBe(TRACE)
  })

  it('merges resource attributes into every span', () => {
    const { spans } = decodeTracesJson(
      jsonRequest(
        [{ traceId: TRACE, spanId: 'bbbbbbbbbbbbbbbb', name: 'n', startTimeUnixNano: START_NANO }],
        [{ key: 'service.name', value: { stringValue: 'my-agent' } }],
      ),
    )
    expect(spans[0]!.agentName).toBe('my-agent')
  })

  it('counts unmappable spans as rejected rather than throwing', () => {
    const { spans, rejected } = decodeTracesJson(
      jsonRequest([
        { spanId: 'bbbbbbbbbbbbbbbb', name: 'no trace id', startTimeUnixNano: START_NANO },
        { traceId: TRACE, spanId: 'cccccccccccccccc', name: 'ok', startTimeUnixNano: START_NANO },
      ]),
    )
    expect(spans).toHaveLength(1)
    expect(rejected).toBe(1)
  })

  it('returns empty for a body with no resourceSpans', () => {
    expect(decodeTracesJson({}).spans).toHaveLength(0)
    expect(decodeTracesJson(null).spans).toHaveLength(0)
  })
})

// ─── Expansion ───────────────────────────────────────────────────────────────

function mapped(overrides: Partial<MappedSpan>): MappedSpan {
  return {
    runId: TRACE,
    spanId: 'bbbbbbbbbbbbbbbb',
    spanType: 'llm_call',
    name: 'span',
    startedAt: '2025-08-25T08:00:00.000Z',
    endedAt: '2025-08-25T08:00:03.000Z',
    status: 'success',
    isRoot: false,
    ...overrides,
  }
}

describe('toPaoPayloads', () => {
  it('expands a root span into run_start and run_end', () => {
    const payloads = toPaoPayloads([mapped({ isRoot: true, name: 'workflow.execute' })])
    expect(payloads.map((p) => p.type)).toEqual(['run_start', 'run_end'])
    expect(payloads[0]).toMatchObject({ runId: TRACE, task: 'workflow.execute' })
    expect(payloads[1]).toMatchObject({ status: 'completed' })
  })

  it('does not emit the root span again as a child span', () => {
    // Otherwise its tokens would be counted twice in the run rollup.
    const payloads = toPaoPayloads([mapped({ isRoot: true })])
    expect(payloads.filter((p) => p.type === 'span')).toHaveLength(0)
  })

  it('orders run_start before spans and run_end last', () => {
    const payloads = toPaoPayloads([
      mapped({ spanId: 'child', parentSpanId: 'root', isRoot: false }),
      mapped({ spanId: 'root', isRoot: true }),
    ])
    expect(payloads.map((p) => p.type)).toEqual(['run_start', 'span', 'run_end'])
  })

  it('marks the run failed when the root span errored', () => {
    const payloads = toPaoPayloads([
      mapped({ isRoot: true, status: 'error', errorMessage: 'died' }),
    ])
    const runEnd = payloads.find((p) => p.type === 'run_end')!
    expect(runEnd).toMatchObject({ status: 'failed', errorMessage: 'died' })
  })

  it('opens a run for a parentless trace that carries no root span', () => {
    const payloads = toPaoPayloads([mapped({ spanId: 'orphan', isRoot: true })])
    expect(payloads.map((p) => p.type)).toEqual(['run_start', 'run_end'])
  })

  it('does NOT invent a run when the batch holds only child spans', () => {
    // SimpleSpanProcessor exports one span per request, so children routinely
    // arrive before their root. Synthesising a run_start here would name the
    // run after a child, and the worker keeps whichever run_start lands first.
    const payloads = toPaoPayloads([
      mapped({ spanId: 'child', parentSpanId: 'root-elsewhere', isRoot: false }),
    ])
    expect(payloads.map((p) => p.type)).toEqual(['span'])
  })

  it('keeps a single run_start when several traces are batched', () => {
    const payloads = toPaoPayloads([
      mapped({ runId: 'trace-a', spanId: 'a', isRoot: true }),
      mapped({ runId: 'trace-b', spanId: 'b', isRoot: true }),
    ])
    expect(payloads.filter((p) => p.type === 'run_start')).toHaveLength(2)
    expect(payloads.filter((p) => p.type === 'run_end')).toHaveLength(2)
  })

  it('produces payloads accepted by the ingest schema', async () => {
    const { AgentSpanBatchSchema } = await import('../../schemas/agent-span.schema')
    const payloads = toPaoPayloads([
      mapped({ spanId: 'root', isRoot: true, name: 'workflow.execute' }),
      mapped({ spanId: 'child', parentSpanId: 'root', spanType: 'tool_call', name: 'HTTP Request' }),
    ])
    const result = AgentSpanBatchSchema.safeParse(payloads)
    expect(result.success).toBe(true)
  })
})
