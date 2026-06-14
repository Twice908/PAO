# PAO — Pulse Agent Observe (standalone)

**Pulse Agent Observe (PAO)** is a standalone observability stack for AI
agents: it tracks agent runs and spans (LLM calls, tool calls, memory reads,
inter-agent messages), token usage, cost, and anomalies (error rate, runaway
tokens, long execution times).

This repo is a self-contained npm-workspaces monorepo — install once at the
root and run everything with `npm run dev`.

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

## Repo layout

```
PAO/
├── packages/
│   ├── pulse-agent/      # @pulse/agent — TypeScript SDK (zero runtime deps)
│   ├── pulse-agent-py/    # pulse-agent — Python SDK (mirrors the TS SDK)
│   ├── db/                # @pulse/db — Prisma schema, client, seed, migrations
│   └── types/             # @pulse/types — shared TS types used by the dashboard
├── apps/
│   ├── api/               # @pulse/api — Fastify ingest route + SSE stream
│   ├── worker/            # @pulse/worker — BullMQ processors + agent alert evaluation
│   └── web/                # @pulse/web — Next.js dashboard (/dashboard/agents)
├── scripts/
│   └── test-pao-e2e.ts    # manual end-to-end smoke test (see docs/pao-tasks.md, 7.1)
├── docs/                  # pao.md design spec + pao-tasks.md task tracker
├── docker-compose.yml     # TimescaleDB + Redis for local dev
└── .env.example
```

## Current status

- `npm run build`, `npm run lint`, and `npm run test` all pass cleanly across
  every workspace (`@pulse/agent`, `@pulse/api`, `@pulse/db`, `@pulse/types`,
  `@pulse/web`, `@pulse/worker`).
- The ingestion API, BullMQ worker, dashboard pages (run list, run detail,
  span table/graph views, alerts, settings), and both SDKs (TypeScript and
  Python) are implemented and tested.
- See [docs/pao-tasks.md](docs/pao-tasks.md) for the detailed Phase A task
  checklist and implementation notes. Remaining open items: re-verifying
  cross-project data scoping (7.2) and running the e2e smoke test against a
  live deployment (7.1, script provided).

## Local setup

```bash
# 1. Install
npm install

# 2. Start infra (Postgres+TimescaleDB on :5433, Redis on :6380)
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

### Build, lint, test

```bash
npm run build   # turbo run build — builds all 6 workspaces
npm run lint    # turbo run lint  — eslint (api/worker) + next lint (web)
npm run test    # turbo run test  — vitest unit/integration tests
```

## SDK usage

### TypeScript (`@pulse/agent`)

```ts
import { PulseAgent } from '@pulse/agent'

const pulse = new PulseAgent({ apiKey: 'pk_live_...', host: 'http://localhost:3001' })

const run = await pulse.startRun('Summarize quarterly report')
const span = run.startSpan('llm_call', { name: 'gpt-4o completion', model: 'gpt-4o' })
span.end({ inputTokens: 210, outputTokens: 145, costUsd: 0.0053, status: 'success' })
await run.complete({ status: 'completed' })
```

### Python (`pulse-agent`)

```python
from pulse_agent import PulseAgent

pulse = PulseAgent(api_key="pk_live_...", base_url="http://localhost:3001")

run = pulse.start_run("Summarize quarterly report")
span = run.start_span("llm_call", model="gpt-4o")
span.end(input_tokens=210, output_tokens=145, cost_usd=0.0053, status="success")
run.complete(status="completed")
```

Set `PULSE_DISABLED=true` to turn either SDK into a no-op (e.g. in tests).

## Deploying PAO on free tiers

PAO has five pieces to host: Postgres (+ optionally the TimescaleDB
extension), Redis, the Fastify API, the BullMQ worker, and the Next.js
dashboard. A workable free/trial combination for a ~1 month deployment:

| Component | Suggested provider | Notes |
| --- | --- | --- |
| Postgres | [Neon](https://neon.tech) (free tier) | Standard Postgres, generous free tier, autosuspend on idle. **No TimescaleDB extension** — the app works fine without the `agent_spans` hypertable (task 1.3 is an optional perf optimization), just skip that migration step. |
| Postgres (with TimescaleDB) | [Timescale Cloud](https://www.timescale.com) free trial, or self-hosted `timescale/timescaledb` image on Railway/Fly | Use if you specifically want the hypertable from `0002_agent_spans_hypertable`. |
| Redis | [Upstash](https://upstash.com) (free tier) | Use the TCP/Redis-protocol endpoint (not REST) so `ioredis`/BullMQ work unchanged — just set `REDIS_URL` to the `rediss://` connection string. |
| `apps/api` + `apps/worker` | [Railway](https://railway.app) (free trial credit) | Both need to run as always-on Node processes (the worker has no HTTP port and just consumes the queue). Railway's trial credit covers small services for roughly a month; deploy each as its own service from this repo with `npm run build -w apps/api` / `-w apps/worker` and `npm run start -w apps/api` etc. |
| `apps/web` | [Vercel](https://vercel.com) (Hobby/free tier) | Best fit for Next.js App Router. Point `INGESTION_API_URL` at the deployed `apps/api` URL. |
| Auth | [Clerk](https://clerk.com) (free tier) | Already wired up via `@clerk/nextjs`; create a free application and copy the keys into `.env`. |
| Email alerts (optional) | [Resend](https://resend.com) (free tier) | Only needed if you want email alert notifications from `apps/worker`. |

Free-tier limits and offerings change frequently — verify current quotas at
sign-up time. For a quick all-in-one demo without juggling five providers,
running everything on a single Railway project (Postgres + Redis + 3 Node
services) using its trial credit is the simplest path, at the cost of the
credit running out sooner than a month under constant load.

## Docs

See [docs/pao.md](docs/pao.md) for the full design spec and
[docs/pao-tasks.md](docs/pao-tasks.md) for the Phase A task tracker.
