import { z } from 'zod'

const SpanTypeSchema = z.enum(['llm_call', 'tool_call', 'memory_read', 'agent_message', 'error'])

export const AgentSpanPayloadSchema = z.object({
  type: z.enum(['span', 'run_start', 'run_end']),
  runId: z.string().min(1),
  spanId: z.string().min(1).optional(),
  parentSpanId: z.string().min(1).optional(),
  task: z.string().optional(),
  agentName: z.string().optional(),
  spanType: SpanTypeSchema.optional(),
  name: z.string().optional(),
  model: z.string().optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  costUsd: z.number().min(0).optional(),
  inputPreview: z.string().max(500).optional(),
  outputPreview: z.string().max(500).optional(),
  // span-level: 'success' | 'error' | 'timeout' (→ AgentSpan.statusCode)
  // run-level:  'completed' | 'failed' | 'interrupted' (→ AgentRun.status, run_end only)
  status: z.enum(['success', 'error', 'timeout', 'completed', 'failed', 'interrupted']).optional(),
  errorMessage: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export type AgentSpanPayload = z.infer<typeof AgentSpanPayloadSchema>

export const AgentSpanBatchSchema = z.array(AgentSpanPayloadSchema).min(1)
export type AgentSpanBatch = z.infer<typeof AgentSpanBatchSchema>
