import type { AgentSpanPayload, EndSpanOpts, SpanType, StartSpanOpts } from './types'

const MAX_PREVIEW_LENGTH = 500

export class AgentSpan {
  private readonly spanId: string
  private readonly runId: string
  private readonly startedAt: Date
  private readonly spanType: SpanType
  private readonly opts: StartSpanOpts
  private readonly pushToBuffer: (payload: AgentSpanPayload) => void
  private readonly disabled: boolean
  private ended = false

  constructor(
    spanId: string,
    runId: string,
    startedAt: Date,
    spanType: SpanType,
    opts: StartSpanOpts,
    pushToBuffer: (payload: AgentSpanPayload) => void,
    disabled = false,
  ) {
    this.spanId = spanId
    this.runId = runId
    this.startedAt = startedAt
    this.spanType = spanType
    this.opts = opts
    this.pushToBuffer = pushToBuffer
    this.disabled = disabled
  }

  end(opts: EndSpanOpts = {}): void {
    if (this.disabled || this.ended) return
    this.ended = true

    const endedAt = new Date()

    const payload: AgentSpanPayload = {
      type: 'span',
      runId: this.runId,
      spanId: this.spanId,
      parentSpanId: this.opts.parentSpanId,
      spanType: this.spanType,
      name: this.opts.name,
      model: this.opts.model,
      agentName: this.opts.agentName,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd: opts.costUsd,
      inputPreview: this.opts.inputPreview?.slice(0, MAX_PREVIEW_LENGTH),
      outputPreview: opts.outputPreview?.slice(0, MAX_PREVIEW_LENGTH),
      status: opts.status,
      errorMessage: opts.errorMessage,
      metadata: opts.metadata ?? this.opts.metadata,
    }

    this.pushToBuffer(payload)
  }

  static noop(): AgentSpan {
    return new AgentSpan('', '', new Date(), 'llm_call', { name: '' }, () => {}, true)
  }
}
