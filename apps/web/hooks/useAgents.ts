'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { AgentSpanRow } from '@/components/agents/SpanTable'

const MAX_RUN_BUFFER = 100

export interface AgentRunSummary {
  id: string
  task: string
  status: string
  startedAt: string
  endedAt: string | null
  totalTokens: number | null
  totalCostUsd: number | null
  spanCount: number
}

export interface AgentRunsResponse {
  runs: AgentRunSummary[]
  total: number
  page: number
  hasMore: boolean
}

export interface AgentRunDetail {
  id: string
  task: string
  status: string
  startedAt: string
  endedAt: string | null
  totalTokens: number | null
  totalCostUsd: number | null
  metadata: unknown
}

export interface AgentRunDetailResponse {
  run: AgentRunDetail
  spans: AgentSpanRow[]
}

export interface AgentRunsFilters {
  status?: string
  page?: number
}

interface RunsResult {
  data: AgentRunsResponse | null
  isLoading: boolean
  error: string | null
}

interface RunDetailResult {
  data: AgentRunDetailResponse | null
  isLoading: boolean
  error: string | null
}

export function useAgentRuns(projectId: string, filters: AgentRunsFilters = {}): RunsResult {
  const { status = 'all' } = filters
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return

    setIsLoading(true)
    setError(null)
    setRuns([])

    const es = new EventSource(`/api/projects/${projectId}/agents/stream`)

    // If the stream opens with no runs to send, no message ever arrives to
    // clear the loading state — fall back to "loaded" shortly after open.
    let openTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => setIsLoading(false), 300)

    es.onopen = () => setError(null)

    es.onmessage = (event: MessageEvent<string>) => {
      if (openTimeout) {
        clearTimeout(openTimeout)
        openTimeout = null
      }
      const incoming = JSON.parse(event.data) as AgentRunSummary
      setIsLoading(false)
      setRuns((prev) => {
        const exists = prev.some((r) => r.id === incoming.id)
        if (exists) return prev.map((r) => (r.id === incoming.id ? incoming : r))
        return [incoming, ...prev].slice(0, MAX_RUN_BUFFER)
      })
    }

    es.onerror = () => {
      if (openTimeout) {
        clearTimeout(openTimeout)
        openTimeout = null
      }
      setIsLoading(false)
      setError('Connection lost — reconnecting…')
    }

    return () => {
      if (openTimeout) clearTimeout(openTimeout)
      es.close()
    }
  }, [projectId])

  const filtered = status === 'all' ? runs : runs.filter((r) => r.status === status)

  return {
    data: { runs: filtered, total: filtered.length, page: 1, hasMore: false },
    isLoading,
    error,
  }
}

export function useAgentRun(projectId: string, runId: string): RunDetailResult {
  const query = useQuery({
    queryKey: ['agents', 'run', projectId, runId],
    queryFn: () => apiFetch<AgentRunDetailResponse>(`/api/agents/runs/${runId}`),
    enabled: Boolean(runId),
    staleTime: 15_000,
  })

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}
