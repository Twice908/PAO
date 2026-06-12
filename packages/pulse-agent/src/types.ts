export type SpanType = 'llm_call' | 'tool_call' | 'memory_read' | 'agent_message' | 'error'

export type AgentSpanPayload = {
  type: 'span' | 'run_start' | 'run_end'
  runId: string
  spanId?: string
  parentSpanId?: string
  task?: string
  agentName?: string
  spanType?: SpanType
  name?: string
  model?: string
  startedAt: string
  endedAt?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  inputPreview?: string
  outputPreview?: string
  status?: 'success' | 'error' | 'timeout' | 'completed' | 'failed' | 'interrupted'
  errorMessage?: string
  metadata?: Record<string, unknown>
}

export type StartRunOpts = {
  metadata?: Record<string, unknown>
}

export type StartSpanOpts = {
  name: string
  model?: string
  agentName?: string
  inputPreview?: string
  parentSpanId?: string
  metadata?: Record<string, unknown>
}

export type EndSpanOpts = {
  outputPreview?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  status?: 'success' | 'error' | 'timeout'
  errorMessage?: string
  metadata?: Record<string, unknown>
}

export type CompleteRunOpts = {
  status?: 'completed' | 'failed' | 'interrupted'
  errorMessage?: string
  metadata?: Record<string, unknown>
}

// Minimal structural interface satisfied by any Zod schema without importing Zod.
// Mirrors how z.infer<T> resolves T['_output'] internally.
export type AnyZodSchema = { _output: unknown }

export type TrackedToolOptions<T extends AnyZodSchema> = {
  id: string
  spanName: string
  description: string
  inputSchema: T
  execute: (input: T['_output']) => Promise<unknown>
}

export type TrackedTool<T extends AnyZodSchema> = {
  id: string
  description: string
  inputSchema: T
  execute: (input: T['_output']) => Promise<unknown>
}

export type WithLLMSpanOptions<T> = {
  name: string
  model?: string
  agentName?: string
  inputPreview?: string
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
  getTokens?: (result: T) => { input: number; output: number }
}

export type WithMemorySpanOptions<T> = {
  name: string
  memoryType?: string
  inputPreview?: string
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithAgentMessageSpanOptions<T> = {
  name: string
  fromAgent?: string
  toAgent?: string
  inputPreview?: string
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithHttpSpanOptions<T> = {
  name: string
  url?: string
  method?: string
  inputPreview?: string
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithDbSpanOptions<T> = {
  name: string
  operation?: string
  table?: string
  inputPreview?: string
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithFileSpanOptions<T> = {
  name: string
  filePath?: string
  operation?: string
  inputPreview?: string
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithEmbeddingSpanOptions<T> = {
  name: string
  model?: string
  inputPreview?: string
  dimensions?: number
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithSearchSpanOptions<T> = {
  name: string
  index?: string
  query?: string
  topK?: number
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithCodeSpanOptions<T> = {
  name: string
  language?: string
  inputPreview?: string
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithHumanApprovalSpanOptions<T> = {
  name: string
  prompt?: string
  timeoutMs?: number
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}

export type WithSubAgentSpanOptions<T> = {
  name: string
  subAgentName?: string
  inputPreview?: string
  execute: () => Promise<T>
  getOutputPreview?: (result: T) => string
}
