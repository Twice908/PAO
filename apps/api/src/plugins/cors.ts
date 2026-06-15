import type { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'

export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin:
      process.env['NODE_ENV'] === 'production'
        ? ['https://pao-web-beta.vercel.app']
        : true,
  })
}
