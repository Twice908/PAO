import type { FastifyReply } from 'fastify'
import { verifyToken } from '@clerk/backend'
import { env } from '../env'

export async function verifyClerkJwt(
  authHeader: string | undefined,
  reply: FastifyReply,
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authorization header required' },
    })
    return null
  }
  const token = authHeader.slice('Bearer '.length)
  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY })
    return payload.sub
  } catch {
    await reply.status(401).send({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired session token' },
    })
    return null
  }
}
