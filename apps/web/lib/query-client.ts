import { QueryClient } from '@tanstack/react-query'

// Cache tuning defaults — individual hooks override staleTime per-domain.
const DEFAULT_STALE_TIME_MS = 30 * 1000 // 30s — data considered fresh
const DEFAULT_GC_TIME_MS = 5 * 60 * 1000 // 5min — cache kept in memory
const DEFAULT_RETRY = 2

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: DEFAULT_GC_TIME_MS,
        retry: DEFAULT_RETRY,
        refetchOnWindowFocus: true,
      },
    },
  })
}
