'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { AlertRule, AlertHistoryEntry } from '@pulse/types'

const ALERTS_STALE_TIME_MS = 60 * 1000

interface AlertsResult {
  data: AlertRule[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

interface HistoryResult {
  data: AlertHistoryEntry[]
  total: number
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useAlerts(projectId: string): AlertsResult {
  const query = useQuery({
    queryKey: ['alerts', projectId],
    queryFn: () => apiFetch<{ data?: AlertRule[] }>(`/api/projects/${projectId}/alerts`),
    enabled: Boolean(projectId),
    staleTime: ALERTS_STALE_TIME_MS,
  })

  return {
    data: query.data?.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}

export function useAlertHistory(projectId: string, page: number): HistoryResult {
  const query = useQuery({
    queryKey: ['alerts', 'history', projectId, page],
    queryFn: () =>
      apiFetch<{ data?: AlertHistoryEntry[]; total?: number }>(
        `/api/projects/${projectId}/alerts/history?page=${page}&limit=20`,
      ),
    enabled: Boolean(projectId),
    staleTime: ALERTS_STALE_TIME_MS,
  })

  return {
    data: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}
