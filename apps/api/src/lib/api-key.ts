import { createHash, randomBytes } from 'node:crypto'

const API_KEY_PREFIX = 'pk_live_'
const API_KEY_RANDOM_BYTES = 32

export function generateApiKey(): string {
  const randomHex = randomBytes(API_KEY_RANDOM_BYTES).toString('hex')
  return `${API_KEY_PREFIX}${randomHex}`
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

export function getApiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 8)
}
