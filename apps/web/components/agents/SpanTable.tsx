'use client'

import { useState } from 'react'
import SpanTypeChip from '@/components/agents/SpanTypeChip'
import SpanDetailPanel, { type AgentSpanRow } from '@/components/agents/SpanDetailPanel'
import { relativeTime } from '@/lib/utils'

export type { AgentSpanRow }

interface SpanTableProps {
  spans: AgentSpanRow[]
}

type SortColumn = 'startedAt' | 'durationMs'
type SortDir = 'asc' | 'desc'

const STATUS_CHIP: Record<string, string> = {
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  timeout: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
}

function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd === 0) return '$0.00'
  if (usd < 0.001) return `$${usd.toFixed(6)}`
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function sortIndicator(col: SortColumn, sortCol: SortColumn, sortDir: SortDir): string {
  if (sortCol !== col) return '↕'
  return sortDir === 'asc' ? '↑' : '↓'
}

export default function SpanTable({ spans }: SpanTableProps) {
  const [sortCol, setSortCol] = useState<SortColumn>('startedAt')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  function toggleSort(col: SortColumn) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sorted = [...spans].sort((a, b) => {
    const aVal =
      sortCol === 'startedAt' ? new Date(a.startedAt).getTime() : (a.durationMs ?? 0)
    const bVal =
      sortCol === 'startedAt' ? new Date(b.startedAt).getTime() : (b.durationMs ?? 0)
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal
  })

  const selectedSpan = selectedIndex !== null ? (sorted[selectedIndex] ?? null) : null
  const prevSpan = selectedIndex !== null && selectedIndex > 0 ? (sorted[selectedIndex - 1] ?? null) : null
  const nextSpan = selectedIndex !== null && selectedIndex < sorted.length - 1 ? (sorted[selectedIndex + 1] ?? null) : null

  if (spans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-10 text-center">
        <p className="text-sm text-gray-500 dark:text-slate-400">No spans recorded for this run</p>
      </div>
    )
  }

  const thBase =
    'px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400'
  const thSortable = `${thBase} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-200`

  return (
    <>
      <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                <th className={`${thBase} text-left`}>Type</th>
                <th className={`${thBase} text-left`}>Name</th>
                <th
                  className={`${thSortable} text-left`}
                  onClick={() => toggleSort('startedAt')}
                >
                  Started at
                  <span
                    className={`ml-1 ${sortCol === 'startedAt' ? 'text-indigo-500' : 'text-gray-300 dark:text-slate-600'}`}
                  >
                    {sortIndicator('startedAt', sortCol, sortDir)}
                  </span>
                </th>
                <th
                  className={`${thSortable} text-right`}
                  onClick={() => toggleSort('durationMs')}
                >
                  Duration
                  <span
                    className={`ml-1 ${sortCol === 'durationMs' ? 'text-indigo-500' : 'text-gray-300 dark:text-slate-600'}`}
                  >
                    {sortIndicator('durationMs', sortCol, sortDir)}
                  </span>
                </th>
                <th className={`${thBase} text-right`}>Tokens</th>
                <th className={`${thBase} text-right`}>Cost</th>
                <th className={`${thBase} text-left`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((span, idx) => (
                <tr
                  key={span.id}
                  onClick={() => setSelectedIndex(idx)}
                  className="border-b border-gray-100 dark:border-slate-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer transition-colors duration-150"
                >
                  <td className="px-4 py-3">
                    <SpanTypeChip spanType={span.spanType} />
                  </td>
                  <td className="px-4 py-3 text-gray-900 dark:text-slate-100 max-w-[200px] truncate">
                    {span.name}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                    {relativeTime(span.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700 dark:text-slate-300">
                    {span.durationMs !== null ? `${span.durationMs.toLocaleString()}ms` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300">
                    {span.totalTokens?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-gray-700 dark:text-slate-300">
                    {formatCost(span.costUsd)}
                  </td>
                  <td className="px-4 py-3">
                    {span.statusCode ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP[span.statusCode] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}
                      >
                        {span.statusCode}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <SpanDetailPanel
        span={selectedSpan}
        prevSpan={prevSpan}
        nextSpan={nextSpan}
        onClose={() => setSelectedIndex(null)}
        onPrev={() => setSelectedIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
        onNext={() => setSelectedIndex((i) => (i !== null && i < sorted.length - 1 ? i + 1 : i))}
      />
    </>
  )
}
