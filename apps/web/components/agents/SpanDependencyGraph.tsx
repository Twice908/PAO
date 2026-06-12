'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import SpanDetailPanel, { type AgentSpanRow } from '@/components/agents/SpanDetailPanel'
import GraphZoomControls from '@/components/agents/GraphZoomControls'
import {
  type GraphEdge,
  type GraphNode,
  SPAN_COLORS,
  SPAN_LABELS,
  directNeighbours,
  formatMs,
  layoutGraph,
  spanColor,
  spanLabel,
} from '@/lib/agents/spanLayout'
import { useZoomPan } from '@/lib/agents/zoomPan'

const LEGEND = [
  ['llm_call', SPAN_LABELS.llm_call],
  ['tool_call', SPAN_LABELS.tool_call],
  ['memory_read', SPAN_LABELS.memory_read],
  ['agent_message', SPAN_LABELS.agent_message],
  ['error', SPAN_LABELS.error],
] as const

const DIM_OPACITY = 0.16
const TOOLTIP_DELAY_MS = 300

function truncate(text: string, max = 16): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function statusDotColor(status: string | null): string | null {
  if (status === 'error') return '#ef4444'
  if (status === 'success') return '#22c55e'
  if (status === 'timeout') return '#f97316'
  return null
}

interface TooltipState {
  x: number
  y: number
  title: string
  rows: { label: string; value: string; accent?: string }[]
}

interface SpanDependencyGraphProps {
  spans: AgentSpanRow[]
}

