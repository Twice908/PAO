# Tasks.md — PAO Phase A: Span Ingestion + Basic Run List

Phase A goal: A developer can install `@pulse/agent`, wrap their agent run, and see a list of runs with span details in the Pulse dashboard.

**Scope**: Schema → Ingestion route → Worker → API routes → Dashboard UI → SDK

---

## 1. Database & Schema

- [x] **1.1 Add PAO models to Prisma schema**
  `AgentDefinition`, `AgentRun`, and `AgentSpan` models are present in `packages/db/prisma/schema.prisma` with back-relations from `Project`.

- [x] **1.2 Generate and run Prisma migration**
  `packages/db/prisma/migrations/0001_init/migration.sql` creates the PAO-scoped schema (Project/Alert/AlertEvent + the three Agent models).

- [x] **1.3 Create TimescaleDB hypertable migration**
  `packages/db/prisma/migrations/0002_agent_spans_hypertable/migration.sql` calls `create_hypertable('agent_spans', 'started_at', if_not_exists => TRUE)` and adds the `(run_id, started_at DESC)` / `(project_id, started_at DESC)` indexes. Not applied by `prisma migrate deploy`/`db:push` automatically — run it manually with `psql` (see README setup steps).

- [x] **1.4 Seed script: add sample agent run + spans**
  `seedAgentRun()` in `packages/db/prisma/seed.ts` creates one `AgentRun` with 5 `AgentSpan` records (3x `llm_call`, 2x `tool_call`) for the dev project.

---

## 2. Ingestion API

- [x] **2.1 Define Zod schema for agent-span payload**
  `apps/api/src/schemas/agent-span.schema.ts` defines `AgentSpanPayloadSchema` and the batch wrapper `AgentSpanBatchSchema = z.array(AgentSpanPayloadSchema).min(1)`, with the inferred TS type exported.

- [x] **2.2 Create BullMQ queue for agent spans**
  `apps/api/src/lib/queue.ts` exports `agentSpansQueue` (queue name `'agent-spans'`) with `defaultJobOptions` (3 attempts, exponential backoff).

- [x] **2.3 Implement POST /ingest/agent-span route**
  `apps/api/src/routes/ingest/agent-span.ts` authenticates via the `Authorization: Bearer <key>` header (looked up against `Project` in `lib/auth.ts`/`lib/api-key.ts`), validates the body as an array against `AgentSpanBatchSchema`, enqueues each item on `agentSpansQueue`, and returns `202`.

- [x] **2.4 Register the new route in the Fastify app**
  Registered in `apps/api/src/index.ts` via `app.register(agentSpanRoutes)`.

- [x] **2.5 Write integration test for /ingest/agent-span**
  `apps/api/src/routes/ingest/agent-span.test.ts` — 10 tests covering valid `run_start`/`span`/`run_end` (202), missing/malformed auth (401), unknown API key (401), and invalid payloads (400). All passing.

---

## 3. Worker

- [x] **3.1 Create agent-span worker file**
  Created `apps/worker/src/processors/agent-span.processor.ts`. Registers a BullMQ `Worker` on the `'agent-spans'` queue via exported `startAgentSpanWorker(connection)`. Called from `apps/worker/src/index.ts`.

- [x] **3.2 Implement run_start handler**
  When `payload.type === 'run_start'`: upserts `AgentRun` by `runId` with `update: {}` (no-op on conflict). Initialises `totalTokens: 0` and `totalCostUsd: 0` on create so increments in the span handler never hit `NULL + N = NULL`.

- [x] **3.3 Implement span handler**
  When `payload.type === 'span'`:
  - Upserts `AgentDefinition` by `(projectId, name)` if `agentName` is present
  - Inserts `AgentSpan` via `createMany` with `skipDuplicates: true` (composite PK `id + startedAt`)
  - Increments `AgentRun.totalTokens` and `AgentRun.totalCostUsd`

- [x] **3.4 Implement run_end handler**
  When `payload.type === 'run_end'`: aggregates all child spans (`_sum totalTokens + costUsd`) and overwrites the running increments — final authoritative values. Updates `status` and `endedAt`.

- [x] **3.5 Add retry + dead-letter config to worker**
  `agentSpansQueue.defaultJobOptions` in `apps/api/src/lib/queue.ts` sets `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`. The `failed` event handler in `startAgentSpanWorker` detects final failure (`attemptsMade >= attempts`) and logs the full payload at `error` level without rethrowing.

- [x] **3.6 Write unit tests for worker handlers**
  14 unit tests in `apps/worker/src/processors/agent-span.processor.test.ts` — all passing. Covers: run_start upsert fields, idempotency, span createMany with skipDuplicates, increment args, agentDefinition upsert toggling, duplicate span silent ignore, missing runId warning-not-throw, durationMs computation, run_end aggregate + overwrite, null-sum zero-default.

