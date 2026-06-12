'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import SpanDetailPanel, { type AgentSpanRow } from '@/components/agents/SpanDetailPanel'
import GraphZoomControls from '@/components/agents/GraphZoomControls'
import {
  type SwarmItem,
  SPAN_COLORS,
  SPAN_LABELS,
  formatMs,
  layoutSwarm,
  spanColor,
  spanLabel,
  spansOverlap,
} from '@/lib/agents/spanLayout'
import { useZoomPan } from '@/lib/agents/zoomPan'

const LEGEND = [
  ['llm_call', SPAN_LABELS.llm_call],
  ['tool_call', SPAN_LABELS.tool_call],
  ['memory_read', SPAN_LABELS.memory_read],
  ['agent_message', SPAN_LABELS.agent_message],
  ['error', SPAN_LABELS.error],
] as const

const PLOT_LEFT = 24
const PLOT_RIGHT = 24
const CONTENT_WIDTH = 1120
const TOP = 34
const LANE_H = 48
const BAR_H = 24
const PLOT_WIDTH = CONTENT_WIDTH - PLOT_LEFT - PLOT_RIGHT
const RULER_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]
const DIM_OPACITY = 0.2
const TOOLTIP_DELAY_MS = 300

function truncate(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

interface TooltipState {
  x: number
  y: number
  title: string
  rows: { label: string; value: string; accent?: string }[]
}

interface SpanParallelSwarmProps {
  spans: AgentSpanRow[]
  runStartedAt: string
  runEndedAt: string | null
}

export default function SpanParallelSwarm({
  spans,
  runStartedAt,
  runEndedAt,
}: SpanParallelSwarmProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  const layout = useMemo(
    () => layoutSwarm(spans, runStartedAt, runEndedAt),
    [spans, runStartedAt, runEndedAt],
  )

  // focusedId = first-click (highlight, outline), panelId = second-click (opens panel)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const contentHeight = TOP + layout.laneCount * LANE_H + 12
  const zoom = useZoomPan({ width: CONTENT_WIDTH, height: contentHeight })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setFocusedId(null)
        setPanelId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (layout.items.length === 0) return null

  const items = layout.items
  const total = layout.totalDurationMs

  const activeId = hoveredId ?? focusedId
  const activeItem = activeId ? items.find((i) => i.span.id === activeId) : undefined
  const parallelIds = activeItem
    ? new Set(
        items
          .filter((i) => i.span.id === activeItem.span.id || spansOverlap(i.span, activeItem.span))
          .map((i) => i.span.id),
      )
    : null

  const panelIndex = panelId ? items.findIndex((i) => i.span.id === panelId) : -1
  const selectedSpan = panelIndex >= 0 ? items[panelIndex].span : null
  const prevSpan = panelIndex > 0 ? items[panelIndex - 1].span : null
  const nextSpan =
    panelIndex >= 0 && panelIndex < items.length - 1 ? items[panelIndex + 1].span : null

  function selectByDelta(delta: number) {
    setPanelId((id) => {
      const idx = id ? items.findIndex((i) => i.span.id === id) : -1
      const next = idx + delta
      if (next < 0 || next >= items.length) return id
      return items[next].span.id
    })
  }

  function xOf(ms: number): number {
    return PLOT_LEFT + (ms / total) * PLOT_WIDTH
  }

  function handleBarClick(item: SwarmItem) {
    if (zoom.didPanRef.current) return
    if (focusedId === item.span.id) {
      // Second click — open panel
      setPanelId(item.span.id)
    } else {
      // First click on different bar — select it, close panel
      setFocusedId(item.span.id)
      setPanelId(null)
    }
  }

  function scheduleTooltip(show: () => void) {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    tooltipTimerRef.current = setTimeout(show, TOOLTIP_DELAY_MS)
  }

  function clearTooltipTimer() {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    tooltipTimerRef.current = null
  }

  function showTooltip(e: React.MouseEvent, item: SwarmItem) {
    const s = item.span
    const rows: TooltipState['rows'] = [{ label: 'Type', value: spanLabel(s.spanType) }]
    if (s.durationMs !== null) rows.push({ label: 'Duration', value: formatMs(s.durationMs) })
    if (s.totalTokens !== null)
      rows.push({ label: 'Tokens', value: s.totalTokens.toLocaleString() })
    if (s.statusCode)
      rows.push({
        label: 'Status',
        value: s.statusCode,
        accent:
          s.statusCode === 'error' ? '#f87171' : s.statusCode === 'success' ? '#4ade80' : undefined,
      })
    setHoveredId(s.id)
    const cx = e.clientX
    const cy = e.clientY
    scheduleTooltip(() => setTooltip({ x: cx, y: cy, title: s.name, rows }))
  }

  // Theme-aware SVG colors
  const gridlineColor = isDark ? '#1e293b' : '#e2e8f0'
  const rulerTextClass = isDark
    ? 'fill-slate-500 text-[10px] font-mono'
    : 'fill-gray-400 text-[10px] font-mono'
  const barTextClass = isDark
    ? 'pointer-events-none fill-slate-400 text-[10px] font-medium'
    : 'pointer-events-none fill-gray-500 text-[10px] font-medium'
  const focusedGlowColor = isDark ? '#60a5fa' : '#2563eb'
  const selectedBarStroke = isDark ? '#ffffff' : '#0f172a'

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-x-4 gap-y-2 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Parallel Execution
            <span className="ml-2 text-gray-400 font-normal text-xs dark:text-slate-500">
              {layout.laneCount} lane{layout.laneCount !== 1 ? 's' : ''} · {items.length} span
              {items.length !== 1 ? 's' : ''}
            </span>
          </h2>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-slate-400">
            {LEGEND.map(([type, label]) => (
              <span key={type} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-3 rounded-sm"
                  style={{ background: SPAN_COLORS[type] }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="relative">
          <GraphZoomControls
            onZoomIn={zoom.zoomIn}
            onZoomOut={zoom.zoomOut}
            onFit={zoom.fitToView}
          />
          <svg
            ref={zoom.svgRef}
            className="block h-[460px] w-full touch-none select-none"
            style={{ cursor: zoom.isPanning ? 'grabbing' : 'grab' }}
            onPointerDown={zoom.onPointerDown}
            onPointerMove={zoom.onPointerMove}
            onPointerUp={zoom.onPointerUp}
            onPointerCancel={zoom.onPointerUp}
            onDoubleClick={zoom.fitToView}
          >
            <g transform={`translate(${zoom.transform.tx},${zoom.transform.ty}) scale(${zoom.transform.scale})`}>
              {/* Time ruler + gridlines */}
              {RULER_FRACTIONS.map((f) => {
                const x = xOf(f * total)
                return (
                  <g key={f}>
                    <line
                      x1={x}
                      y1={TOP - 6}
                      x2={x}
                      y2={contentHeight - 8}
                      stroke={gridlineColor}
                      strokeWidth={1}
                    />
                    <text
                      x={x}
                      y={TOP - 12}
                      textAnchor="middle"
                      className={rulerTextClass}
                    >
                      {formatMs(Math.round(f * total))}
                    </text>
                  </g>
                )
              })}

              {/* Lane separators */}
              {Array.from({ length: layout.laneCount }).map((_, lane) => (
                <line
                  key={lane}
                  x1={PLOT_LEFT}
                  y1={TOP + lane * LANE_H}
                  x2={CONTENT_WIDTH - PLOT_RIGHT}
                  y2={TOP + lane * LANE_H}
                  stroke={gridlineColor}
                  strokeWidth={1}
                />
              ))}

              {/* Span bars */}
              {items.map((item) => {
                const s = item.span
                const barX = xOf(item.startMs)
                const barW = Math.max(3, (item.durationMs / total) * PLOT_WIDTH)
                const barY = TOP + item.lane * LANE_H + (LANE_H - BAR_H) - 4
                const isFocused = focusedId === s.id || panelId === s.id
                const dim = parallelIds ? !parallelIds.has(s.id) : false
                const wide = barW > 46
                return (
                  <g
                    key={s.id}
                    opacity={dim ? DIM_OPACITY : 1}
                    className="cursor-pointer"
                    onClick={() => handleBarClick(item)}
                    onMouseEnter={(e) => showTooltip(e, item)}
                    onMouseMove={(e) => showTooltip(e, item)}
                    onMouseLeave={() => {
                      setHoveredId(null)
                      clearTooltipTimer()
                      setTooltip(null)
                    }}
                  >
                    {/* Name above the bar */}
                    <text
                      x={barX}
                      y={barY - 5}
                      className={barTextClass}
                    >
                      {truncate(s.name)}
                    </text>
                    {/* Focus glow ring */}
                    {isFocused && (
                      <rect
                        x={barX - 3}
                        y={barY - 3}
                        width={barW + 6}
                        height={BAR_H + 6}
                        rx={6}
                        fill="none"
                        stroke={focusedGlowColor}
                        strokeWidth={2}
                        opacity={0.8}
                      />
                    )}
                    <rect
                      x={barX}
                      y={barY}
                      width={barW}
                      height={BAR_H}
                      rx={4}
                      fill={spanColor(s)}
                      stroke={isFocused ? selectedBarStroke : 'transparent'}
                      strokeWidth={isFocused ? 2 : 0}
                    />
                    {wide && s.durationMs !== null && (
                      <text
                        x={barX + 6}
                        y={barY + BAR_H / 2}
                        dominantBaseline="central"
                        className="pointer-events-none fill-white/90 text-[10px] font-mono"
                      >
                        {formatMs(s.durationMs)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        </div>

        <div className="px-4 py-2 border-t border-gray-200 text-[10px] text-gray-400 dark:border-slate-700 dark:text-slate-500">
          Each lane is a sequential chain · stacked lanes at the same time run in parallel · click to select · click again to open details · scroll to zoom
        </div>
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 w-56 rounded-lg bg-white border border-gray-200 shadow-2xl p-3 text-xs text-gray-700 pointer-events-none dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200"
          style={{
            top: Math.min(tooltip.y + 14, window.innerHeight - 140),
            left: Math.min(tooltip.x + 14, window.innerWidth - 240),
          }}
        >
          <p className="font-semibold text-gray-900 truncate mb-1.5 dark:text-slate-100">{tooltip.title}</p>
          <div className="space-y-0.5 text-gray-500 dark:text-slate-400">
            {tooltip.rows.map((row) => (
              <p key={row.label} className="truncate">
                {row.label}:{' '}
                <span
                  style={row.accent ? { color: row.accent } : undefined}
                  className="text-gray-700 dark:text-slate-200"
                >
                  {row.value}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      <SpanDetailPanel
        span={selectedSpan}
        prevSpan={prevSpan}
        nextSpan={nextSpan}
        onClose={() => {
          setPanelId(null)
          setFocusedId(null)
        }}
        onPrev={() => selectByDelta(-1)}
        onNext={() => selectByDelta(1)}
      />
    </>
  )
}
