# The universal HTTP recipe — send agent telemetry to PAO from anywhere

**Audience**: anyone on a platform PAO has no dedicated connector for — n8n,
Make, Zapier, Voiceflow, Botpress, Flowise, Dify, Relevance, Lindy, Gumloop,
Stack AI, Retool Workflows, or a plain `curl`.

Every one of those has an HTTP or webhook step. That is all PAO needs. This
page is the copy-paste recipe, plus the expression syntax each platform uses
for the two values you have to generate yourself: a run ID and a timestamp.

Reference documentation for the endpoints below is published at
**<https://pao-web-beta.vercel.app/docs/api>**, and the machine-readable OpenAPI 3.1
spec at **<https://pao-web-beta.vercel.app/openapi.yaml>** (import that into Make, or
link it from a Zapier submission).

> These docs URLs follow the web app's current deployment hostname. Move them to
> a stable custom domain before submitting to Zapier, whose review requires
> public API documentation to stay current at a durable address.

---

## 1. The whole thing in one call

One HTTP request records an entire agent run. Configure your platform's HTTP
module like this:

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `https://api.usepulse.dev/ingest/agent-span` |
| Header | `Authorization: Bearer pk_live_...` |
| Header | `Content-Type: application/json` |
| Body | the JSON array below |

```json
[
  {
    "type": "run_start",
    "runId": "exec-1042",
    "startedAt": "2026-08-27T10:15:00+05:30",
    "agentName": "support-triage",
    "task": "Classify inbound ticket #8813"
  },
  {
    "type": "span",
    "runId": "exec-1042",
    "startedAt": "2026-08-27T10:15:00+05:30",
    "endedAt": "2026-08-27T10:15:03+05:30",
    "spanType": "llm_call",
    "name": "Classify intent",
    "model": "claude-sonnet-4-20250514",
    "inputTokens": 812,
    "outputTokens": 96,
    "status": "success"
  },
  {
    "type": "span",
    "runId": "exec-1042",
    "startedAt": "2026-08-27T10:15:03+05:30",
    "endedAt": "2026-08-27T10:15:04+05:30",
    "spanType": "tool_call",
    "name": "zendesk.addTag",
    "status": "success"
  },
  {
    "type": "run_end",
    "runId": "exec-1042",
    "startedAt": "2026-08-27T10:15:00+05:30",
    "endedAt": "2026-08-27T10:15:04+05:30",
    "status": "completed"
  }
]
```

A `202` means the batch was accepted and queued. Ingest is asynchronous, so the
run is not queryable the instant the response arrives.

### Why one call, at the end

Send the whole run in a single request at the end of your workflow rather than
one request per step. On every platform in this document that decision matters:

- **It costs one operation/task instead of N.** Make, Zapier, and n8n Cloud all
  bill per module execution.
- **It stays inside the rate limit.** 100 requests / 10 seconds per API key.
  Batched runs never approach it; per-step emission from a busy instance does.
- **It adds one round trip of latency to your workflow, not N.**

`startedAt` is caller-supplied, so reporting after the fact is fully supported —
spans do not have to be sent while the work is happening.

---

## 2. The two values you must generate

Everything else in the payload is a literal you already have. These two need
your platform's expression language.

### `runId` — ties the payloads together

Any non-empty string. It does **not** need to be a UUID, and there is no
registration call: the first payload carrying a new `runId` creates the run.

Prefer an ID your platform already has — an execution ID is ideal, because it
makes a PAO run traceable back to the exact workflow execution.

| Platform | Expression |
|---|---|
| n8n | `{{ $execution.id }}` |
| Make | `{{executionId}}` (system variable) |
| Zapier (Code step) | `crypto.randomUUID()` |
| Voiceflow | any variable you set at the start of the conversation |
| Botpress | a conversation/session ID from the event payload |
| curl / anything | any string you choose |

### `startedAt` / `endedAt` — ISO-8601 timestamps

Offset forms such as `2026-08-27T10:15:00+05:30` are accepted, which matters
because that is the *default* output of both n8n's and Make's now-expressions.
`Z` (UTC) form works equally well.

| Platform | Expression |
|---|---|
| n8n | `{{ $now.toISO() }}` |
| Make | `{{formatDate(now; "yyyy-mm-ddThh:mm:ssz")}}` |
| Zapier (Code step) | `new Date().toISOString()` |
| Voiceflow / Botpress | `new Date().toISOString()` in a function step |
| curl | `date -u +%Y-%m-%dT%H:%M:%SZ` |

`spanId` you do **not** need to generate — PAO mints one server-side when you
omit it. Supply your own only if you need `parentSpanId` to nest spans.

---

## 3. Platform notes

Only the things that actually bite.

### If your HTTP module cannot send a top-level JSON array

Several no-code HTTP modules can only express a JSON *object* as a body. PAO
accepts a bare object as a one-element batch, so send the payloads one at a
time:

```json
{
  "type": "run_start",
  "runId": "exec-1043",
  "startedAt": "2026-08-27T10:20:00Z",
  "task": "Nightly digest"
}
```

This costs one call per payload, so use the array form wherever the platform
allows it.

### n8n

