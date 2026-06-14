'use client'

import { useState } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import RunStatusBadge from '@/components/agents/RunStatusBadge'
import CreateProjectModal from '@/components/CreateProjectModal'
import { useAgentRuns } from '@/hooks/useAgents'
import { useProjects, PROJECTS_KEY } from '@/hooks/useProjects'
import { relativeTime } from '@/lib/utils'

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return '—'
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`
}

function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return `$${usd.toFixed(6)}`
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

const STATUS_FILTERS = ['all', 'running', 'completed', 'failed', 'interrupted'] as const

export default function AgentsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()

  const { data: projects, isLoading: projectsLoading } = useProjects()
  const [showCreateModal, setShowCreateModal] = useState(false)

  const projectId = searchParams.get('project') ?? projects[0]?.id ?? ''
  const statusFilter = searchParams.get('status') ?? 'all'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))

  // Background polling (5s) is preserved via the hook's refetchInterval.
  const { data, isLoading, error } = useAgentRuns(projectId, { status: statusFilter, page })

  function setStatusFilter(s: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (s && s !== 'all') {
      p.set('status', s)
    } else {
      p.delete('status')
    }
    p.delete('page')
    router.replace(`${pathname}?${p.toString()}`)
  }

  function setPage(p: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (p <= 1) {
      params.delete('page')
    } else {
      params.set('page', String(p))
    }
    router.replace(`${pathname}?${params.toString()}`)
  }

  function handleProjectCreated(newProjectId: string) {
    queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
    const p = new URLSearchParams(searchParams.toString())
    p.set('project', newProjectId)
    p.delete('page')
    router.replace(`${pathname}?${p.toString()}`)
  }

  function goToRun(runId: string) {
    const p = new URLSearchParams()
    if (projectId) p.set('project', projectId)
    router.push(`/dashboard/agents/${runId}?${p.toString()}`)
  }

  if (!projectsLoading && projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-gray-400 dark:text-slate-500">No projects yet</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-indigo-500 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create a new project
          </button>
        </div>
        {showCreateModal && (
          <CreateProjectModal
            onClose={() => setShowCreateModal(false)}
            onCreated={handleProjectCreated}
          />
        )}
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Agent Runs</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            All agent executions tracked for this project
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New project
        </button>
      </div>

      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleProjectCreated}
        />
      )}

      {/* Status filter bar */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={[
                'px-3 py-1.5 text-xs font-medium capitalize transition-colors border-r border-gray-200 dark:border-slate-700 last:border-r-0',
                statusFilter === s
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800',
              ].join(' ')}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-xs text-gray-400 dark:text-slate-500">
            {data.total.toLocaleString()} run{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 dark:border-slate-700 last:border-b-0"
            >
              <div className="h-4 w-48 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-slate-700" />
              <div className="ml-auto flex gap-6">
                <div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
                <div className="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
              </div>
            </div>
          ))}
        </div>
      ) : !data || data.runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-900/30">
            <svg
              className="h-6 w-6 text-indigo-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-slate-100">No agent runs yet</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            No agent runs yet — integrate the SDK to get started
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Task
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Started
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Duration
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Spans
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Tokens
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => goToRun(run.id)}
                      className="border-b border-gray-100 dark:border-slate-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer transition-colors duration-150"
                    >
                      <td className="px-6 py-4 text-gray-900 dark:text-slate-100 max-w-[300px] truncate">
                        {run.task}
                      </td>
                      <td className="px-4 py-4">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-4 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                        {relativeTime(run.startedAt)}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-xs text-gray-700 dark:text-slate-300">
                        {formatDuration(run.startedAt, run.endedAt)}
                      </td>
                      <td className="px-4 py-4 text-right text-gray-700 dark:text-slate-300">
                        {run.spanCount}
                      </td>
                      <td className="px-4 py-4 text-right text-gray-700 dark:text-slate-300">
                        {run.totalTokens?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-xs text-gray-700 dark:text-slate-300">
                        {formatCost(run.totalCostUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(data.total > 20 || page > 1) && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 dark:border-slate-700 text-sm text-gray-500 dark:text-slate-400">
                <span>
                  Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} of{' '}
                  {data.total.toLocaleString()}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="rounded border border-gray-200 dark:border-slate-600 px-3 py-1 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={!data.hasMore}
                    className="rounded border border-gray-200 dark:border-slate-600 px-3 py-1 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
