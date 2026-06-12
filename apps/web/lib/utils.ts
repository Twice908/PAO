const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function relativeTime(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime()
  if (diff < MINUTE_MS) return 'just now'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`
  return `${Math.floor(diff / DAY_MS)}d ago`
}

export function formatResponseTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function statusCategory(code: number): '2xx' | '3xx' | '4xx' | '5xx' {
  if (code < 300) return '2xx'
  if (code < 400) return '3xx'
  if (code < 500) return '4xx'
  return '5xx'
}