export default function SpanDependencyGraph({ spans }: SpanDependencyGraphProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  const layout = useMemo(() => layoutGraph(spans), [spans])
  const sorted = useMemo(
    () =>
      [...spans].sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      ),
    [spans],
  )

  // focusedId = first-click selection (highlights neighbours, shows outline)
  // panelId = second-click (opens SpanDetailPanel)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const zoom = useZoomPan({ width: layout.width, height: layout.height })

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

  if (layout.nodes.length === 0) return null

  const activeId = hoveredId ?? focusedId
  const neighbours = activeId ? directNeighbours(layout, activeId) : null

  const panelIndex = panelId ? sorted.findIndex((s) => s.id === panelId) : -1
  const selectedSpan = panelIndex >= 0 ? sorted[panelIndex] : null
  const prevSpan = panelIndex > 0 ? sorted[panelIndex - 1] : null
  const nextSpan =
    panelIndex >= 0 && panelIndex < sorted.length - 1 ? sorted[panelIndex + 1] : null

  function selectByDelta(delta: number) {
    setPanelId((id) => {
      const idx = id ? sorted.findIndex((s) => s.id === id) : -1
      const next = idx + delta
      if (next < 0 || next >= sorted.length) return id
      return sorted[next].id
    })
  }

  function nodeOpacity(id: string): number {
    if (!neighbours) return 1
    return neighbours.has(id) ? 1 : DIM_OPACITY
  }

  function edgeHighlighted(edge: GraphEdge): boolean {
    return !!activeId && (edge.fromId === activeId || edge.toId === activeId)
  }

  function handleNodeClick(node: GraphNode) {
    if (zoom.didPanRef.current) return
    if (focusedId === node.id) {
      // Second click — open panel
      setPanelId(node.id)
    } else {
      // First click on a different node — select it, close any open panel
      setFocusedId(node.id)
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

  function showNodeTooltip(e: React.MouseEvent, node: GraphNode) {
    const s = node.span
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
    setHoveredId(node.id)
    const cx = e.clientX
    const cy = e.clientY
    scheduleTooltip(() => setTooltip({ x: cx, y: cy, title: s.name, rows }))
  }

  function showEdgeTooltip(e: React.MouseEvent, edge: GraphEdge) {
    const cx = e.clientX
    const cy = e.clientY
    scheduleTooltip(() =>
      setTooltip({
        x: cx,
        y: cy,
        title: 'Direct dependency',
        rows: [
          { label: 'From', value: edge.from.span.name },
          { label: 'To', value: edge.to.span.name },
          { label: 'Flow', value: 'calls / passes output' },
        ],
      }),
    )
  }

  // Theme-aware SVG colors
  const edgeColor = isDark ? '#64748b' : '#94a3b8'
  const activeEdgeColor = isDark ? '#e2e8f0' : '#334155'
  const parallelLinkColor = isDark ? '#475569' : '#cbd5e1'
  const nodeBorderColor = isDark ? '#0f172a' : '#f1f5f9'
  const selectedNodeColor = isDark ? '#ffffff' : '#0f172a'
  const focusedGlowColor = isDark ? '#60a5fa' : '#2563eb'
  const dotBorderColor = isDark ? '#0f172a' : '#f1f5f9'

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-slate-700 dark:bg-slate-900">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-x-4 gap-y-2 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Dependency Graph
            <span className="ml-2 text-gray-400 font-normal text-xs dark:text-slate-500">
              {layout.nodes.length} span{layout.nodes.length !== 1 ? 's' : ''}
            </span>
          </h2>
          <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-slate-400">
            {LEGEND.map(([type, label]) => (
              <span key={type} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
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
            className="block h-[520px] w-full touch-none select-none"
            style={{ cursor: zoom.isPanning ? 'grabbing' : 'grab' }}
            onPointerDown={zoom.onPointerDown}
            onPointerMove={zoom.onPointerMove}
            onPointerUp={zoom.onPointerUp}
            onPointerCancel={zoom.onPointerUp}
            onDoubleClick={zoom.fitToView}
          >
            <defs>
              <marker
                id="dep-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill={edgeColor} />
              </marker>
              <marker
                id="dep-arrow-active"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill={activeEdgeColor} />
              </marker>
            </defs>

            <g transform={`translate(${zoom.transform.tx},${zoom.transform.ty}) scale(${zoom.transform.scale})`}>
              {/* Parallel (overlapping sibling) connectors */}
              {layout.parallelLinks.map((link) => {
                const dim =
                  neighbours && !(neighbours.has(link.aId) && neighbours.has(link.bId))
                return (
                  <line
                    key={link.id}
                    x1={link.a.x}
                    y1={link.a.y}
                    x2={link.b.x}
                    y2={link.b.y}
                    stroke={parallelLinkColor}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    opacity={dim ? DIM_OPACITY : 0.7}
                  />
                )
              })}

              {/* Dependency edges */}
              {layout.edges.map((edge) => {
                const active = edgeHighlighted(edge)
                const dim = !!neighbours && !active
                const x1 = edge.from.x
                const y1 = edge.from.y + edge.from.radius
                const x2 = edge.to.x
                const y2 = edge.to.y - edge.to.radius
                const my = (y1 + y2) / 2
                return (
                  <path
                    key={edge.id}
                    d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                    fill="none"
                    stroke={active ? activeEdgeColor : edgeColor}
                    strokeWidth={active ? 2.5 : 1.5}
                    opacity={dim ? DIM_OPACITY : 1}
                    markerEnd={`url(#${active ? 'dep-arrow-active' : 'dep-arrow'})`}
                    className="cursor-pointer"
                    onMouseEnter={(e) => showEdgeTooltip(e, edge)}
                    onMouseMove={(e) => showEdgeTooltip(e, edge)}
                    onMouseLeave={() => {
                      clearTooltipTimer()
                      setTooltip(null)
                    }}
                  />
                )
              })}

              {/* Nodes */}
              {layout.nodes.map((node) => {
                const s = node.span
                const isFocused = focusedId === node.id || panelId === node.id
                const dot = statusDotColor(s.statusCode)
                return (
                  <g
                    key={node.id}
                    opacity={nodeOpacity(node.id)}
                    className="cursor-pointer"
                    onClick={() => handleNodeClick(node)}
                    onMouseEnter={(e) => showNodeTooltip(e, node)}
                    onMouseMove={(e) => showNodeTooltip(e, node)}
                    onMouseLeave={() => {
                      setHoveredId(null)
                      clearTooltipTimer()
                      setTooltip(null)
                    }}
                  >
                    {/* Focus glow ring */}
                    {isFocused && (
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={node.radius + 6}
                        fill="none"
                        stroke={focusedGlowColor}
                        strokeWidth={2.5}
                        opacity={0.8}
                      />
                    )}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius}
                      fill={spanColor(s)}
                      stroke={isFocused ? selectedNodeColor : nodeBorderColor}
                      strokeWidth={isFocused ? 3 : 2}
                    />
                    {dot && (
                      <circle
                        cx={node.x + node.radius * 0.66}
                        cy={node.y - node.radius * 0.66}
                        r={5}
                        fill={dot}
                        stroke={dotBorderColor}
                        strokeWidth={1.5}
                      />
                    )}
                    <text
                      x={node.x}
                      y={node.y + node.radius + 16}
                      textAnchor="middle"
                      className="pointer-events-none fill-gray-600 dark:fill-slate-300 text-[11px] font-medium"
                    >
                      {truncate(s.name)}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        </div>

        <div className="px-4 py-2 border-t border-gray-200 text-[10px] text-gray-400 dark:border-slate-700 dark:text-slate-500">
          Scroll to zoom · drag to pan · double-click to fit · click to select · click again to open details
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
