# PAO — Pulse Agent Observe (standalone)

This is **Pulse Agent Observe (PAO)** extracted from the Pulse monorepo into a
self-contained project. PAO is an observability layer for AI agents: it tracks
agent runs and spans (LLM calls, tool calls, memory reads, inter-agent
messages), token usage, cost, and anomalies (error rate, runaway tokens, long
execution times) — the same way Pulse tracks HTTP requests.

> ⚠️ This folder was generated as a **code copy** of the PAO feature and its
> direct Pulse dependencies. It has **not** been built or run from inside the
> Pulse repo (doing so would clash with the parent workspace). Move this `PAO/`
> folder to its own directory before installing and running it.

## Architecture

```
@pulse/agent SDK  ──POST /ingest/agent-span──►  apps/api (Fastify)
                                                     │ enqueue (BullMQ)
                                                     ▼
                                              Redis  ──►  apps/worker
                                                             │ Prisma writes
                                                             ▼
                                      PostgreSQL + TimescaleDB (agent_spans hypertable)
                                                             ▲
                          apps/web (Next.js dashboard) ──────┘  /dashboard/agents
                          live runs via SSE: api /projects/:id/agents/stream
```

## Layout (mini-monorepo, mirrors how PAO lived inside Pulse)

```
PAO/
├── packages/
│   ├── pulse-agent/   # @pulse/agent — the SDK (zero runtime deps)
│   ├── db/            # @pulse/db — Prisma schema (PAO-scoped), client, seed, migrations
│   └── types/         # @pulse/types — shared TS types used by the dashboard
├── apps/
│   ├── api/           # @pulse/api — Fastify ingest route + SSE stream
│   ├── worker/        # @pulse/worker — BullMQ processors + agent alert evaluation
│   └── web/           # @pulse/web — Next.js dashboard (/dashboard/agents)
├── docs/              # pao.md spec + phase tasks
├── docker-compose.yml # TimescaleDB + Redis
└── .env.example
```

## What was kept vs. trimmed

PAO inside Pulse shared a database, queue, auth, and alert engine with the other
Pulse products (Observe, Rate Limiter, Drift). For a clean standalone:

- **Kept verbatim**: the SDK, the agent-span ingest route + Zod schema, the SSE
  stream route, the agent-span worker processor, the agent-alerts processor, the
  notification dispatcher, the dashboard pages/components/graphs/hooks, and the
  three Agent Prisma models.
- **Scoped to PAO**: the Prisma schema keeps only `User`, `Project`, `Alert`,
  `AlertEvent` (the tenancy + alert tables PAO's FKs and alert engine need) plus
  the three Agent models — the unrelated Pulse models (RequestLog, Drift,
  RateLimit, Uptime) were left out. The shared `alert-evaluator` was reduced to
  its agent-alert functions only. The API/worker entry points register only the
  PAO routes/queues.

## Setup (after moving this folder out of Pulse)

```bash
# 1. Install
npm install

# 2. Start infra
docker compose up -d

# 3. Configure env
cp .env.example .env   # then fill in Clerk keys

# 4. Generate Prisma client + apply schema
npm run db:generate -w packages/db
npm run db:push     -w packages/db          # quick path; or `db:migrate` for the migration chain
# Apply the TimescaleDB hypertable (db:push does not run raw SQL migrations):
#   psql "$DATABASE_URL" -f packages/db/prisma/migrations/0002_agent_spans_hypertable/migration.sql
npm run db:seed     -w packages/db          # optional sample run

# 5. Run everything
npm run dev
```

Services: API on `:3001`, dashboard on `:3000`, worker has no HTTP port.

## SDK usage

```ts
import { PulseAgent } from '@pulse/agent'

const pulse = new PulseAgent({ apiKey: 'pk_live_...', host: 'http://localhost:3001' })

const run = await pulse.startRun('Summarize quarterly report')
const span = run.startSpan('llm_call', { name: 'gpt-4o completion', model: 'gpt-4o' })
span.end({ inputTokens: 210, outputTokens: 145, costUsd: 0.0053, status: 'success' })
await run.complete({ status: 'completed' })
```

Set `PULSE_DISABLED=true` to turn the SDK into a no-op (e.g. in tests).

See [docs/pao.md](docs/pao.md) for the full design spec.
