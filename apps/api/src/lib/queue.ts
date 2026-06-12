import { Queue } from 'bullmq'
import { env } from '../env'

const redisUrl = new URL(env.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
}

const agentSpanJobOptions = {
  removeOnComplete: 1000,
  removeOnFail: 5000,
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
}

export const AGENT_SPANS_QUEUE_NAME = 'agent-spans'

export const agentSpansQueue = new Queue(AGENT_SPANS_QUEUE_NAME, {
  connection,
  defaultJobOptions: agentSpanJobOptions,
})
