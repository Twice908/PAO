import type { AgentSpanRow } from '@/components/agents/SpanDetailPanel'

// ---------------------------------------------------------------------------
// Shared visual constants (mirror the Gantt / SpanWaterfall palette)
// ---------------------------------------------------------------------------

export const SPAN_COLORS: Record<string, string> = {
  llm_call: '#3b82f6',
  tool_call: '#f97316',
  memory_read: '#a855f7',
  agent_message: '#22c55e',
  error: '#ef4444',
}

export const SPAN_LABELS: Record<string, string> = {
  llm_call: 'LLM Call',
  tool_call: 'Tool Call',
  memory_read: 'Memory',
  agent_message: 'Agent Msg',
  error: 'Error',
}

const FALLBACK_COLOR = '#6b7280'
const ERROR_COLOR = SPAN_COLORS.error

/** Fill colour for a span — errored spans always render red. */
export function spanColor(span: AgentSpanRow): string {
  if (span.statusCode === 'error') return ERROR_COLOR
  return SPAN_COLORS[span.spanType] ?? FALLBACK_COLOR
}

export function spanLabel(spanType: string): string {
  return SPAN_LABELS[spanType] ?? spanType
}

export function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`
}

/** Start/end of a span in epoch ms, tolerant of missing duration/endedAt. */
function spanInterval(span: AgentSpanRow): { start: number; end: number } {
  const start = new Date(span.startedAt).getTime()
  if (span.durationMs !== null) return { start, end: start + Math.max(0, span.durationMs) }
  if (span.endedAt) return { start, end: Math.max(start, new Date(span.endedAt).getTime()) }
  return { start, end: start }
}

/** Two spans run in parallel if their [start, end) intervals overlap. */
export function spansOverlap(a: AgentSpanRow, b: AgentSpanRow): boolean {
  const ia = spanInterval(a)
  const ib = spanInterval(b)
  return ia.start < ib.end && ib.start < ia.end
}

// ---------------------------------------------------------------------------
// Dependency graph (DAG) layout — direct parent → child edges only
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string
  span: AgentSpanRow
  depth: number
  x: number
  y: number
  radius: number
}

export interface GraphEdge {
  id: string
  fromId: string
  toId: string
  from: GraphNode
  to: GraphNode
}

/** Dashed connector between sibling spans that overlap in time. */
export interface ParallelLink {
  id: string
  aId: string
  bId: string
  a: GraphNode
  b: GraphNode
}

export interface GraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  parallelLinks: ParallelLink[]
  width: number
  height: number
}

const NODE_RADIUS_MIN = 18
const NODE_RADIUS_MAX = 38
const LEVEL_HEIGHT = 140
const LEAF_SPACING = 150
const GRAPH_MARGIN = 70

function tokenRadius(span: AgentSpanRow, maxTokens: number): number {
  const tokens = span.totalTokens ?? 0
  if (maxTokens <= 0) return NODE_RADIUS_MIN
  const ratio = Math.sqrt(Math.min(1, tokens / maxTokens))
  return NODE_RADIUS_MIN + (NODE_RADIUS_MAX - NODE_RADIUS_MIN) * ratio
}

/**
 * Hierarchical (top-to-bottom) tidy-tree layout driven by `parentSpanId`.
 * Each span has at most one parent, so the dependency graph is a forest;
 * we only ever emit DIRECT parent → child edges (no transitive paths).
 */
export function layoutGraph(spans: AgentSpanRow[]): GraphLayout {
  if (spans.length === 0) {
    return { nodes: [], edges: [], parallelLinks: [], width: 0, height: 0 }
  }

  const byId = new Map(spans.map((s) => [s.id, s]))
  const children = new Map<string, AgentSpanRow[]>()
  const roots: AgentSpanRow[] = []

  for (const span of spans) {
    const parentId = span.parentSpanId
    if (parentId && byId.has(parentId)) {
      const list = children.get(parentId) ?? []
      list.push(span)
      children.set(parentId, list)
    } else {
      roots.push(span)
    }
  }

  const byStart = (a: AgentSpanRow, b: AgentSpanRow) =>
    new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  roots.sort(byStart)
  for (const list of children.values()) list.sort(byStart)

  const depthById = new Map<string, number>()
  const xUnitById = new Map<string, number>()
  const visited = new Set<string>()
  let nextLeaf = 0

  // DFS assigns depth (level) and an x position in "leaf units".
  // Internal nodes are centred over their children → minimal crossings.
  function place(id: string, depth: number): number {
    if (visited.has(id)) return xUnitById.get(id) ?? 0
    visited.add(id)
    depthById.set(id, depth)

    const kids = children.get(id) ?? []
    if (kids.length === 0) {
      const x = nextLeaf
      nextLeaf += 1
      xUnitById.set(id, x)
      return x
    }

    const kidXs = kids.map((k) => place(k.id, depth + 1))
    const center = (kidXs[0] + kidXs[kidXs.length - 1]) / 2
    xUnitById.set(id, center)
    return center
  }

  for (const root of roots) place(root.id, 0)

  const maxTokens = spans.reduce((max, s) => Math.max(max, s.totalTokens ?? 0), 0)

  const nodes: GraphNode[] = spans.map((span) => {
    const depth = depthById.get(span.id) ?? 0
    const xUnit = xUnitById.get(span.id) ?? 0
    const radius = tokenRadius(span, maxTokens)
    return {
      id: span.id,
      span,
      depth,
      radius,
      x: GRAPH_MARGIN + xUnit * LEAF_SPACING,
      y: GRAPH_MARGIN + depth * LEVEL_HEIGHT,
    }
  })

  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  const edges: GraphEdge[] = []
  for (const span of spans) {
    const parentId = span.parentSpanId
    if (!parentId) continue
    const from = nodeById.get(parentId)
    const to = nodeById.get(span.id)
    if (from && to) {
      edges.push({ id: `${parentId}->${span.id}`, fromId: parentId, toId: span.id, from, to })
    }
  }

  // Dashed links between sibling spans (same parent) that overlap in time.
  const parallelLinks: ParallelLink[] = []
  const groups = new Map<string, AgentSpanRow[]>()
  for (const span of spans) {
    const key = span.parentSpanId ?? '__root__'
    const list = groups.get(key) ?? []
    list.push(span)
    groups.set(key, list)
  }
  for (const siblings of groups.values()) {
    for (let i = 0; i < siblings.length; i += 1) {
      for (let j = i + 1; j < siblings.length; j += 1) {
        if (!spansOverlap(siblings[i], siblings[j])) continue
        const a = nodeById.get(siblings[i].id)
        const b = nodeById.get(siblings[j].id)
        if (a && b) {
          parallelLinks.push({ id: `${a.id}~${b.id}`, aId: a.id, bId: b.id, a, b })
        }
      }
    }
  }

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.radius), 0)
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.radius), 0)

  return {
    nodes,
    edges,
    parallelLinks,
    width: maxX + GRAPH_MARGIN,
    height: maxY + GRAPH_MARGIN,
  }
}

/** Direct neighbours (parents + children) of a node — used for highlighting. */
export function directNeighbours(layout: GraphLayout, nodeId: string): Set<string> {
  const ids = new Set<string>([nodeId])
  for (const edge of layout.edges) {
    if (edge.fromId === nodeId) ids.add(edge.toId)
    if (edge.toId === nodeId) ids.add(edge.fromId)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Parallel-execution swarm layout — greedy lane (swimlane) assignment
// ---------------------------------------------------------------------------

export interface SwarmItem {
  span: AgentSpanRow
  lane: number
  startMs: number
  durationMs: number
}

export interface SwarmLayout {
  items: SwarmItem[]
  laneCount: number
  totalDurationMs: number
}

/**
 * Assigns each span to a horizontal lane such that spans sharing a lane never
 * overlap in time. Overlapping (parallel) spans are pushed to separate lanes,
 * so lanes read as sequential chains and columns as parallel work.
 */
export function layoutSwarm(
  spans: AgentSpanRow[],
  runStartedAt: string,
  runEndedAt: string | null,
): SwarmLayout {
  if (spans.length === 0) return { items: [], laneCount: 0, totalDurationMs: 1 }

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

  const laneEnds: number[] = [] // absolute end-ms of the last span in each lane
  const items: SwarmItem[] = sorted.map((span) => {
    const start = new Date(span.startedAt).getTime()
    const duration = Math.max(0, span.durationMs ?? 0)
    const end = start + duration

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }

    return {
      span,
      lane,
      startMs: Math.max(0, start - runStart),
      durationMs: duration,
    }
  })

  return { items, laneCount: laneEnds.length, totalDurationMs }
}
