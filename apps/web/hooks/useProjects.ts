'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ProjectSummary } from '@pulse/types'

// The project list is the only project read endpoint (there is no
// GET /api/projects/:id), so single-project lookups derive from this cache.
const PROJECTS_STALE_TIME_MS = 5 * 60 * 1000
const PROJECTS_QUERY_KEY = ['projects'] as const

interface ProjectsResult {
  data: ProjectSummary[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

interface ProjectResult {
  data: ProjectSummary | null
  isLoading: boolean
  error: string | null
}

export function useProjects(): ProjectsResult {
  const query = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => apiFetch<{ projects: ProjectSummary[] }>('/api/projects'),
    staleTime: PROJECTS_STALE_TIME_MS,
  })

  return {
    data: query.data?.projects ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  }
}

export function useProject(projectId: string): ProjectResult {
  const query = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: () => apiFetch<{ projects: ProjectSummary[] }>('/api/projects'),
    staleTime: PROJECTS_STALE_TIME_MS,
    select: (raw) => raw.projects.find((p) => p.id === projectId) ?? null,
  })

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}

export const PROJECTS_KEY = PROJECTS_QUERY_KEY
