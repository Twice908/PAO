import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string(),
  CLERK_SECRET_KEY: z.string().min(1),
})

export const env = envSchema.parse(process.env)
