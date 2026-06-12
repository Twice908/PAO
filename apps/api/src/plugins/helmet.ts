import type { FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'

export async function registerHelmet(app: FastifyInstance): Promise<void> {
  await app.register(helmet)
}
