'use client'

import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ChevronLeft, GitBranch, LayoutGrid, Network } from 'lucide-react'
import RunStatusBadge from '@/components/agents/RunStatusBadge'
import SpanTable from '@/components/agents/SpanTable'
import SpanWaterfall from '@/components/agents/SpanWaterfall'
import SpanDependencyGraph from '@/components/agents/SpanDependencyGraph'
import SpanParallelSwarm from '@/components/agents/SpanParallelSwarm'
import { useAgentRun } from '@/hooks/useAgents'
import { relativeTime } from '@/lib/utils'

type SpanView = 'timeline' | 'graph' | 'swarm'

const SPAN_VIEWS: { id: SpanView; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'timeline', label: 'Timeline', icon: LayoutGrid },
  { id: 'graph', label: 'Graph', icon: GitBranch },
  { id: 'swarm', label: 'Parallel', icon: Network },
]

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

interface PageProps {
  params: { runId: string }
}

export default function RunDetailPage({ params }: PageProps) {
  const { runId } = params
  const searchParams = useSearchParams()
  const router = useRouter()
  const projectId = searchParams.get('project') ?? ''
  const [spanView, setSpanView] = useState<SpanView>('timeline')

  const { data, isLoading, error } = useAgentRun(projectId, runId)

  function goBack() {
    const p = new URLSearchParams()
    if (projectId) p.set('project', projectId)
    router.push(`/dashboard/agents?${p.toString()}`)
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-8 space-y-6">
        <div className="h-4 w-28 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
        <div className="h-36 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-7xl mx-auto p-8">
        <button
          onClick={goBack}
          className="flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 mb-6 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to runs
        </button>
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-10 text-center">
          <p className="text-base font-semibold text-red-700 dark:text-red-300">
            {error ?? 'Run not found'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const { run, spans } = data

  return (
    <div className="max-w-7xl mx-auto p-8 space-y-6">
      <button
        onClick={goBack}
        className="flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to runs
      </button>

      {/* Header card */}
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-1">
              Task
            </p>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-slate-100 break-words">
              {run.task}
            </h1>
          </div>
          <div className="flex-shrink-0">
            <RunStatusBadge status={run.status} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">
              Started
            </p>
            <p className="mt-1 text-sm text-gray-900 dark:text-slate-100">
              {relativeTime(run.startedAt)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">
              Duration
            </p>
            <p className="mt-1 text-sm font-mono text-gray-900 dark:text-slate-100">
              {formatDuration(run.startedAt, run.endedAt)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">
              Total tokens
            </p>
            <p className="mt-1 text-sm text-gray-900 dark:text-slate-100">
              {run.totalTokens?.toLocaleString() ?? '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-slate-500">
              Total cost
            </p>
            <p className="mt-1 text-sm font-mono text-gray-900 dark:text-slate-100">
              {formatCost(run.totalCostUsd)}
            </p>
          </div>
        </div>
      </div>

      {/* Span visualizations — switchable between timeline, dependency graph, and parallel view */}
      {spans.length > 0 && (
        <div className="space-y-3">
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-1">
            {SPAN_VIEWS.map(({ id, label, icon: Icon }) => {
              const active = spanView === id
              return (
                <button
                  key={id}
                  onClick={() => setSpanView(id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm'
                      : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                  }`}
                  aria-pressed={active}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              )
            })}
          </div>

          {spanView === 'timeline' && (
            <SpanWaterfall
              spans={spans}
              runStartedAt={run.startedAt}
              runEndedAt={run.endedAt}
            />
          )}
          {spanView === 'graph' && <SpanDependencyGraph spans={spans} />}
          {spanView === 'swarm' && (
            <SpanParallelSwarm
              spans={spans}
              runStartedAt={run.startedAt}
              runEndedAt={run.endedAt}
            />
          )}
        </div>
      )}

      {/* Spans section */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">
          Spans{' '}
          <span className="text-gray-400 dark:text-slate-500 font-normal text-sm">
            ({spans.length})
          </span>
        </h2>
        <SpanTable spans={spans} />
      </div>
    </div>
  )
}
