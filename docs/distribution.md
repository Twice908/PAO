# PAO Distribution Strategy — Reaching Agents Beyond the SDK

**Status**: Research + plan. No implementation. Written 2026-08-25.

Today PAO reaches agents through two code SDKs:
[`@pulse/agent`](../packages/pulse-agent) (TypeScript) and
[`pulse-agent`](../packages/pulse-agent-py) (Python). Both are thin wrappers
over one HTTP contract. That covers developers who write agent code by hand.

It does not cover the much larger population of agents that are *assembled*
rather than *written*: n8n workflows, Zapier Zaps, Make scenarios, Voiceflow
and Botpress bots. This document plans how PAO gets into those, ranked by
reach-per-unit-effort, with the platform constraints that actually govern
each route.

---

## 1. The one thing that makes this tractable

Every integration below is a wrapper around a single, already-shipped
contract:

```
POST {host}/ingest/agent-span
Authorization: Bearer {apiKey}
Content-Type: application/json

[ { "type": "run_start" | "span" | "run_end", "runId": "...", ... } ]
```

Defined in [agent-span.schema.ts](../apps/api/src/schemas/agent-span.schema.ts),
served by [agent-span.ts](../apps/api/src/routes/ingest/agent-span.ts).

Properties that matter for no-code distribution:

- **Batch-native.** The body is an array. One HTTP call can carry an entire
  run — `run_start`, every span, `run_end` — which is exactly what a
  no-code platform wants, because each HTTP call costs the user an
  operation/task.
