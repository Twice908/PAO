import { describe, it, expect } from 'vitest'
import { mapOtlpSpan } from './map-span'
import type { OtlpSpanInput } from './map-span'

const START = 1_756_108_800_000_000_000n // 2025-08-25T08:00:00Z in nanos
const END = 1_756_108_803_000_000_000n

function span(overrides: Partial<OtlpSpanInput> = {}): OtlpSpanInput {
  return {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    spanId: 'bbbbbbbbbbbbbbbb',
    name: 'chat gpt-4o',
    startTimeUnixNano: START,
    endTimeUnixNano: END,
    attributes: {},
    ...overrides,
  }
}

describe('mapOtlpSpan', () => {
  it('maps trace_id to runId and span_id to spanId', () => {
    const m = mapOtlpSpan(span())!
    expect(m.runId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(m.spanId).toBe('bbbbbbbbbbbbbbbb')
  })

  it('converts nanosecond timestamps to ISO-8601', () => {
    const m = mapOtlpSpan(span())!
    expect(m.startedAt).toBe('2025-08-25T08:00:00.000Z')
    expect(m.endedAt).toBe('2025-08-25T08:00:03.000Z')
  })

  it('drops a span with no trace_id or span_id', () => {
    expect(mapOtlpSpan(span({ traceId: undefined }))).toBeUndefined()
    expect(mapOtlpSpan(span({ spanId: undefined }))).toBeUndefined()
  })

  it('drops a span with no start time', () => {
    expect(mapOtlpSpan(span({ startTimeUnixNano: undefined }))).toBeUndefined()
  })

  // ── GenAI semantic conventions ────────────────────────────────────────────

  it('maps a chat operation to llm_call with model and tokens', () => {
    const m = mapOtlpSpan(
      span({
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': 1200,
          'gen_ai.usage.output_tokens': 340,
        },
      }),
    )!
    expect(m.spanType).toBe('llm_call')
    expect(m.model).toBe('gpt-4o')
    expect(m.inputTokens).toBe(1200)
    expect(m.outputTokens).toBe(340)
  })

  it('maps execute_tool to tool_call', () => {
    const m = mapOtlpSpan(
      span({ attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': 'web_search' } }),
    )!
    expect(m.spanType).toBe('tool_call')
  })

  it('maps invoke_agent to agent_message', () => {
    const m = mapOtlpSpan(span({ attributes: { 'gen_ai.operation.name': 'invoke_agent' } }))!
    expect(m.spanType).toBe('agent_message')
  })

  it('maps embeddings and retrieval to memory_read', () => {
    expect(mapOtlpSpan(span({ attributes: { 'gen_ai.operation.name': 'embeddings' } }))!.spanType).toBe('memory_read')
    expect(mapOtlpSpan(span({ attributes: { 'gen_ai.operation.name': 'retrieval' } }))!.spanType).toBe('memory_read')
  })

  it('accepts the deprecated prompt/completion token spellings', () => {
    const m = mapOtlpSpan(
      span({
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.usage.prompt_tokens': 10,
          'gen_ai.usage.completion_tokens': 20,
        },
      }),
    )!
    expect(m.inputTokens).toBe(10)
    expect(m.outputTokens).toBe(20)
  })

  it('accepts OpenInference llm.* token attributes', () => {
    const m = mapOtlpSpan(
      span({ attributes: { 'llm.model_name': 'claude-sonnet-4', 'llm.token_count.prompt': 5, 'llm.token_count.completion': 7 } }),
    )!
    expect(m.spanType).toBe('llm_call')
    expect(m.model).toBe('claude-sonnet-4')
    expect(m.inputTokens).toBe(5)
    expect(m.outputTokens).toBe(7)
  })

  it('infers llm_call from a model attribute when operation is absent', () => {
    const m = mapOtlpSpan(span({ attributes: { 'gen_ai.request.model': 'gpt-4o' } }))!
    expect(m.spanType).toBe('llm_call')
  })

  it('infers tool_call from a tool attribute when operation is absent', () => {
    const m = mapOtlpSpan(span({ attributes: { 'gen_ai.tool.name': 'calculator' } }))!
    expect(m.spanType).toBe('tool_call')
  })

  // ── Status ────────────────────────────────────────────────────────────────

  it('maps STATUS_CODE_ERROR to an error span carrying the message', () => {
    const m = mapOtlpSpan(span({ statusCode: 2, statusMessage: 'upstream timeout' }))!
    expect(m.spanType).toBe('error')
    expect(m.status).toBe('error')
    expect(m.errorMessage).toBe('upstream timeout')
  })

  it('falls back to exception.message when status carries no message', () => {
    const m = mapOtlpSpan(span({ statusCode: 2, attributes: { 'exception.message': 'boom' } }))!
    expect(m.errorMessage).toBe('boom')
  })

  it('treats UNSET and OK as success', () => {
    expect(mapOtlpSpan(span({ statusCode: 0 }))!.status).toBe('success')
    expect(mapOtlpSpan(span({ statusCode: 1 }))!.status).toBe('success')
  })

  // ── Roots ─────────────────────────────────────────────────────────────────

  it('treats a span with no parent as a root', () => {
    expect(mapOtlpSpan(span())!.isRoot).toBe(true)
  })

  it('treats a span with a parent as non-root', () => {
    expect(mapOtlpSpan(span({ parentSpanId: 'cccccccccccccccc' }))!.isRoot).toBe(false)
  })

  it('treats n8n workflow.execute as a root', () => {
    const m = mapOtlpSpan(span({ name: 'workflow.execute', parentSpanId: 'cccccccccccccccc' }))!
    expect(m.isRoot).toBe(true)
  })

  // ── Preservation ──────────────────────────────────────────────────────────

  it('carries every attribute through in metadata', () => {
    const m = mapOtlpSpan(
      span({ attributes: { 'gen_ai.future.unknown.attribute': 'v', 'n8n.node.type': 'httpRequest' } }),
    )!
    expect(m.metadata).toMatchObject({
      'gen_ai.future.unknown.attribute': 'v',
      'n8n.node.type': 'httpRequest',
    })
  })

  it('truncates previews to 500 characters', () => {
    const m = mapOtlpSpan(span({ attributes: { 'gen_ai.input.messages': 'x'.repeat(900) } }))!
    expect(m.inputPreview).toHaveLength(500)
  })

  it('never throws on a completely unrecognised span', () => {
    const m = mapOtlpSpan(span({ name: 'some.custom.span', attributes: { foo: 'bar' } }))!
    expect(m.spanType).toBe('tool_call')
    expect(m.name).toBe('some.custom.span')
  })
})