---

## 4. Dashboard API Routes

- [x] **4.1 GET /api/agents/runs**
  Create `app/api/agents/runs/route.ts`. Returns paginated list of `AgentRun` for the current project (from session/auth). Query params: `page`, `limit` (default 20), `status` filter. Include `_count.spans` via Prisma `include`. Sort by `startedAt DESC`.

- [x] **4.2 GET /api/agents/runs/[runId]**
  Create `app/api/agents/runs/[runId]/route.ts`. Returns one `AgentRun` with all `AgentSpan` records sorted by `startedAt ASC`. Validates that the run belongs to the current user's project (never expose other projects' data).

- [x] **4.3 Add project ownership guard utility**
  Created `lib/guards/project-ownership.ts`. Given a `projectId` and the session user, returns a `403 NextResponse` if the project doesn't belong to them (null means access granted). Reused in both routes above.

---

## 5. Dashboard UI

- [x] **5.1 Create /dashboard/agents page (run list)**
  Create `app/dashboard/agents/page.tsx`. Fetches from `/api/agents/runs`. Renders a table with columns: Task, Status, Start time, Duration, Span count, Total tokens, Total cost (USD). Empty state: "No agent runs yet — integrate the SDK to get started."

- [x] **5.2 Status badge component**
  Create `components/agents/RunStatusBadge.tsx`. Accepts `status: 'running' | 'completed' | 'failed' | 'interrupted'`. Renders: running = pulsing blue dot + "Running", completed = green, failed = red, interrupted = orange. Pure presentational component.

- [x] **5.3 Add "Agents" link to dashboard sidebar**
  Added "Agents" nav item with `Cpu` icon from lucide-react to `components/Sidebar.tsx`. Always shown for discoverability. Active state matches existing nav pattern. Icon rendered only on this item via optional `icon` field on `NAV_ITEMS` type.

- [x] **5.4 Create /dashboard/agents/[runId] page (run detail)**
  Create `app/dashboard/agents/[runId]/page.tsx`. Fetches from `/api/agents/runs/[runId]`. Renders:
  - Header card: task, status badge, start time, duration, total cost, total tokens
  - Span table (see 5.5)

- [x] **5.5 Span log table component**
  Create `components/agents/SpanTable.tsx`. Accepts `spans: AgentSpan[]`. Columns: Type (color-coded chip), Name, Started at, Duration (ms), Tokens, Cost (USD), Status. Rows are sortable by duration and start time. Clicking a row opens a slide-in detail panel (see 5.6).

- [x] **5.6 Span detail slide-in panel**
  Create `components/agents/SpanDetailPanel.tsx`. No shadcn/ui available — implemented as a custom fixed-position right-side panel with `transform transition-transform duration-300` CSS animation. Backdrop overlay closes on click. Shows all span fields, inputPreview, outputPreview, errorMessage, metadata in `<pre>`.

- [x] **5.7 SpanType color chip component**
  Create `components/agents/SpanTypeChip.tsx`. Maps span types to colors: `llm_call` → purple, `tool_call` → blue, `memory_read` → teal, `agent_message` → amber, `error` → red. Used in span table and future Gantt.

- [x] **5.8 Loading and error states for all agent pages**
  Added `loading.tsx` and `error.tsx` (Next.js App Router conventions) for `/dashboard/agents` and `/dashboard/agents/[runId]`. Loading state: skeleton rows matching the table layout. Error state: friendly message + retry button.

---

## 6. SDK Package

- [x] **6.1 Scaffold @pulse/agent package**
  Create `packages/pulse-agent/` with `package.json` (name: `@pulse/agent`, main: `dist/index.js`, types: `dist/index.d.ts`), `tsconfig.json` (extends root), and `src/index.ts`. Add to the monorepo workspace.

- [x] **6.2 Implement PulseAgent class**
  In `src/agent.ts`, implement `PulseAgent` with:
  - Constructor: accepts `{ apiKey: string, host?: string }` (default host: `https://api.usepulse.dev`)
  - `startRun(task: string, opts?): Promise<AgentRun>` — sends `run_start` payload, returns run handle
  - Internal: `_flush(payloads)` — fire-and-forget POST to `/ingest/agent-span`, silent on error

- [x] **6.3 Implement AgentRun class**
  In `src/run.ts`, implement `AgentRun` with:
  - `startSpan(spanType, opts): AgentSpan` — creates span, records `startedAt`, adds to internal buffer
  - `complete(opts?): Promise<void>` — sends `run_end` payload, flushes all buffered spans
  - Internal buffer: array of span payloads flushed on `complete()` or after 5s timeout (whichever first)
  - All client-side IDs generated with `crypto.randomUUID()`

