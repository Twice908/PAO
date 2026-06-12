import type { FastifyInstance, FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { redis } from '../lib/redis'

const RATE_LIMIT_MAX = 100
const RATE_LIMIT_WINDOW_MS = 10_000
const API_KEY_FINGERPRINT_LENGTH = 16

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW_MS,
    redis,
    keyGenerator: (request: FastifyRequest): string => {
      const authHeader = request.headers['authorization']
      if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const fingerprint = authHeader.slice(7, 7 + API_KEY_FINGERPRINT_LENGTH)
        return `rl:key:${fingerprint}`
      }
      return `rl:ip:${request.ip}`
    },
  })
}
