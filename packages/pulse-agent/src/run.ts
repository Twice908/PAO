import { AgentSpan } from './span'
import type { AgentSpanPayload, AnyZodSchema, CompleteRunOpts, SpanType, StartSpanOpts, TrackedTool, TrackedToolOptions, WithAgentMessageSpanOptions, WithCodeSpanOptions, WithDbSpanOptions, WithEmbeddingSpanOptions, WithFileSpanOptions, WithHttpSpanOptions, WithHumanApprovalSpanOptions, WithLLMSpanOptions, WithMemorySpanOptions, WithSearchSpanOptions, WithSubAgentSpanOptions } from './types'

const AUTO_FLUSH_MS = 30_000

export class AgentRun {
  readonly id: string
  private readonly runId: string
  private readonly startedAt: Date
  private readonly flushFn: (payloads: AgentSpanPayload[]) => void
  private readonly disabled: boolean
  private buffer: AgentSpanPayload[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private completed = false

  constructor(
    runId: string,
    startedAt: Date,
    flushFn: (payloads: AgentSpanPayload[]) => void,
    disabled = false,
  ) {
    this.id = runId
    this.runId = runId
    this.startedAt = startedAt
    this.flushFn = flushFn
    this.disabled = disabled

    if (!disabled) {
      this.flushTimer = setTimeout(() => {
        if (!this.completed) {
          // Auto-flush buffered spans WITHOUT finalizing the run.
          // Emitting run_end here would close the run server-side and
          // cause spans that end after the timer to be dropped.
          this._doFlush(false)
        }
      }, AUTO_FLUSH_MS)
    }
  }

  startSpan(spanType: SpanType, opts: StartSpanOpts): AgentSpan {
    if (this.disabled) return AgentSpan.noop()

    const spanId = crypto.randomUUID()
    const startedAt = new Date()
    return new AgentSpan(spanId, this.runId, startedAt, spanType, opts, (payload) => {
      this.buffer.push(payload)
    })
  }

  async complete(opts: CompleteRunOpts = {}): Promise<void> {
    if (this.disabled || this.completed) return
    this.completed = true

    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    this._doFlush(true, opts)
  }

  private _doFlush(isFinal: boolean, opts: CompleteRunOpts = {}): void {
    const payloads: AgentSpanPayload[] = [...this.buffer]

    if (isFinal) {
      // Final flush: clear the buffer and append run_end.
      // complete() re-sends ALL buffered spans (including any the timer
      // already sent) so the worker can deduplicate by spanId.
      this.buffer = []
      payloads.push({
        type: 'run_end',
        runId: this.runId,
        startedAt: this.startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: opts.status,
        errorMessage: opts.errorMessage,
        metadata: opts.metadata,
      })
    }
    // Timer flush (isFinal=false): do NOT clear this.buffer.
    // Spans added after the timer still accumulate and will be
    // included in the final flush when complete() is called.

    if (payloads.length === 0) return

    this.flushFn(payloads)
  }

  async withLLMSpan<T>(options: WithLLMSpanOptions<T>): Promise<T> {
    const { name, model, agentName, inputPreview, execute, getOutputPreview, getTokens } = options

    const span = this.startSpan('llm_call', { name, model, agentName, inputPreview })

    try {
      const result = await execute()
      const tokens = getTokens?.(result)
      span.end({
        status: 'success',
        outputPreview: getOutputPreview?.(result),
        inputTokens: tokens?.input,
        outputTokens: tokens?.output,
      })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withMemorySpan<T>(options: WithMemorySpanOptions<T>): Promise<T> {
    const { name, memoryType, inputPreview, execute, getOutputPreview } = options

    const span = this.startSpan('memory_read', {
      name,
      inputPreview,
      metadata: memoryType ? { memoryType } : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withAgentMessageSpan<T>(options: WithAgentMessageSpanOptions<T>): Promise<T> {
    const { name, fromAgent, toAgent, inputPreview, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (fromAgent) metadata['fromAgent'] = fromAgent
    if (toAgent) metadata['toAgent'] = toAgent

    const span = this.startSpan('agent_message', {
      name,
      inputPreview,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withHttpSpan<T>(options: WithHttpSpanOptions<T>): Promise<T> {
    const { name, url, method, inputPreview, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (url) metadata['url'] = url.slice(0, 200)
    if (method) metadata['method'] = method

    const span = this.startSpan('tool_call', {
      name,
      inputPreview,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withDbSpan<T>(options: WithDbSpanOptions<T>): Promise<T> {
    const { name, operation, table, inputPreview, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (operation) metadata['operation'] = operation
    if (table) metadata['table'] = table

    const span = this.startSpan('tool_call', {
      name,
      inputPreview,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withFileSpan<T>(options: WithFileSpanOptions<T>): Promise<T> {
    const { name, filePath, operation, inputPreview, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (filePath) metadata['filePath'] = filePath.slice(0, 200)
    if (operation) metadata['operation'] = operation

    const span = this.startSpan('tool_call', {
      name,
      inputPreview,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withEmbeddingSpan<T>(options: WithEmbeddingSpanOptions<T>): Promise<T> {
    const { name, model, inputPreview, dimensions, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (model) metadata['model'] = model
    if (dimensions !== undefined) metadata['dimensions'] = dimensions

    const span = this.startSpan('tool_call', {
      name,
      inputPreview,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withSearchSpan<T>(options: WithSearchSpanOptions<T>): Promise<T> {
    const { name, index, query, topK, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (index) metadata['index'] = index
    if (query) metadata['query'] = query.slice(0, 200)
    if (topK !== undefined) metadata['topK'] = topK

    const span = this.startSpan('tool_call', {
      name,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withCodeSpan<T>(options: WithCodeSpanOptions<T>): Promise<T> {
    const { name, language, inputPreview, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (language) metadata['language'] = language

    const span = this.startSpan('tool_call', {
      name,
      inputPreview: inputPreview?.slice(0, 200),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withHumanApprovalSpan<T>(options: WithHumanApprovalSpanOptions<T>): Promise<T> {
    const { name, prompt, timeoutMs, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (prompt) metadata['prompt'] = prompt.slice(0, 200)
    if (timeoutMs !== undefined) metadata['timeoutMs'] = timeoutMs

    const span = this.startSpan('tool_call', {
      name,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  async withSubAgentSpan<T>(options: WithSubAgentSpanOptions<T>): Promise<T> {
    const { name, subAgentName, inputPreview, execute, getOutputPreview } = options

    const metadata: Record<string, unknown> = {}
    if (subAgentName) metadata['subAgentName'] = subAgentName

    const span = this.startSpan('tool_call', {
      name,
      inputPreview: inputPreview?.slice(0, 200),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })

    try {
      const result = await execute()
      span.end({ status: 'success', outputPreview: getOutputPreview?.(result) })
      return result
    } catch (err) {
      span.end({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  createTrackedTool<T extends AnyZodSchema>(options: TrackedToolOptions<T>): TrackedTool<T> {
    const { id, spanName, description, inputSchema, execute } = options

    const wrappedExecute = async (input: T['_output']): Promise<unknown> => {
      const span = this.startSpan('tool_call', {
        name: spanName,
        inputPreview: this.generatePreview(input),
      })

      try {
        const result = await execute(input)
        span.end({
          status: 'success',
          outputPreview: this.generatePreview(result),
        })
        return result
      } catch (err) {
        span.end({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }

    return { id, description, inputSchema, execute: wrappedExecute }
  }

  private generatePreview(data: unknown): string {
    if (data === null || data === undefined) return ''
    if (typeof data === 'string') return data.slice(0, 100)
    if (typeof data === 'number' || typeof data === 'boolean') return String(data)
    try {
      return JSON.stringify(data).slice(0, 100)
    } catch {
      return String(data).slice(0, 100)
    }
  }

  static noop(): AgentRun {
    return new AgentRun('', new Date(), () => {}, true)
  }
}