- [x] **6.4 Implement AgentSpan class**
  In `src/span.ts`, implement `AgentSpan` with:
  - `end(opts): void` — records `endedAt`, calculates `durationMs`, pushes completed payload to run's buffer
  - Truncates `inputPreview` and `outputPreview` to 500 chars
  - Does NOT send to API directly — run handles all flushing

- [x] **6.5 Add no-op mode**
  At the top of `PulseAgent` constructor: if `process.env.PULSE_DISABLED === 'true'`, replace all methods with no-ops that return immediately. Prevents any SDK activity in test environments.

- [x] **6.6 Build and publish config**
  Configure `tsup` (or `tsc`) to build to `dist/`. Add `build` and `prepublishOnly` scripts. Confirm the package can be imported in a plain Node.js script with `import { PulseAgent } from '@pulse/agent'`.

- [x] **6.7 Write SDK unit tests**
  Test `PulseAgent`, `AgentRun`, `AgentSpan` with mocked `fetch`:
  - `startRun` sends correct `run_start` payload
  - `span.end` adds payload to buffer (does not call fetch)
  - `run.complete` flushes all spans + sends `run_end`
  - `inputPreview` is truncated at 500 chars
  - No-op mode: no fetch calls made at all

---

## 7. Integration Smoke Test

- [x] **7.1 Manual end-to-end smoke test**
  `scripts/test-pao-e2e.ts` sends `run_start` -> `span` -> `run_end` via `@pulse/agent` against a running `apps/api`. Run with `PULSE_TEST_KEY=pk_live_... npm run test:e2e` and verify the run appears in `/dashboard/agents`.

- [ ] **7.2 Verify data scoping**
  Manual QA step — using two different API keys (two test projects), send agent spans for each and confirm each dashboard only shows its own project's runs. Not yet re-verified after the latest changes; run before relying on multi-tenant isolation in production.

---

## Phase A Done When

- [ ] A developer can run the smoke test script and see their run in the dashboard in < 5 seconds (script exists at `scripts/test-pao-e2e.ts`; needs a live run against deployed infra to confirm timing)
- [x] Run list shows correct status, duration, token count, and cost
- [x] Span table shows all span types with correct colors and durations
- [x] Span detail panel shows `inputPreview`, `outputPreview`, and metadata
- [x] No agent SDK call ever throws or blocks the calling thread
- [x] All unit and integration tests pass (`npm run build`, `npm run test`, `npm run lint` all green at the repo root)
- [x] Worker handles duplicate span IDs without error

---

## NOTES — Task 3 Implementation

### Retry config placement
BullMQ job options (`attempts`, `backoff`) must be set when a job is *added* to the queue, not on the Worker. They live in `agentSpansQueue.defaultJobOptions` in `apps/api/src/lib/queue.ts`. The Worker's `failed` event handler (inside `startAgentSpanWorker`) handles the dead-letter logging. This is a deliberate split of concerns.

### Composite PK on AgentSpan
`AgentSpan` uses `@@id([id, startedAt])` (required by TimescaleDB). `createMany` with `skipDuplicates: true` deduplicates on the composite PK — meaning two jobs with the same `spanId` but different `startedAt` values would create two rows. The SDK always sends a stable `startedAt` per span, so in practice this is safe. Watch for this if SDK buffering ever jitters timestamps.

### Increment then overwrite on run_end
The span handler increments `totalTokens` and `totalCostUsd` immediately for live-view accuracy. The `run_end` handler overwrites those values with an authoritative `agentSpan.aggregate` sum. This means during a live run the live counts are approximate (correct direction, may double-count retried spans), which is acceptable given the final rollup always wins.

### NULL-safe increments
`totalTokens` and `totalCostUsd` are initialised to `0` (not `null`) in the `run_start` create. PostgreSQL `NULL + x = NULL` would silently eat every increment. Future tasks that create `AgentRun` records outside this worker (e.g., seeding) must also set these to `0`.

### Out-of-order job delivery
If a `span` job arrives before the corresponding `run_start` job, the `agentRun.update` (increment) will throw a Prisma not-found error and BullMQ will retry up to 3 times. In normal SDK usage the `run_start` payload is sent first; retries cover rare queue reordering. No special handling needed until there is evidence of real-world reordering at scale.

### Missing `spanId` in span handler
The spec only calls for a warning on missing `runId`. Missing `spanId` is not handled softly — `createMany` will fail (required PK field), triggering retries. This is intentional: a span without an ID is a client-side bug, not a transient error.

---

## NOTES — Task 4 Implementation

### projectId comes from query param, not path
The routes live at `/api/agents/runs` (no `[projectId]` segment). Project scoping is done via `?project=<projectId>` query param, matching the existing dashboard pattern (`/dashboard/logs?project=...`). Both routes enforce the `?project` param is present before proceeding.

