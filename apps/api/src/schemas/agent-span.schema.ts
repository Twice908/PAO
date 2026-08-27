import { z } from 'zod'

const SpanTypeSchema = z.enum(['llm_call', 'tool_call', 'memory_read', 'agent_message', 'error'])

const SpanStatusSchema = z.enum(['success', 'error', 'timeout'])
const RunStatusSchema = z.enum(['completed', 'failed', 'interrupted'])

/**
 * Fields shared by every payload variant.
 *
 * `startedAt` accepts any parseable ISO-8601 datetime rather than Zod's strict
 * `.datetime()`, which rejects offset forms like `2026-01-01T00:00:00+05:30`.
 * No-code callers (n8n `{{ $now.toISO() }}`, Make `now`) emit offsets by
 * default, so strictness here would reject the majority of no-code traffic.
 */
const BaseFields = {
  runId: z.string().min(1),
  startedAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'startedAt must be a parseable ISO-8601 datetime',
  }),
  endedAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), {
      message: 'endedAt must be a parseable ISO-8601 datetime',
    })
    .optional(),
  agentName: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
}

const RunStartSchema = z.object({
  ...BaseFields,
  type: z.literal('run_start'),
  task: z.string().optional(),
})

/**
 * `spanType` and `name` are REQUIRED here because both columns are non-nullable
 * in the database (see packages/db/prisma/schema.prisma, model AgentSpan).
 * Leaving them optional let a malformed span pass validation, return 202, and
 * then fail permanently in the worker — a silent drop behind a success code.
 */
const SpanSchema = z.object({
  ...BaseFields,
  type: z.literal('span'),
  spanId: z.string().min(1).optional(),
  parentSpanId: z.string().min(1).optional(),
  spanType: SpanTypeSchema,
  name: z.string().min(1),
  model: z.string().optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  costUsd: z.number().min(0).optional(),
  inputPreview: z.string().max(500).optional(),
  outputPreview: z.string().max(500).optional(),
  status: SpanStatusSchema.optional(),
  errorMessage: z.string().optional(),
})

/**
 * Run-level status only. A span-level value such as `success` would previously
 * be written verbatim into AgentRun.status, producing runs whose status no
 * dashboard filter matches.
 */
const RunEndSchema = z.object({
  ...BaseFields,
  type: z.literal('run_end'),
  task: z.string().optional(),
  status: RunStatusSchema.optional(),
  errorMessage: z.string().optional(),
})

export const AgentSpanPayloadSchema = z.discriminatedUnion('type', [
  RunStartSchema,
  SpanSchema,
  RunEndSchema,
])

export type AgentSpanPayload = z.infer<typeof AgentSpanPayloadSchema>

export const AgentSpanBatchSchema = z.array(AgentSpanPayloadSchema).min(1)
export type AgentSpanBatch = z.infer<typeof AgentSpanBatchSchema>
