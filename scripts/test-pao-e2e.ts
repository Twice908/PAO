/**
 * Manual end-to-end smoke test (task 7.1 in docs/pao-tasks.md).
 *
 * Sends a fake agent run (run_start -> span -> run_end) through @pulse/agent
 * to a running apps/api instance. Verify the run appears under
 * /dashboard/agents within a couple of seconds.
 *
 * Usage:
 *   PULSE_TEST_KEY=pk_live_... npm run test:e2e
 *   PULSE_TEST_KEY=pk_live_... PULSE_HOST=http://localhost:3001 npm run test:e2e
 */
import { PulseAgent } from '@pulse/agent'

const apiKey = process.env.PULSE_TEST_KEY
if (!apiKey) {
  console.error('Missing PULSE_TEST_KEY env var (a project API key from /dashboard/settings)')
  process.exit(1)
}

const pulse = new PulseAgent({
  apiKey,
  host: process.env.PULSE_HOST ?? 'http://localhost:3001',
})

const run = await pulse.startRun('E2E smoke test')
const span = run.startSpan('llm_call', { name: 'fake-gpt4', model: 'gpt-4o', inputPreview: 'Hello' })
await new Promise((r) => setTimeout(r, 100))
span.end({ outputPreview: 'World', inputTokens: 10, outputTokens: 5, status: 'success' })
await run.complete({ status: 'completed' })

console.log('Run ID:', run.id)
console.log('Check /dashboard/agents for this run within a couple of seconds.')