Before hand-building anything, check whether the **zero-code OTLP route**
covers you. Self-hosted n8n emits OpenTelemetry natively, and PAO ingests it
directly — no workflow edits, every existing workflow becomes observable:

```
N8N_OTEL_ENABLED=true
N8N_AGENTS_TRACING_ENABLED=true
N8N_OTEL_EXPORTER_OTLP_ENDPOINT=https://api.usepulse.dev/ingest/otlp
N8N_OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer pk_live_...
```

Agent tracing requires n8n 2.33.0+. OTel tracing is **self-hosted only** — on
n8n Cloud, use the HTTP Request node with the recipe above.

### Make

The **JSON** parameter type auto-converts its input into a real array, which is
what the batch body needs — use it rather than pasting a string. The
[OpenAPI spec](https://pao-web-beta.vercel.app/openapi.yaml) can be imported directly
in the Apps Editor.

### Zapier

Use **Code by Zapier** with `fetch`. Code steps time out at 10s on Starter and
30s on Pro and above, and every action must finish within 30s. PAO returns
`202` without waiting for processing, so a batched call sits comfortably inside
that — but a per-step call pattern can burn both the task and the time budget.

### Voiceflow

There is no custom-node surface. Use the **API step** (or a function step) with
the recipe above, keeping `runId` in a session variable so every step of a
conversation lands in one run.

### Anything else

Flowise, Dify, Relevance, Lindy, Gumloop, Stack AI, Retool Workflows and the
rest: the recipe in §1 is the integration. There is nothing platform-specific
to install.

---

## 4. Field reference

Only `type`, `runId` and `startedAt` are required on every payload. Full
details, including the OTLP attribute mapping, are at
<https://pao-web-beta.vercel.app/docs/api>.

### `run_start`

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `"run_start"` |
| `runId` | yes | any non-empty string |
| `startedAt` | yes | ISO-8601, offsets accepted |
| `task` | no | what the agent was asked to do — shown as the run title |
| `agentName` | no | groups runs by agent in the dashboard |
| `metadata` | no | any JSON object |

### `span`

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `"span"` |
| `runId` | yes | must match the run |
| `startedAt` | yes | ISO-8601 |
| `spanType` | yes | `llm_call`, `tool_call`, `memory_read`, `agent_message`, `error` |
| `name` | yes | non-empty; the label in the trace view |
| `endedAt` | no | omit for a zero-duration event |
| `spanId` | no | minted server-side when omitted |
| `parentSpanId` | no | set to nest a span under another |
| `model` | no | enables automatic cost derivation |
| `inputTokens` / `outputTokens` | no | non-negative integers |
| `costUsd` | no | supply only if you already know it; otherwise PAO derives it |
| `inputPreview` / `outputPreview` | no | max 500 characters |
| `status` | no | `success`, `error`, `timeout` |
| `errorMessage` | no | pair with `status: "error"` |

### `run_end`

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `"run_end"` |
| `runId` | yes | must match the run |
| `startedAt` | yes | ISO-8601 |
| `endedAt` | no | run completion time |
| `status` | no | `completed`, `failed`, `interrupted` |
| `errorMessage` | no | pair with `status: "failed"` |

> **Run status and span status are different enums.** `success` is a *span*
> status; a run uses `completed`. Sending `status: "success"` on a `run_end` is
> rejected rather than silently stored as a status no dashboard filter matches.

### Recording a failure

```json
[
  {
    "type": "span",
    "runId": "exec-1044",
    "startedAt": "2026-08-27T10:20:05Z",
    "spanType": "tool_call",
    "name": "crm.lookup",
    "status": "error",
    "errorMessage": "Upstream 503 from CRM"
  },
  {
    "type": "run_end",
    "runId": "exec-1044",
    "startedAt": "2026-08-27T10:20:00Z",
    "endedAt": "2026-08-27T10:20:09Z",
    "status": "failed",
    "errorMessage": "Upstream 503 from CRM"
  }
]
```

---

## 5. When it does not work

A batch is validated in full before acceptance: it is either queued entirely or
rejected with a `400`. Nothing is partially dropped behind a success code.

A `400` names the offending element, which is what makes this debuggable from
an expression editor:

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "One or more payloads failed validation",
    "issues": [
      { "index": 1, "field": "spanType", "message": "Required" }
    ]
  }
}
```

`index` is the position in the array you sent; `field` is the offending
property.

| Status | Meaning | Fix |
|---|---|---|
| `202` | accepted and queued | nothing — this is success |
| `400` | payload failed validation | read `issues[].index` and `issues[].field` |
| `401` | `UNAUTHORIZED` — missing/malformed header | send `Authorization: Bearer pk_live_...` |
| `401` | `INVALID_KEY` — key not recognised | re-copy the key from the dashboard |
| `429` | rate limited | batch the run into one call (§1) |

Common causes, in the order they actually occur:

1. **`status: "success"` on a `run_end`.** Use `completed`.
2. **Missing `spanType` or `name` on a span.** Both are required.
3. **A timestamp that is not ISO-8601.** `2026-08-27 10:15:00` is not; use your
   platform's ISO expression from §2.
4. **The word `Bearer` omitted** from the Authorization header.
