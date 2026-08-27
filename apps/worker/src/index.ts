import './env-loader'
import { Worker, Queue } from 'bullmq'
import pino from 'pino'
import { env } from './env'
import { startAgentSpanWorker } from './processors/agent-span.processor'
import { processAgentAlertsCheck } from './processors/agent-alerts.processor'

const logger = pino({ name: 'worker', level: env.NODE_ENV === 'production' ? 'info' : 'debug' })

const redisUrl = new URL(env.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
}

const AGENT_ALERTS_JOB_NAME = 'agent-alerts-check'
const AGENT_ALERTS_REPEAT_MS = 5 * 60_000

// ── Agent-alerts repeatable worker ────────────────────────────────────────────
const agentAlertsQueue = new Queue('agent-alerts', { connection })

const agentAlertsWorker = new Worker(
  'agent-alerts',
  async () => {
    await processAgentAlertsCheck()
  },
  { connection, concurrency: 1 },
)

agentAlertsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Agent-alerts job failed')
})

async function registerAgentAlertsJob(): Promise<void> {
  const repeatableJobs = await agentAlertsQueue.getRepeatableJobs()
  for (const job of repeatableJobs) {
    if (job.name === AGENT_ALERTS_JOB_NAME) {
      await agentAlertsQueue.removeRepeatableByKey(job.key)
      logger.info({ key: job.key }, 'Removed stale agent-alerts repeatable job')
    }
  }

  await agentAlertsQueue.add(AGENT_ALERTS_JOB_NAME, {}, { repeat: { every: AGENT_ALERTS_REPEAT_MS } })
  logger.info({ repeatEveryMs: AGENT_ALERTS_REPEAT_MS }, 'Agent-alerts repeatable job registered')
}

registerAgentAlertsJob().catch((err: unknown) => {
  logger.error({ err }, 'Failed to register agent-alerts repeatable job')
})

// ── Agent-span worker ─────────────────────────────────────────────────────────
const agentSpanWorker = startAgentSpanWorker(connection)

logger.info('PAO worker started — agent-spans + agent-alerts queues active')

// ── Graceful shutdown ───────────────────────────────────────────────────────
// Railway sends SIGTERM on redeploy/stop. Close the workers and queue cleanly
// so in-flight jobs finish and the process exits 0 instead of npm reporting the
// start script as "failed with signal SIGTERM".
let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'Shutting down PAO worker')
  await Promise.allSettled([
    agentSpanWorker.close(),
    agentAlertsWorker.close(),
    agentAlertsQueue.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
