import './env-loader'
import Fastify from 'fastify'
import { env } from './env'
import { registerCors } from './plugins/cors'
import { registerHelmet } from './plugins/helmet'
import { registerRateLimit } from './plugins/rate-limit'
import { healthRoutes } from './routes/health'
import { agentSpanRoutes } from './routes/ingest/agent-span'
import { agentsStreamRoutes } from './routes/agents-stream'
import { otlpTraceRoutes } from './routes/ingest/otlp-traces'

async function bootstrap(): Promise<void> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  })

  await registerCors(app)
  await registerHelmet(app)
  await registerRateLimit(app)

  await app.register(healthRoutes)
  await app.register(agentSpanRoutes)
  await app.register(agentsStreamRoutes)
  await app.register(otlpTraceRoutes)

  const address = await app.listen({ port: parseInt(env.PORT), host: '0.0.0.0' })
  app.log.info(`PAO API server listening at ${address}`)
}

bootstrap().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