- **Fire-and-forget.** The route returns `202` and enqueues without waiting
  ([agent-span.ts:44-50](../apps/api/src/routes/ingest/agent-span.ts#L44-L50)).
  Latency added to the host workflow is one round trip, no processing.
- **Client-generated IDs.** `runId` and `spanId` come from the caller. A
  no-code tool can mint them with its own expression language; no
  pre-registration call is needed.
- **Auth is a single static Bearer token.** No OAuth dance, no refresh. This
  is the cheapest possible auth to express in every platform below.
- **Timestamps are caller-supplied ISO-8601.** Spans can be reported
  *after* the fact, so a workflow can emit its whole trace at the end
  rather than instrumenting inline.

**Implication**: PAO does not need a new backend to reach no-code. It needs
packaging. That is the core insight of this plan.

### 1.1 The gaps to close first

Three things in the current contract will hurt in no-code contexts. These
are prerequisites, listed here and expanded in §7.

| Gap | Why it blocks no-code | Fix |
|---|---|---|
| No documented public OpenAPI spec | Zapier public apps *require* public API docs; Make's app editor imports from OpenAPI | Publish a spec for the ingest route |
| Rate limit is 100 req / 10s per key ([rate-limit.ts](../apps/api/src/plugins/rate-limit.ts)) | Fine for batched runs, tight for per-node emission from a busy n8n instance | Keep, and make batching the documented default |
| No OTLP ingest endpoint | n8n emits OpenTelemetry natively — see §2.1 — and we currently cannot consume it | Add an OTLP/HTTP translator (highest-leverage single item in this doc) |

---

## 2. n8n — highest priority

n8n is the highest-value target: open source, self-hostable, npm-based
extension model, and a large base of users building AI agents with its
native Agent node. There are **four** distinct routes in, and they are not
alternatives — they serve different users.

### 2.1 Route A: OTLP ingest (zero-code, highest leverage)

This is the most important finding of this research.

n8n ships **native OpenTelemetry tracing**, added in v2.19.0 (UI config in
2.27.0). Configured with two env vars:

```
N8N_OTEL_ENABLED=true
N8N_OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector>:4318
```

It emits two span types — `workflow.execute` (one per execution) and
`node.execute` (one per node, nested) — over **OTLP HTTP + protobuf**,
appending `/v1/traces` to the endpoint. Optional auth headers via
`N8N_OTEL_EXPORTER_OTLP_HEADERS`. Sampling via
`N8N_OTEL_TRACES_SAMPLE_RATE`.

Crucially, **agent tracing landed in n8n 2.33.0** behind
`N8N_AGENTS_TRACING_ENABLED=true`, capturing agent runs and tool calls
using **OpenTelemetry GenAI semantic conventions**, with prompt/response
recording toggled by `N8N_AGENTS_TRACING_RECORD_INPUTS` /
`..._RECORD_OUTPUTS`.

That is a near-exact structural match for PAO's data model:

| n8n OTel | PAO |
|---|---|
| `workflow.execute` span | `run_start` + `run_end` |
| `node.execute` span | `span` |
| GenAI agent/LLM span | `spanType: 'llm_call'` |
| GenAI tool span | `spanType: 'tool_call'` |
| `gen_ai.usage.*_tokens` | `inputTokens` / `outputTokens` |
| span status error | `status: 'error'` + `errorMessage` |
| trace/span/parent IDs | `runId` / `spanId` / `parentSpanId` |

**The play**: add `POST /ingest/otlp/v1/traces` to
[apps/api](../apps/api) that accepts OTLP protobuf/JSON, maps GenAI
semconv attributes onto `AgentSpanPayload`, and enqueues onto the existing
`agent-spans` queue. Then a user's entire onboarding is:

```
N8N_OTEL_ENABLED=true
N8N_AGENTS_TRACING_ENABLED=true
N8N_OTEL_EXPORTER_OTLP_ENDPOINT=https://api.usepulse.dev/ingest/otlp
N8N_OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer pk_live_...
```

No node to install. No workflow to edit. Every existing workflow becomes
observable at once.

**Caveats, honestly stated:**
- OTel tracing in n8n is **self-hosted only**, not n8n Cloud. Custom span
  attributes are self-hosted *Enterprise* only.
- The GenAI conventions themselves are still **experimental / Development
  status** as of 2026; attribute names can shift between versions, and
  `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` gates newer
  attribute sets. The mapper must be version-tolerant and treat unknown
  attributes as `metadata`, never fail a span.
- Cost (`costUsd`) is generally *not* in the OTel payload. PAO would need a
  server-side pricing table keyed on `gen_ai.request.model` to derive it.
  This is worth building regardless — see §7.3.

**Strategic value beyond n8n**: an OTLP endpoint is not an n8n feature. It
simultaneously makes PAO a drop-in backend for LangChain/LlamaIndex via
OpenLLMetry, OpenInference instrumentors, Traceloop, and anything else in
the OTel ecosystem — the entire code-agent world that isn't using our SDK.
One endpoint, many ecosystems. **This is the single highest-ROI item in
this document.**

### 2.2 Route B: `n8n-nodes-pao` community node

The canonical, discoverable path. Published to npm, tagged
`n8n-community-node-package`, named `n8n-nodes-pao`.

Planned node surface:

- **PAO Trace (action)** — one node, operations: `Start Run`, `Log Span`,
  `End Run`. Accepts run/span IDs so users can thread them through a
  workflow with expressions.
- **PAO Wrap (action)** — the ergonomic version: drop it at the end of a
  workflow, point it at `$execution` data, and it emits an entire run in
  one call. This is the one most users will actually use, because it costs
  one node and one HTTP call.
- **Credential type** — `paoApi`, fields: API key (password-typed), host
  (defaults to production). Reused across nodes.

**Verification requirements to design for from day one** (n8n's published
guidelines):
- Verified nodes may use **no runtime dependencies** — trivially satisfied,
  since [`@pulse/agent`](../packages/pulse-agent) is already zero-runtime-dep
  and the node can inline `fetch`.
- Package license must be **MIT**.
- One package integrates **exactly one** third-party service — satisfied.
- **From 1 May 2026, verified nodes must be published via GitHub Actions
  with an npm provenance statement**; publishing from a local machine is
  rejected. Scaffold with `npm create @n8n/node`, which ships a
  ready-made `publish.yml`.

So the node repo must be its own public GitHub repo with a provenance
release workflow — not buried in this monorepo's private release path.
Plan for a dedicated `pao-n8n-nodes` repository.

### 2.3 Route C: external hooks (zero-touch, self-hosted)

n8n supports backend hooks registered via `EXTERNAL_HOOK_FILES` (colon-
separated paths). Relevant hooks: `workflow.preExecute`,
`workflow.postExecute`, plus `n8n.ready` / `n8n.stop` for lifecycle.
`workflow.preExecute` receives `[workflow, mode, workflowContext]`.

Ship `pao-n8n-hook.js` — a single file a self-hoster drops in and points
the env var at. It instruments **every workflow on the instance** with no
per-workflow edits. Lower fidelity than OTel (no per-node spans without
extra work) but useful where OTel is unavailable or unwanted, and it is a
~100-line artifact.

Priority: below A and B. It is a nice asset for the docs, not a headline.

### 2.4 Route D: LangChain Code node callbacks

n8n's LangChain Code node allows configuring callbacks, which is precisely
how the existing Langfuse community nodes
(`n8n-nodes-ai-agent-langfuse`) attach tracing to `AgentExecutor` and
`ToolCallingAgent`. A PAO callback handler would slot in the same way and
capture LLM reasoning, tool calls, and token usage inside the agent node.

Treat this as the **fallback fidelity path** for users on n8n versions
below 2.33.0 (pre-agent-tracing), and as a recipe in docs rather than a
shipped product.

### 2.5 Competitive read

The n8n tracing space is real but fragmented: multiple competing community
nodes (`rorubyy/n8n-nodes-ai-agent-langfuse`, `Diward/n8n-nodes-agent-langfuse`,
a `@talabes` fork), and Langfuse's own official node is
**limited to prompt fetching — it does not provide tracing**. Opik, SigNoz,
Last9, and OpenObserve all document n8n-via-OTLP.

Two conclusions: (a) OTLP is the established, expected path — matching it
is table stakes; (b) nobody has shipped a clean, verified, first-party
agent-observability node. That slot is open.

---

## 3. Zapier

Largest audience, most constrained surface, and the **slowest** to publish.
Plan accordingly: build for private/embedded use first, treat public
listing as a later milestone.

### 3.1 What we build

A **Zapier CLI integration** (`zapier-platform-cli`), version-controlled
and CI-deployable. Surface:

- **Action: Log Agent Run** — one action, fields for task, status, and a
  line-item list of spans. Emits one batched array to the ingest route.
- **Action: Start Run / End Run** — for multi-step Zaps that need to
  bracket work.
- **Auth: API Key** — Zapier prefers OAuth2, but API key is explicitly
  supported and is the honest fit for a static ingest token.

### 3.2 The publishing reality

Zapier's public-integration bar is high and worth stating plainly:

- HTTPS on every endpoint, **no exceptions**; production endpoints only —
  no staging or sandbox.
- The product itself must be **publicly launched**; invite-only or beta
  products **cannot** publish a public integration.
- **Public API documentation** must exist and be current for every endpoint
  used.
- No hard-coded credentials.
- **At least 10 published Zap templates**, and **50 active users** before
  public listing — though the 50-user requirement can be **waived if the
  integration is embedded in-product behind a login screen**.

Given PAO's current stage, the sequence is: build the CLI integration →
use it privately / share via invite link → embed it in the PAO dashboard
to pursue the user-count waiver → publish.

### 3.3 Runtime constraints for the Code-step fallback

Before the app exists, users can call PAO from **Code by Zapier**. Design
docs around real limits: Code steps time out at **10s on Starter** and
**30s on Pro/Team/Company**, and every action's `perform` must finish in
30s. Since PAO ingest returns `202` immediately, this is comfortable — but
docs should say "batch the whole run into one call at the end", never
"call PAO per step", which would burn both tasks and time budget.

---

## 4. Make (Integromat)

Make has **no code block**, so the entire integration must be declarative.
Fortunately Make's custom-app model is JSON-configured, which suits us.

### 4.1 What we build

A Make **custom app**, defined by its five building blocks: `base` (shared
HTTP settings — host, the `Authorization` header), `connections` (API-key
connection), `modules` (the actions), `rpcs` (dynamic dropdowns), and
`webhooks`.

Modules to ship:
- **Log Agent Run** — accepts a JSON array of spans; note Make's JSON
  parameter type auto-converts input to a real object/array, which lines up
  with our batch body.
- **Start Run** / **End Run**.

Build with the Make Apps Editor / VS Code extension, which syncs local JSON
against Make's backend.

Avoid depending on **custom IML functions** — they are not enabled by
default and require contacting Make's helpdesk. Everything should work with
stock IML expressions.

### 4.2 Publishing path

Make's **Community Apps** program is the pragmatic route: accepted
community apps must be public but **do not require full approval**, and are
listed alongside approved apps on the Integrations page. There is also an
Apps Marketplace beta for partners. Start with Community Apps; pursue
Technology Partner / full approval later.

### 4.3 Interim path

Make's **HTTP module** already works today with zero PAO effort. It is the
"best pulse hook" for Make until the app ships — a documented recipe, not a
product.

---

## 5. Voiceflow / Botpress and other closed builders

Split these two; they are not equivalent.

**Botpress** is the better target: it has a real SDK/ADK, full API access,
open-source integrations on GitHub, and a documented path to
**publish an integration on the Botpress Hub**. Plan a proper PAO
integration here, sized between the Make and Zapier efforts.

**Voiceflow** is effectively closed for custom nodes. The realistic hook is
its **API/function step** calling PAO's ingest route directly — a
documented recipe plus a copy-paste snippet, not a shipped artifact.

For everything else in this tier (Flowise, Dify, Relevance, Lindy, Gumloop,
Stack AI, Retool Workflows): the answer is the **universal webhook recipe**
of §6. Do not build bespoke apps for the long tail.

---

## 6. The universal fallback: one documented HTTP recipe

Every platform in the table has an HTTP/webhook module. That means PAO is
*already* integrable everywhere today — the missing piece is documentation,
not code.

Ship a single canonical recipe page: URL, header, and a copy-paste JSON
body with `run_start` + spans + `run_end` in one array, plus each
platform's expression syntax for generating a UUID and an ISO timestamp
(n8n `{{ $now.toISO() }}`, Make `now`, Zapier's JS, etc.).

This is the cheapest deliverable in this document and should ship **first**,
because it unblocks every platform simultaneously and doubles as the spec
that every later connector is validated against.

**Shipped** — [http-recipe.md](./http-recipe.md). Covers the one-call batch
body, the two values a caller must generate (`runId`, `startedAt`) with each
platform's expression syntax, the bare-object fallback for HTTP modules that
cannot send a top-level array, per-platform notes (n8n's zero-code OTLP route
first, since it beats hand-building), a full field reference, and an error
table keyed on what actually goes wrong. Every JSON payload in it was validated
against the real Zod schema before publishing.

The rendered spec is hosted alongside it — see §7.2.

---

## 7. Prerequisites in the PAO core

Work that must land in this repo to support the above.

> **Progress (2026-08-27)**: **all core prerequisites are done** — §7.1,
> §7.2, §7.3 and §7.4, along with three silent-data-loss bugs found while
> implementing them (see §7.6). The universal HTTP recipe (§6) and public
> hosting of the rendered spec have now shipped too, so phases 2–6 are
> per-platform packaging with nothing left blocking them in the core.

### 7.1 OTLP trace ingest endpoint — **DONE**
`POST /ingest/otlp/v1/traces`
([otlp-traces.ts](../apps/api/src/routes/ingest/otlp-traces.ts)) accepts OTLP
over HTTP in **both protobuf and JSON**, with gzip, reusing the existing
API-key auth and `agent-spans` queue. Verified end-to-end against the real
`@opentelemetry/exporter-trace-otlp-proto` and `...-otlp-http` exporters, not
just fixtures.

Implementation notes:

- **No new dependencies.** Protobuf is decoded by a ~150-line reader
  ([protobuf.ts](../apps/api/src/lib/otlp/protobuf.ts)) covering only the
  OTLP trace subset, keeping the API's dependency surface unchanged and
  leaving the logic embeddable in a verified n8n node later (§2.2 forbids
  runtime deps).
- **GenAI semconv mapping** lives in
  [map-span.ts](../apps/api/src/lib/otlp/map-span.ts):
  `gen_ai.operation.name` drives the span type, with fallbacks to
  tool/model attributes and the span name. Deprecated spellings
  (`prompt_tokens`/`completion_tokens`) and OpenInference's `llm.*`
  attributes are accepted alongside the current names.
- **Forward-compatible by construction.** Every attribute is carried into
  `metadata`, so an attribute rename in the still-experimental GenAI spec
  degrades one field rather than losing the data. No unknown attribute can
  reject a span.
- **Runs are synthesised.** OTLP has no run concept, so a root span expands
  into `run_start` + `run_end`, and the root is not re-emitted as a child
  span (which would double-count its tokens).
- **Partial success, not failure.** Unmappable spans are reported via
  OTLP's `partialSuccess` on a `200`, matching what exporters expect.

Cost is not carried by OTLP in practice — §7.3's derivation supplies it.

**Strategic payoff, as planned**: this single endpoint also makes PAO a
drop-in backend for OpenLLMetry, OpenInference, Traceloop, and any other
OTel-instrumented agent, not just n8n.

### 7.2 Public OpenAPI spec + public docs — **DONE**
[`apps/api/openapi/openapi.yaml`](../apps/api/openapi/openapi.yaml) is an
OpenAPI 3.1 description of the public ingest surface: `/ingest/agent-span`,
`/ingest/otlp/v1/traces`, and `/health`. Dashboard endpoints authenticated
with a Clerk session are deliberately excluded — they are not part of the
integration contract.

It carries what an integration author actually needs: the run/span/run_end
model, worked request examples (a whole run in one call, an incremental run,
a failed run), the full GenAI attribute mapping table for OTLP, error shapes
with real `code` values, and the rate-limit and batching guidance.

**The spec is tested, not just written.**
[`openapi-contract.test.ts`](../apps/api/src/schemas/openapi-contract.test.ts)
asserts every documented claim against the real Zod schema — each request
example must validate, all three enums must match, required and optional
fields must behave as documented, and the preview length limit must hold.
Drift fails the build. This matters because a public spec that quietly
disagrees with the code is worse than no spec: Zapier requires *current*
public docs to publish, and Make imports app definitions from it.

`npm run openapi:lint -w apps/api` validates it with Redocly;
`openapi:preview` serves rendered docs. Two advisory warnings remain, both
non-issues: a false positive on the production hostname, and a missing 4xx on
the liveness probe.

**Hosting — done.** `apps/web` serves both at build time via
[`scripts/build-api-docs.mjs`](../apps/web/scripts/build-api-docs.mjs), run from
`prebuild`/`predev`:

- `/docs/api` — the rendered reference (redocly `build-docs`, prerendered, with
  a version-pinned SRI-hashed Redoc bundle, so there is no unpinned third-party
  script and no 1 MB vendored blob in the repo).
- `/openapi.yaml` — the raw spec, for Make's importer and Zapier reviewers.

Both are generated into `public/` from `apps/api/openapi/openapi.yaml` and are
gitignored, so the spec has exactly one source of truth. Neither path is matched
by the Clerk `isProtectedRoute` matcher, so both are public; `/docs/api` needs a
rewrite in `next.config.js` because Next does not resolve an extensionless path
to `index.html` in `public/`.

Remaining: these resolve under the web app's current deployment hostname. Point
them at a stable custom domain before Zapier submission, which requires public
API docs to stay current at a durable address.

### 7.3 Server-side cost derivation — **DONE**
[`apps/worker/src/lib/pricing.ts`](../apps/worker/src/lib/pricing.ts) holds a
model→price table (Anthropic, OpenAI, Google) and
[`agent-span.processor.ts`](../apps/worker/src/processors/agent-span.processor.ts)
applies it whenever `costUsd` is absent. An explicitly supplied `costUsd`
always wins, so SDK behaviour is unchanged. Unknown models and spans with no
token counts leave `costUsd` **null rather than 0**, so a missing price is
never mistaken for a free call.

Model names are normalised (vendor prefix stripped, `.`/`_`→`-`, longest key
wins) so `anthropic/claude-sonnet-4-20250514` and `gpt-4o-mini` both resolve
correctly — the latter must not fall through to `gpt-4o`.

### 7.4 Ingest ergonomics for hand-built callers — **DONE**
Four changes landed in
[agent-span.ts](../apps/api/src/routes/ingest/agent-span.ts):

- **`spanId` is minted server-side** when omitted — no-code callers often
  have no UUID generator.
- **A bare object is accepted** as a one-element batch; several no-code HTTP
  modules cannot express a top-level JSON array.
- **Offset timestamps are accepted.** Zod's `.datetime()` rejects
  `2026-01-01T00:00:00+05:30`, which is the *default* output of n8n's
  `{{ $now.toISO() }}` and Make's `now`. This alone would have rejected the
  majority of no-code traffic.
- **Errors report `index`, `field`, and `message`** per issue instead of one
  opaque Zod string, so a failure is debuggable from an expression editor.

Batch-level rejection was kept deliberately: partial success would let a
caller believe a run was recorded when spans were dropped. A `400` naming the
offending index is the honest signal.

### 7.6 Silent-data-loss bugs found and fixed — **DONE**
Three defects that would have surfaced as "PAO randomly loses my runs" or
"my runs are named wrong" the moment non-SDK callers arrived:

1. **Spans missing `spanType`/`name` returned `202`, then died in the
   worker.** Both columns are non-nullable in
   [schema.prisma](../packages/db/prisma/schema.prisma), but the ingest
   schema marked them optional and the processor asserted them non-null with
   `!`. Such a span passed validation, got queued, failed its DB write,
   retried 3×, and dead-lettered — while the caller saw success. The SDK
   always sets them, so only hand-built callers could trigger it.
2. **Run and span statuses were interchangeable.** The flat schema accepted
   `status: 'success'` on a `run_end`, which the worker wrote verbatim into
   `AgentRun.status`, producing runs no dashboard filter matches. The
   repo's own test fixture contained this exact invalid payload.

3. **Per-span OTLP exports invented bogus runs.** `SimpleSpanProcessor` —
   and any partial flush — sends each span in its own HTTP request, so child
   spans routinely arrive before their root. The first decoder revision
   opened a run for any trace lacking a root *in that batch*, so a batch of
   children named the run after a child. Because the worker's `run_start`
   upsert keeps whichever lands first, the wrong name was permanent. Caught
   only by exporting from the real OTel SDK, never by fixtures. Fixed on both
   sides: the decoder synthesises a run only for **parentless** spans, and
   `handleRunStart` now backfills the task onto a placeholder run instead of
   ignoring it.

Bugs 1 and 2 are fixed by replacing the flat schema with a **discriminated union** on
`type` in
[agent-span.schema.ts](../apps/api/src/schemas/agent-span.schema.ts), so each
variant carries only its legal fields and each status enum is scoped to its
level. Rejection now happens at the edge, where the caller can see it.

### 7.5 Rate-limit guidance — **P2**
100 req / 10s per key is fine for batched runs and tight for per-node
emission. Document batching as the default; consider a higher ceiling for
OTLP, where a busy n8n instance legitimately pushes many exports.

---

## 8. Sequencing

| Phase | Deliverable | Why here |
|---|---|---|
| — | ~~Ingest hardening (§7.3, §7.4, §7.6)~~ — **done** | Prerequisite for all of the below; no-code callers would otherwise hit silent drops and \$0 costs |
| — | ~~OpenAPI spec (§7.2)~~ — **done** | Prerequisite for Zapier publishing and Make app import |
| — | ~~Universal HTTP recipe docs (§6) + host the rendered spec publicly~~ — **done** | Zero backend work, unblocked every platform at once |
| — | ~~**OTLP ingest** (§7.1) + cost derivation (§7.3)~~ — **done** | Highest leverage in the document; unlocks n8n zero-config *and* the whole OTel code-agent ecosystem |
| 2 | `n8n-nodes-pao` (§2.2) in its own repo with provenance CI | **Next.** Canonical discoverable presence on the most extension-friendly platform |
| 3 | n8n external hook file (§2.3) | Zero-touch option for self-hosters who cannot use OTLP |
| 4 | Make custom app → Community Apps (§4) | Declarative, moderate effort, no code-block constraint to fight |
| 5 | Zapier CLI integration, private/embedded (§3) | Largest audience but longest publishing tail; start the clock, don't block on it |
| 6 | Botpress Hub integration (§5) | Real SDK, real hub, smaller audience |

**Rationale for the ordering**: phases 0 and 1 are the only ones whose
value is not confined to a single platform. Everything from phase 2 onward
is per-platform packaging with per-platform review queues, so the two
universal items go first.

---

## 9. Open questions

1. **Do we ingest OTel natively, or translate?** Native OTLP ingest is
   proposed above. The alternative — shipping a PAO OTel *exporter* users
   add to their collector — is more work for the user and less magic. This
   plan assumes native ingest; worth confirming before phase 1.
2. **n8n Cloud users get nothing from Route A**, since OTel tracing is
   self-hosted only. Does the community node (Route B) adequately cover
   them, or does n8n Cloud need its own answer?
3. **Zapier public listing requires PAO to be publicly launched** and to
   have public API docs. That is a company-stage gate, not an engineering
   one. Confirm the timeline before investing in phase 5.
4. **How much does the dashboard need to change** to render workflow-shaped
   runs (nodes, branches, retries) versus code-agent runs? A `node.execute`
   tree is not shaped like an LLM/tool span tree, and the run-detail view
   may need a workflow-aware mode.
5. **Attribute-churn policy** for experimental GenAI semconv — how
   aggressively do we track new attribute versions, and do we support both
   old and new names simultaneously?

---

## Sources

- [Submit community nodes | n8n Docs](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes)
- [Community node verification guidelines | n8n Docs](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines)
- [External hooks | n8n Docs](https://docs.n8n.io/deploy/host-n8n/configure-n8n/external-hooks/)
- [Trace executions with OpenTelemetry | n8n Docs](https://docs.n8n.io/deploy/host-n8n/keep-n8n-running/trace-executions-with-opentelemetry)
- [Trace n8n workflow and node executions with OpenTelemetry | n8n Blog](https://blog.n8n.io/trace-n8n-workflow-and-node-executions-with-opentelemetry/)
- [LangChain in n8n | n8n Docs](https://docs.n8n.io/build/integrate-ai/langchain-in-n8n)
- [n8n-nodes-ai-agent-langfuse](https://github.com/rorubyy/n8n-nodes-ai-agent-langfuse)
- [Zapier public integration publishing](https://docs.zapier.com/platform/publish/public-integration)
- [Zapier action timeouts](https://docs.zapier.com/integrations/build/troubleshoot-action-timeouts)
- [Increased Code by Zapier timeouts and throttle limits](https://help.zapier.com/hc/en-us/articles/14166919366413-Run-more-Code-by-Zapier-steps-with-increased-timeouts-and-throttle-limits)
- [zapier-platform-cli](https://github.com/zapier/zapier-platform-cli)
- [Make custom apps documentation](https://developers.make.com/custom-apps-documentation)
- [Make app structure — RPCs](https://developers.make.com/custom-apps-documentation/app-structure/rpcs)
- [Make custom IML functions](https://developers.make.com/custom-apps-documentation/app-components/iml-functions)
- [About Make Community Apps](https://developers.make.com/custom-apps-documentation/community-apps/about)
- [Publish your integration on Botpress Hub](https://www.botpress.com/docs/for-developers/sdk/integration/publish-your-integration-on-botpress-hub)
- [OpenInference vs OpenTelemetry GenAI for agent tracing | Arthur](https://www.arthur.ai/column/openinference-vs-opentelemetry-genai-conventions-agent-tracing)
- [OpenTelemetry GenAI semantic conventions status, 2026](https://dev.to/azena-ai/opentelemetrys-genai-semantic-conventions-are-not-stable-yet-heres-what-actually-shipped-in-2026-3mke)
