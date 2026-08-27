/**
 * Decode an OTLP ExportTraceServiceRequest (protobuf or JSON) into the PAO
 * ingest payloads the existing agent-spans queue already understands.
 *
 * OTLP has no notion of a "run": a trace is just spans sharing a trace_id.
 * PAO needs an explicit run_start/run_end pair, so a root span is expanded
 * into run_start + span + run_end. This keeps the worker and dashboard
 * unchanged — OTLP becomes a second front door onto the same pipeline.
 */

import { decodeAttributes, flattenJsonAttributes } from './attributes'
import type { AttributeValue } from './attributes'
import { mapOtlpSpan } from './map-span'
import type { MappedSpan, OtlpSpanInput } from './map-span'
import { decodeMessage, getBytes, getRepeatedBytes, getString, getVarint, toHex } from './protobuf'

// Field numbers from opentelemetry/proto/trace/v1/trace.proto
const RESOURCE_SPANS = 1
const RS_RESOURCE = 1
const RS_SCOPE_SPANS = 2
const SS_SPANS = 2
const RESOURCE_ATTRIBUTES = 1

const SPAN_TRACE_ID = 1
const SPAN_SPAN_ID = 2
const SPAN_PARENT_SPAN_ID = 4
const SPAN_NAME = 5
const SPAN_START_NANO = 7
const SPAN_END_NANO = 8
const SPAN_ATTRIBUTES = 9
const SPAN_STATUS = 15
const STATUS_MESSAGE = 2
const STATUS_CODE = 3

export type DecodedTraces = {
  spans: MappedSpan[]
  /** Spans that could not be mapped (missing ids or timestamps). */
  rejected: number
}

// ── Protobuf ─────────────────────────────────────────────────────────────────

export function decodeTracesProtobuf(body: Uint8Array): DecodedTraces {
  const root = decodeMessage(body)
  const spans: MappedSpan[] = []
  let rejected = 0

  for (const rsBytes of getRepeatedBytes(root, RESOURCE_SPANS)) {
    const rs = decodeMessage(rsBytes)

    // Resource attributes (service.name and friends) apply to every span
    // beneath, so merge them in as a base layer.
    const resourceBytes = getBytes(rs, RS_RESOURCE)
    const resourceAttrs = resourceBytes
      ? decodeAttributes(getRepeatedBytes(decodeMessage(resourceBytes), RESOURCE_ATTRIBUTES))
      : {}

    for (const ssBytes of getRepeatedBytes(rs, RS_SCOPE_SPANS)) {
      const ss = decodeMessage(ssBytes)

      for (const spanBytes of getRepeatedBytes(ss, SS_SPANS)) {
        const span = decodeMessage(spanBytes)

        const statusBytes = getBytes(span, SPAN_STATUS)
        const status = statusBytes ? decodeMessage(statusBytes) : undefined

        const input: OtlpSpanInput = {
          traceId: toHex(getBytes(span, SPAN_TRACE_ID)),
          spanId: toHex(getBytes(span, SPAN_SPAN_ID)),
          parentSpanId: toHex(getBytes(span, SPAN_PARENT_SPAN_ID)),
          name: getString(span, SPAN_NAME),
          startTimeUnixNano: getVarint(span, SPAN_START_NANO),
          endTimeUnixNano: getVarint(span, SPAN_END_NANO),
          statusCode: status ? Number(getVarint(status, STATUS_CODE) ?? 0n) : undefined,
          statusMessage: status ? getString(status, STATUS_MESSAGE) : undefined,
          attributes: {
            ...resourceAttrs,
            ...decodeAttributes(getRepeatedBytes(span, SPAN_ATTRIBUTES)),
          },
        }

        const mapped = mapOtlpSpan(input)
        if (mapped) spans.push(mapped)
        else rejected += 1
      }
    }
  }

  return { spans, rejected }
}

// ── JSON ─────────────────────────────────────────────────────────────────────

/** In OTLP/JSON, trace and span ids are hex strings, not base64. */
function normaliseId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.toLowerCase() : undefined
}

function parseNano(value: unknown): bigint | undefined {
  // uint64 is a string in protobuf JSON, but exporters also emit plain numbers.
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  return undefined
}

