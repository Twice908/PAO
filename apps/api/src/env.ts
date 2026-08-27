import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Default to 8080 — the port Railway routes its public domain to when no PORT
  // is set. Local dev overrides this via the root .env (PORT=3001).
  PORT: z.string().default('8080'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().min(1),
})

export const env = envSchema.parse(process.env)
