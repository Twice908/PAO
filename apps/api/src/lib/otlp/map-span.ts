/**
 * Map one OTLP span onto PAO's span model.
 *
 * Handles two producers explicitly:
 *   - GenAI-instrumented agents (OpenLLMetry, OpenInference, n8n >= 2.33 with
 *     N8N_AGENTS_TRACING_ENABLED) via the `gen_ai.*` conventions.
 *   - n8n's own `workflow.execute` / `node.execute` spans.
 *
 * The GenAI conventions are experimental, so attribute lookup is tolerant:
 * several historical spellings are accepted, and every attribute — recognised
 * or not — is carried through in `metadata` so no data is lost to a rename.
 */

import type { AttributeValue } from './attributes'

export type MappedSpan = {
  runId: string
  spanId: string
  parentSpanId?: string
  spanType: 'llm_call' | 'tool_call' | 'memory_read' | 'agent_message' | 'error'
  name: string
  model?: string
  agentName?: string
  startedAt: string
  endedAt?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  inputPreview?: string
  outputPreview?: string
  status?: 'success' | 'error' | 'timeout'
  errorMessage?: string
  metadata?: Record<string, unknown>
  /** True when this span represents a whole workflow/agent invocation. */
  isRoot: boolean
}

export type OtlpSpanInput = {
  traceId?: string
  spanId?: string
  parentSpanId?: string
  name?: string
  startTimeUnixNano?: bigint
  endTimeUnixNano?: bigint
  statusCode?: number
  statusMessage?: string
  attributes: Record<string, AttributeValue>
}

const MAX_PREVIEW = 500

/** Status.StatusCode, per trace.proto. */
const STATUS_CODE_ERROR = 2

function firstAttr(
  attrs: Record<string, AttributeValue>,
  keys: string[],
): AttributeValue | undefined {
  for (const key of keys) {
    const value = attrs[key]
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

function asString(value: AttributeValue | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

function asNumber(value: AttributeValue | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function nanosToIso(nanos: bigint | undefined): string | undefined {
  if (nanos === undefined || nanos === 0n) return undefined
  // Truncate to milliseconds — Date has no finer resolution. Sub-millisecond
  // precision is retained in metadata by the caller where it matters.
  const millis = Number(nanos / 1_000_000n)
  if (!Number.isFinite(millis)) return undefined
  return new Date(millis).toISOString()
}

/**
 * Decide PAO's span type.
 *
 * `gen_ai.operation.name` is the primary signal; span name and the presence of
 * tool/model attributes are fallbacks for instrumentations that omit it.
 */
function resolveSpanType(
  attrs: Record<string, AttributeValue>,
  spanName: string,
): MappedSpan['spanType'] {
  const operation = asString(
    firstAttr(attrs, ['gen_ai.operation.name', 'gen_ai.operation', 'openinference.span.kind']),
  )?.toLowerCase()

  if (operation) {
    if (operation === 'execute_tool' || operation === 'tool') return 'tool_call'
    if (operation === 'invoke_agent' || operation === 'create_agent' || operation === 'agent') {
      return 'agent_message'
    }
    if (operation === 'retrieval' || operation === 'reranker' || operation === 'embeddings') {
      return 'memory_read'
    }
    if (
      operation === 'chat' ||
      operation === 'text_completion' ||
      operation === 'generate_content' ||
      operation === 'llm'
    ) {
      return 'llm_call'
    }
  }

  if (firstAttr(attrs, ['gen_ai.tool.name', 'gen_ai.tool.call.id', 'tool.name'])) return 'tool_call'
  if (firstAttr(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'llm.model_name'])) {
    return 'llm_call'
  }

  const lowerName = spanName.toLowerCase()
  if (lowerName.includes('tool')) return 'tool_call'
  if (lowerName.includes('embed') || lowerName.includes('retriev')) return 'memory_read'

  // n8n node.execute spans and anything else unrecognised: a workflow step is
  // closest to a tool call in PAO's model.
  return 'tool_call'
}

/**
 * A root span is one with no parent, or one n8n marks as a whole workflow
 * execution. These become the PAO run rather than a span within it.
 */
function resolveIsRoot(input: OtlpSpanInput, attrs: Record<string, AttributeValue>): boolean {
  if (input.name === 'workflow.execute') return true
  if (firstAttr(attrs, ['n8n.workflow.id']) && !input.parentSpanId) return true
  return !input.parentSpanId
}

export function mapOtlpSpan(input: OtlpSpanInput): MappedSpan | undefined {
  // trace_id and span_id are the run/span primary keys — a span without them
  // cannot be stored.
  if (!input.traceId || !input.spanId) return undefined

  const attrs = input.attributes
  const startedAt = nanosToIso(input.startTimeUnixNano)
  if (!startedAt) return undefined

  const spanName =
    input.name ??
    asString(firstAttr(attrs, ['gen_ai.tool.name', 'gen_ai.agent.name', 'n8n.node.name'])) ??
    'span'

  const isError = input.statusCode === STATUS_CODE_ERROR
  const errorMessage =
    input.statusMessage ??
    asString(firstAttr(attrs, ['exception.message', 'error.message', 'n8n.node.error']))

  const inputPreview = asString(
    firstAttr(attrs, [
      'gen_ai.input.messages',
      'gen_ai.prompt',
      'gen_ai.tool.call.arguments',
      'input.value',
    ]),
  )
  const outputPreview = asString(
    firstAttr(attrs, [
      'gen_ai.output.messages',
      'gen_ai.completion',
      'gen_ai.tool.call.result',
      'output.value',
    ]),
  )

  return {
    runId: input.traceId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId,
    spanType: isError ? 'error' : resolveSpanType(attrs, spanName),
    name: spanName,
    model: asString(
      firstAttr(attrs, ['gen_ai.request.model', 'gen_ai.response.model', 'llm.model_name']),
    ),
    agentName: asString(
      firstAttr(attrs, ['gen_ai.agent.name', 'n8n.workflow.name', 'service.name']),
    ),
    startedAt,
    endedAt: nanosToIso(input.endTimeUnixNano),
    inputTokens: asNumber(
      firstAttr(attrs, [
        'gen_ai.usage.input_tokens',
        'gen_ai.usage.prompt_tokens',
        'llm.token_count.prompt',
      ]),
    ),
    outputTokens: asNumber(
      firstAttr(attrs, [
        'gen_ai.usage.output_tokens',
        'gen_ai.usage.completion_tokens',
        'llm.token_count.completion',
      ]),
    ),
    // Rarely present in OTLP; the worker derives it from tokens when absent.
    costUsd: asNumber(firstAttr(attrs, ['gen_ai.usage.cost', 'llm.usage.total_cost'])),
    inputPreview: inputPreview?.slice(0, MAX_PREVIEW),
    outputPreview: outputPreview?.slice(0, MAX_PREVIEW),
    status: isError ? 'error' : 'success',
    errorMessage: isError ? (errorMessage ?? 'Span reported an error status') : undefined,
    // Every attribute rides along, so an attribute rename in the still-
    // experimental GenAI spec degrades a field rather than losing the data.
    metadata: Object.keys(attrs).length > 0 ? attrs : undefined,
    isRoot: resolveIsRoot(input, attrs),
  }
}
