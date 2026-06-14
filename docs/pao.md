# claude.pulse_agent_observe.md
# PAO — Pulse Agent Observe: Claude Code Project Instructions

---

> **Status note**: This is the original design spec written when PAO was a
> feature living inside the Pulse monorepo ("not a new product, a new event
> type within Pulse"). PAO has since been extracted into this standalone
> repo with its own scoped Prisma schema, API, worker, and dashboard. The
> architecture, data models, and SDK design below are still accurate; for
> the current setup, deployment, and task-completion status see
> [README.md](../README.md) and [pao-tasks.md](pao-tasks.md).

## What This Feature Is

**PAO (Pulse Agent Observe)** is an AI agent observability layer built on top of Pulse's existing backend monitoring infrastructure. Where Pulse tracks HTTP requests, PAO tracks AI agent executions — LLM calls, tool invocations, inter-agent messages, cost/token usage, and anomalies like infinite loops or runaway cost.

PAO is **not a new product**. It is a new event type and set of views within Pulse. Everything reuses the existing ingestion pipeline, queue, worker, and dashboard shell.

**Target user**: A developer running an AI agent (LangChain, CrewAI, custom OpenAI loops, etc.) who wants the same observability they'd get from Pulse for HTTP — but for agent runs. They want to answer: What did my agent do? How long did each step take? How much did it cost? Did it loop?

---

## Architecture

PAO adds one new ingest route and new worker handlers to the existing pipeline. Nothing is rebuilt.

```
Agent Span (SDK)
     ↓
POST /ingest/agent-span          ← new Fastify route (same auth, same queue pattern)
     ↓
Redis Queue (BullMQ)             ← new queue: 'agent-spans'
     ↓
Worker: agent-span handler       ← new handler, new DB writes
     ↓
TimescaleDB: agent_spans         ← new hypertable (time-series)
PostgreSQL: agent_runs,          ← new relational tables
            agent_definitions
     ↓
Dashboard API: /api/agents/*     ← new Next.js API routes
     ↓
Dashboard UI: /dashboard/agents  ← new pages and components
```

### Key invariants
- Ingestion must remain fire-and-forget. The SDK never blocks the agent's execution.
- All agent data is scoped to a `projectId` derived from the API key — same as request logs.
- Agent spans are stored in TimescaleDB (for time-series queries). Run metadata is in PostgreSQL.

---

## Data Models

Add these to `prisma/schema.prisma`. Do not modify existing models.

```prisma
model AgentDefinition {
  id          String   @id @default(cuid())
  projectId   String
  name        String                        // e.g. "ResearchAgent"
  role        String?                       // e.g. "Searches the web and summarizes findings"
  model       String?                       // default model for this agent
  createdAt   DateTime @default(now())

  project     Project  @relation(fields: [projectId], references: [id])
  spans       AgentSpan[]

  @@index([projectId])
}

model AgentRun {
  id          String   @id @default(cuid())
  projectId   String
  task        String                        // top-level task description
  status      String   @default("running") // running | completed | failed | interrupted
  startedAt   DateTime @default(now())
  endedAt     DateTime?
  totalTokens Int?
  totalCostUsd Decimal? @db.Decimal(10, 6)
  metadata    Json?

  project     Project  @relation(fields: [projectId], references: [id])
  spans       AgentSpan[]

  @@index([projectId, startedAt])
}

model AgentSpan {
  id              String   @id @default(cuid())
  runId           String
  projectId       String
  agentDefinitionId String?
  parentSpanId    String?                   // for nested spans
  spanType        String                    // llm_call | tool_call | memory_read | agent_message | error
  name            String                    // e.g. "gpt-4o completion" or "search_web"
  startedAt       DateTime
  endedAt         DateTime?
  durationMs      Int?
  inputTokens     Int?
  outputTokens    Int?
  totalTokens     Int?
  costUsd         Decimal? @db.Decimal(10, 6)
  model           String?
  inputPreview    String?  @db.Text         // first 500 chars of input (sanitized)
  outputPreview   String?  @db.Text         // first 500 chars of output
  statusCode      String?                   // success | error | timeout
  errorMessage    String?
  metadata        Json?

  run             AgentRun    @relation(fields: [runId], references: [id])
  agentDefinition AgentDefinition? @relation(fields: [agentDefinitionId], references: [id])

  @@index([runId, startedAt])
  @@index([projectId, startedAt])
}
```

After adding models, create a TimescaleDB hypertable migration for `AgentSpan` on `startedAt`. Add this as a raw SQL migration in `prisma/migrations/`:

```sql
SELECT create_hypertable('agent_spans', 'started_at', if_not_exists => TRUE);
CREATE INDEX ON agent_spans (run_id, started_at DESC);
CREATE INDEX ON agent_spans (project_id, started_at DESC);
```

---

## SDK Design

The SDK lives in `packages/pulse-agent/` (a separate npm package: `@pulse/agent`).

### Public API

```ts
import { PulseAgent } from '@pulse/agent'

const pulse = new PulseAgent({ apiKey: 'pk_live_...' })

// Start a top-level run
const run = await pulse.startRun('Summarize quarterly report', {
  metadata: { triggeredBy: 'cron' }
})

// Start a span within the run
const span = run.startSpan('llm_call', {
  name: 'gpt-4o completion',
  model: 'gpt-4o',
  agentName: 'SummaryAgent',
  inputPreview: prompt.slice(0, 500),
})

// End the span with results
span.end({
  outputPreview: result.slice(0, 500),
  inputTokens: usage.prompt_tokens,
  outputTokens: usage.completion_tokens,
  costUsd: calculateCost(usage),
  status: 'success',
})

// Complete the run
await run.complete({ status: 'completed' })
// or
await run.complete({ status: 'failed', errorMessage: err.message })
```

### SDK implementation rules
- All network calls are fire-and-forget (`fetch` with no `await` at the call site, wrapped in a silent try/catch)
- The SDK buffers spans in memory and flushes on `run.complete()` OR after 5 seconds, whichever comes first
- No span data is ever logged to stdout by default
- `inputPreview` and `outputPreview` are truncated to 500 chars by the SDK before sending — never send full prompts
- The SDK exports a no-op stub when `PULSE_DISABLED=true` is set, so it never affects test environments

### Ingest payload shape

```ts
// POST /ingest/agent-span
// Header: x-api-key: pk_live_...

type AgentSpanPayload = {
  type: 'span' | 'run_start' | 'run_end'
  runId: string           // client-generated UUID
  spanId?: string         // client-generated UUID (for type: 'span')
  parentSpanId?: string
  task?: string           // for run_start
  agentName?: string
  spanType?: SpanType
  name?: string
  model?: string
  startedAt: string       // ISO 8601
  endedAt?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  inputPreview?: string
  outputPreview?: string
  status?: 'success' | 'error' | 'timeout'
  errorMessage?: string
  metadata?: Record<string, unknown>
}
```

---

## Ingestion Route

File: `apps/api/src/routes/ingest/agent-span.ts`

```ts
// POST /ingest/agent-span
// Auth: same x-api-key middleware as /ingest/request
// Validates payload shape with Zod
// Pushes to BullMQ queue 'agent-spans' — does NOT write to DB directly
// Returns 202 Accepted immediately
// Target: < 10ms response time
```

---

## Worker Handler

File: `apps/api/src/workers/agent-span.worker.ts`

Handles three job types based on `payload.type`:

- `run_start` → upsert `AgentRun` (create if not exists by `runId`)
- `span` → insert `AgentSpan`, upsert `AgentDefinition` if `agentName` is new, update `AgentRun.totalTokens` and `AgentRun.totalCostUsd`
- `run_end` → update `AgentRun.status`, `AgentRun.endedAt`, final cost rollup

Worker must be idempotent — duplicate span IDs should be ignored (use `upsert` with `skipDuplicates`).

---

## Dashboard Pages

All new pages live under `/dashboard/agents/` in the Next.js app.

### `/dashboard/agents` — Run List
- Table of recent `AgentRun` records for the current project
- Columns: Task, Status, Start time, Duration, Total tokens, Total cost, Span count
- Status badge: running (pulsing dot), completed (green), failed (red), interrupted (orange)
- Click row → `/dashboard/agents/[runId]`

### `/dashboard/agents/[runId]` — Run Detail
- Header: task name, status, duration, total cost, total tokens
- **Gantt timeline**: horizontal bars per span, x-axis is time, color-coded by span type
- **Span log table**: chronological list of all spans with type, name, duration, cost, status
- Click span row → slide-in detail panel with full metadata

### `/dashboard/agents/[runId]/graph` — Agent Topology (Phase B)
- Force-directed graph of agents and their message connections
- Deferred to Phase B

---

## Build Phases

### Phase A — Span Ingestion + Basic Run List (current)
- Prisma schema additions + TimescaleDB migration
- `/ingest/agent-span` Fastify route
- BullMQ queue + worker (run_start, span, run_end handlers)
- `/api/agents/runs` and `/api/agents/runs/[runId]` Next.js API routes
- Run list UI page
- Basic run detail page (span table only, no Gantt yet)
- SDK: `PulseAgent` class with `startRun`, `startSpan`, `span.end`, `run.complete`

### Phase B — Gantt Timeline + Agent Topology Graph
- Gantt chart component (Recharts or custom SVG)
- Agent topology graph (react-flow or d3-force)
- Agent definition registry view

### Phase C — Cost Tracking + Anomaly Detection
- Cost per model breakdown charts
- Loop detection: flag runs where the same span type repeats > N times in M seconds
- Cost spike alerts: alert when a run exceeds a configurable USD threshold
- Integrate with existing Alert model

### Phase D — Auto-instrumentation
- LangChain callback handler
- CrewAI observer
- OpenAI SDK wrapper (intercepts `openai.chat.completions.create`)

### Phase E — Unified Timeline
- Merge HTTP request logs + agent spans on one timeline per time window
- Correlate agent runs triggered by HTTP requests (via `x-pulse-run-id` header)

---

## Coding Conventions

Follow all existing Pulse conventions exactly:

- **TypeScript everywhere** — no `any`, explicit return types on all functions
- **Zod for all validation** — every ingest route input validated with Zod schema before queuing
- **Prisma for all DB access** — no raw SQL except in migrations and TimescaleDB-specific aggregation queries
- **BullMQ job pattern** — ingest routes enqueue, workers process; never write to DB from a route handler
- **Error handling** — all worker handlers wrapped in try/catch; failed jobs retry 3x with exponential backoff; dead-letter after 3 failures
- **Environment variables** — all config via env vars, validated at startup with `zod.parse` on `process.env`
- **File naming** — `kebab-case.ts` for files, `PascalCase` for classes and types, `camelCase` for functions
- **No console.log in production code** — use the existing Pino logger instance (`import { logger } from '@pulse/logger'`)
- **Tests** — unit tests for worker handlers (mock Prisma), integration tests for ingest routes (real Redis, test DB)

---

## What NOT to Do

- Do not store full prompt/response bodies — only `inputPreview` and `outputPreview` (max 500 chars each)
- Do not block the agent's execution thread — all SDK network calls are fire-and-forget
- Do not create a separate auth system for PAO — reuse the existing API key middleware
- Do not add PAO-specific tables to TimescaleDB unless they are genuinely time-series (agent spans are; agent definitions are not)
- Do not build Phase B, C, D, or E features until Phase A is complete and tested