### Guard returns null-on-success, NextResponse-on-failure
`requireProjectOwnership` returns `null` when access is granted and a `403 NextResponse` when not. Callers do `const denied = await requireProjectOwnership(...); if (denied) return denied`. This avoids throwing and keeps the early-return pattern consistent with existing Pulse API routes.

### Ownership check on run detail uses run's own projectId
The `GET /api/agents/runs/[runId]` route first fetches the run, then passes `run.projectId` to the guard. An attacker cannot infer another project's run IDs because a 404 is returned first if the run doesn't exist at all — the ownership check is only exercised when the run exists. This prevents both data leakage and project enumeration.

### Prisma Decimal serialization
`AgentRun.totalCostUsd` and `AgentSpan.costUsd` are `Prisma.Decimal` values that serialize to strings via `toJSON()`. Both routes explicitly call `.toNumber()` so the JSON response carries a float, not a string. Downstream UI code can format with `toFixed(6)` or similar.

### `_count.spans` naming in response
Prisma returns `_count: { spans: number }` nested. The list route maps this to a flat `spanCount` field for cleaner client consumption instead of exposing the internal `_count` shape.

---

## NOTES — Task 5 Implementation

### No shadcn/ui — custom slide-in panel
The codebase has no shadcn/ui or Radix component library. `SpanDetailPanel` is a custom fixed-position right-side panel using Tailwind's `transform transition-transform duration-300` classes. The panel stays in the DOM at all times; `translate-x-full` hides it off-screen when closed. A semi-transparent backdrop (`bg-black/30`) closes the panel on click.

### `AgentSpanRow` type export chain
`AgentSpanRow` is defined and exported from `SpanDetailPanel.tsx`. `SpanTable.tsx` re-exports it (`export type { AgentSpanRow }`). `[runId]/page.tsx` imports it from `SpanTable` so there's a single source of truth with no circular dependencies.

### Sidebar icon pattern
The `Cpu` icon is the only icon in the sidebar nav. The `NAV_ITEMS` type was extended with an optional `icon` field (`React.ComponentType<{ className?: string }>`). The button render conditionally shows `<item.icon className="mr-2 h-4 w-4 shrink-0" />` before the label. Existing items without icons are unaffected.

### projectId flows through query params on navigation
`goToRun()` in the list page and `goBack()` in the detail page both construct URLs with `?project=<projectId>` to preserve sidebar project selection across navigation. Without this, the sidebar would reset to the first project on back navigation.

### Client-side data fetching (useEffect) vs. server components
All agent pages are client components (`'use client'`) with `useEffect`-based fetching, matching the existing pattern in `analytics/page.tsx`, `rate-limiter/page.tsx`, and `alerts/page.tsx`. Server components were not used because these pages depend on `useSearchParams()` for the `?project=` param.

### `formatDuration` / `formatCost` duplication
Both functions are defined inline in `page.tsx` (list) and `[runId]/page.tsx` (detail) rather than extracted to `lib/utils.ts` — per CLAUDE.md "three similar lines is better than a premature abstraction." These functions are 5 lines each and are only used in these two files.

---

## NOTES — Bug Fixes (post-Task 5)

### Bug 1 — Schema `status` enum too narrow for `run_end` payloads
**File**: `apps/api/src/schemas/agent-span.schema.ts`

The `status` field was `z.enum(['success', 'error', 'timeout'])` — valid only for span-level status codes (mapped to `AgentSpan.statusCode` in the worker). But `run_end` payloads use the same `status` field to carry run-level status (`'completed' | 'failed' | 'interrupted'`), which the worker passes to `AgentRun.status` in `handleRunEnd`. Any SDK that sent `status: 'completed'` on a `run_end` payload received a Zod 400 error and the run was never marked complete.

**Fix**: Extended the enum to `['success', 'error', 'timeout', 'completed', 'failed', 'interrupted']`. The worker already routes the value to the correct DB field based on `type`. Updated `AgentSpanJobData.status` in the worker interface to match.

### Bug 2 — Null-data crash on agents page after failed fetch
**File**: `apps/web/app/dashboard/agents/page.tsx` (line ~174)

When a fetch failed, `error` was set and `data` remained `null`. The render ternary `isLoading ? skeleton : data?.runs.length === 0 ? empty : table` fell through to the table branch because `null?.runs.length === 0` evaluates to `false`. Inside the table branch, `data!.runs.map(...)` crashed with "Cannot read properties of null". The `error.tsx` boundary did not catch this because it is a synchronous render exception in a client component, not a caught async error.

**Fix**: Changed the ternary condition to `!data || data.runs.length === 0` so null data renders the empty state (the inline error message above already communicates the failure). Removed all `data!` non-null assertions in the table section — they are now provably unreachable when `data` is null.