export function decodeTracesJson(body: unknown): DecodedTraces {
  const spans: MappedSpan[] = []
  let rejected = 0

  const root = body as { resourceSpans?: unknown[]; resource_spans?: unknown[] } | null
  const resourceSpans = root?.resourceSpans ?? root?.resource_spans
  if (!Array.isArray(resourceSpans)) return { spans, rejected }

  for (const rsRaw of resourceSpans) {
    const rs = rsRaw as Record<string, unknown>
    const resource = rs.resource as { attributes?: unknown } | undefined
    const resourceAttrs: Record<string, AttributeValue> = flattenJsonAttributes(
      resource?.attributes,
    )

    const scopeSpans = (rs.scopeSpans ?? rs.scope_spans) as unknown[] | undefined
    if (!Array.isArray(scopeSpans)) continue

    for (const ssRaw of scopeSpans) {
      const ss = ssRaw as Record<string, unknown>
      const rawSpans = ss.spans
      if (!Array.isArray(rawSpans)) continue

      for (const spanRaw of rawSpans) {
        const s = spanRaw as Record<string, unknown>
        const status = (s.status ?? {}) as Record<string, unknown>

        const input: OtlpSpanInput = {
          traceId: normaliseId(s.traceId ?? s.trace_id),
          spanId: normaliseId(s.spanId ?? s.span_id),
          parentSpanId: normaliseId(s.parentSpanId ?? s.parent_span_id),
          name: typeof s.name === 'string' ? s.name : undefined,
          startTimeUnixNano: parseNano(s.startTimeUnixNano ?? s.start_time_unix_nano),
          endTimeUnixNano: parseNano(s.endTimeUnixNano ?? s.end_time_unix_nano),
          statusCode: typeof status.code === 'number' ? status.code : undefined,
          statusMessage: typeof status.message === 'string' ? status.message : undefined,
          attributes: { ...resourceAttrs, ...flattenJsonAttributes(s.attributes) },
        }

        const mapped = mapOtlpSpan(input)
        if (mapped) spans.push(mapped)
        else rejected += 1
      }
    }
  }

  return { spans, rejected }
}

// ── Expansion into PAO ingest payloads ───────────────────────────────────────

export type PaoPayload = Record<string, unknown> & { type: 'run_start' | 'span' | 'run_end' }

/**
 * Expand mapped spans into PAO payloads.
 *
 * A root span yields run_start + run_end so the run has a task name and a
 * terminal status. Non-root spans map 1:1. Ordering matters: run_start for a
 * trace is emitted before any of its spans so the worker never has to
 * back-fill a run.
 */
export function toPaoPayloads(spans: MappedSpan[]): PaoPayload[] {
  const roots = new Map<string, MappedSpan>()
  for (const span of spans) {
    // Keep the earliest root per trace if an exporter sends more than one.
    if (span.isRoot && !roots.has(span.runId)) roots.set(span.runId, span)
  }

  const starts: PaoPayload[] = []
  const middles: PaoPayload[] = []
  const ends: PaoPayload[] = []

  // Traces arriving without a root span still need a run opened, but only when
  // no span in the batch has a parent — a batch of child spans (which is what
  // SimpleSpanProcessor and any partial flush produce) means the real root is
  // in another request, and inventing a run from a child would name the run
  // after that child. The worker's run_start upsert keeps whichever arrives
  // first, so a wrong placeholder would be permanent.
  const tracesNeedingRun = new Set<string>()
  for (const span of spans) {
    if (!roots.has(span.runId) && !span.parentSpanId) tracesNeedingRun.add(span.runId)
  }

  for (const [runId, root] of roots) {
    starts.push({
      type: 'run_start',
      runId,
      task: root.name,
      agentName: root.agentName,
      startedAt: root.startedAt,
      metadata: root.metadata,
    })

    ends.push({
      type: 'run_end',
      runId,
      startedAt: root.startedAt,
      endedAt: root.endedAt ?? new Date().toISOString(),
      status: root.status === 'error' ? 'failed' : 'completed',
      errorMessage: root.errorMessage,
    })
  }

  const openedWithoutRoot = new Map<string, MappedSpan>()
  for (const span of spans) {
    if (tracesNeedingRun.has(span.runId) && !openedWithoutRoot.has(span.runId)) {
      openedWithoutRoot.set(span.runId, span)
      starts.push({
        type: 'run_start',
        runId: span.runId,
        task: span.agentName ?? span.name,
        startedAt: span.startedAt,
      })
    }
  }

  for (const span of spans) {
    // The root span becomes the run itself; emitting it again as a child span
    // would double-count its tokens in the run rollup.
    if (roots.get(span.runId) === span) continue

    middles.push({
      type: 'span',
      runId: span.runId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      spanType: span.spanType,
      name: span.name,
      model: span.model,
      agentName: span.agentName,
      startedAt: span.startedAt,
      endedAt: span.endedAt,
      inputTokens: span.inputTokens,
      outputTokens: span.outputTokens,
      costUsd: span.costUsd,
      inputPreview: span.inputPreview,
      outputPreview: span.outputPreview,
      status: span.status,
      errorMessage: span.errorMessage,
      metadata: span.metadata,
    })
  }

  return [...starts, ...middles, ...ends]
}
