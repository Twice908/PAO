import { AgentRun } from './run'
import type { AgentSpanPayload, StartRunOpts } from './types'

const DEFAULT_HOST = 'https://api.usepulse.dev'

export class PulseAgent {
  private readonly apiKey: string
  private readonly host: string
  private readonly disabled: boolean

  constructor(opts: { apiKey: string; host?: string }) {
    this.apiKey = opts.apiKey
    this.host = opts.host ?? DEFAULT_HOST
    this.disabled = process.env['PULSE_DISABLED'] === 'true'
  }

  async startRun(task: string, opts: StartRunOpts = {}): Promise<AgentRun> {
    if (this.disabled) return AgentRun.noop()

    const runId = crypto.randomUUID()
    const startedAt = new Date()

    const runStartPayload: AgentSpanPayload = {
      type: 'run_start',
      runId,
      task,
      startedAt: startedAt.toISOString(),
      metadata: opts.metadata,
    }

    this._flush([runStartPayload])

    return new AgentRun(runId, startedAt, (payloads) => this._flush(payloads))
  }

  _flush(payloads: AgentSpanPayload[]): void {
    fetch(`${this.host}/ingest/agent-span`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payloads),
    }).catch(() => {})
  }
}
