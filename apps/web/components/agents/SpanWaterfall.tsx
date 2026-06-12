'use client'

import { useState, useEffect } from 'react'
import type { AgentSpanRow } from '@/components/agents/SpanDetailPanel'
import SpanDetailPanel from '@/components/agents/SpanDetailPanel'

const GANTT_COLORS: Record<string, string> = {
  llm_call: '#3b82f6',
  tool_call: '#f97316',
  memory_read: '#a855f7',
  agent_message: '#22c55e',
}

const GANTT_LABELS: Record<string, string> = {
  llm_call: 'LLM Call',
  tool_call: 'Tool Call',
  memory_read: 'Memory',
  agent_message: 'Agent Msg',
}

function spanBarColor(span: AgentSpanRow): string {
  if (span.statusCode === 'error') return '#ef4444'
  return GANTT_COLORS[span.spanType] ?? '#6b7280'
}

function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`
}

interface SpanWaterfallProps {
  spans: AgentSpanRow[]
  runStartedAt: string
  runEndedAt: string | null
}

export default function SpanWaterfall({ spans, runStartedAt, runEndedAt }: SpanWaterfallProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [hovered, setHovered] = useState<{
    idx: number
    span: AgentSpanRow
    barTop: number
    barLeft: number
    barHeight: number
  } | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedIndex(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (spans.length === 0) return null

  const runStart = new Date(runStartedAt).getTime()

  let totalDurationMs: number
  if (runEndedAt) {
    totalDurationMs = Math.max(1, new Date(runEndedAt).getTime() - runStart)
  } else {
    totalDurationMs = spans.reduce((max, s) => {
      const offset = Math.max(0, new Date(s.startedAt).getTime() - runStart)
      return Math.max(max, offset + (s.durationMs ?? 0))
    }, 1)
  }

  const sorted = [...spans].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  )

  const selectedSpan = selectedIndex !== null ? (sorted[selectedIndex] ?? null) : null
  const prevSpan =
    selectedIndex !== null && selectedIndex > 0 ? (sorted[selectedIndex - 1] ?? null) : null
  const nextSpan =
    selectedIndex !== null && selectedIndex < sorted.length - 1
      ? (sorted[selectedIndex + 1] ?? null)
      : null

  const RULER_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-x-4 gap-y-2 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Timeline
            <span className="ml-2 text-gray-400 font-normal text-xs dark:text-slate-500">
              {sorted.length} span{sorted.length !== 1 ? 's' : ''}
            </span>
          </h2>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-slate-400">
            {Object.entries(GANTT_LABELS).map(([type, label]) => (
              <span key={type} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-3 rounded-sm"
                  style={{ background: GANTT_COLORS[type] }}
                />
                {label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#ef4444' }} />
              Error
            </span>
          </div>
        </div>

        <div className="p-4 overflow-x-auto min-w-0">
          {/* Ruler row */}
          <div className="flex items-end mb-1">
            <div className="w-36 sm:w-44 flex-shrink-0" />
            <div className="relative flex-1 h-5">
              {RULER_FRACTIONS.map((f) => (
                <span
                  key={f}
                  className="absolute text-[10px] text-gray-400 font-mono -translate-x-1/2 select-none dark:text-slate-500"
                  style={{ left: `${f * 100}%` }}
                >
                  {formatMs(Math.round(f * totalDurationMs))}
                </span>
              ))}
            </div>
          </div>

          {/* Span rows */}
          <div className="space-y-0.5">
            {sorted.map((span, idx) => {
              const offset = Math.max(0, new Date(span.startedAt).getTime() - runStart)
              const leftPct = Math.min(99, (offset / totalDurationMs) * 100)
              const rawWidth = ((span.durationMs ?? 1) / totalDurationMs) * 100
              const widthPct = Math.max(0.4, Math.min(100 - leftPct, rawWidth))
              const color = spanBarColor(span)
              const isSelected = selectedIndex === idx
              const isHovered = hovered?.idx === idx

              return (
                <div key={span.id} className="flex items-center min-h-[28px] group">
                  {/* Name label */}
                  <div className="w-36 sm:w-44 flex-shrink-0 pr-3">
                    <span
                      className="block text-[11px] text-gray-400 truncate text-right leading-tight group-hover:text-gray-700 transition-colors dark:text-slate-400 dark:group-hover:text-slate-200"
                      title={span.name}
                    >
                      {span.name}
                    </span>
                  </div>

                  {/* Track */}
                  <div
                    className="relative flex-1 h-6 bg-gray-100 rounded-sm dark:bg-slate-800/60"
                    onMouseLeave={() => setHovered(null)}
                  >
                    {/* Gridlines */}
                    {[0.25, 0.5, 0.75].map((f) => (
                      <div
                        key={f}
                        className="absolute inset-y-0 w-px bg-gray-300/50 pointer-events-none dark:bg-slate-700/50"
                        style={{ left: `${f * 100}%` }}
                      />
                    ))}

                    {/* Bar */}
                    <button
                      type="button"
                      className={`absolute inset-y-1 rounded-sm cursor-pointer transition-opacity focus:outline-none ${
                        isSelected
                          ? 'ring-2 ring-gray-800/50 ring-offset-1 ring-offset-white dark:ring-white/50 dark:ring-offset-slate-900'
                          : ''
                      }`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        minWidth: '3px',
                        background: color,
                        opacity: isHovered || isSelected ? 1 : 0.8,
                      }}
                      onClick={() => setSelectedIndex(isSelected ? null : idx)}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setHovered({ idx, span, barTop: rect.top, barLeft: rect.left, barHeight: rect.height })
                      }}
                      aria-label={`Select span: ${span.name}`}
                    />

                    {/* Duration inside bar */}
                    {span.durationMs !== null && widthPct > 10 && (
                      <span
                        className="absolute inset-y-0 flex items-center px-1.5 text-[10px] font-mono text-white/90 pointer-events-none overflow-hidden"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      >
                        {formatMs(span.durationMs)}
                      </span>
                    )}
                  </div>

                  {/* Duration outside bar */}
                  {span.durationMs !== null && widthPct <= 10 && (
                    <span className="ml-2 text-[10px] font-mono text-gray-400 flex-shrink-0 w-12 leading-tight dark:text-slate-500">
                      {formatMs(span.durationMs)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Fixed-position tooltip */}
      {hovered && (() => {
        const TOOLTIP_W = 208
        const GAP = 8
        const showBelow = hovered.barTop < 150
        const top = showBelow
          ? hovered.barTop + hovered.barHeight + GAP
          : hovered.barTop - GAP
        const left = Math.max(GAP, Math.min(hovered.barLeft, window.innerWidth - TOOLTIP_W - GAP))
        return (
          <div
            className="fixed z-50 w-52 rounded-lg bg-white border border-gray-200 shadow-2xl p-3 text-xs text-gray-700 pointer-events-none dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200"
            style={{ top, left, transform: showBelow ? 'none' : 'translateY(-100%)' }}
          >
            <p className="font-semibold text-gray-900 truncate mb-1.5 dark:text-slate-100">{hovered.span.name}</p>
            <div className="space-y-0.5 text-gray-500 dark:text-slate-400">
              <p>
                Type:{' '}
                <span className="text-gray-700 dark:text-slate-200">
                  {GANTT_LABELS[hovered.span.spanType] ?? hovered.span.spanType}
                </span>
              </p>
              {hovered.span.durationMs !== null && (
                <p>
                  Duration:{' '}
                  <span className="text-gray-700 dark:text-slate-200">{formatMs(hovered.span.durationMs)}</span>
                </p>
              )}
              {hovered.span.totalTokens !== null && (
                <p>
                  Tokens:{' '}
                  <span className="text-gray-700 dark:text-slate-200">
                    {hovered.span.totalTokens.toLocaleString()}
                  </span>
                </p>
              )}
              {hovered.span.statusCode && (
                <p>
                  Status:{' '}
                  <span
                    className={
                      hovered.span.statusCode === 'error'
                        ? 'text-red-500 dark:text-red-400'
                        : hovered.span.statusCode === 'success'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-700 dark:text-slate-200'
                    }
                  >
                    {hovered.span.statusCode}
                  </span>
                </p>
              )}
            </div>
          </div>
        )
      })()}

      <SpanDetailPanel
        span={selectedSpan}
        prevSpan={prevSpan}
        nextSpan={nextSpan}
        onClose={() => setSelectedIndex(null)}
        onPrev={() => setSelectedIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
        onNext={() =>
          setSelectedIndex((i) => (i !== null && i < sorted.length - 1 ? i + 1 : i))
        }
      />
    </>
  )
}
