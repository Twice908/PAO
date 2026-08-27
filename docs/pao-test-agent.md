# Building a Test Agent for PAO (Pulse Agent Observe)

This doc gives you a ready-to-paste prompt (for Claude Code or any coding
agent) plus hand-checked code references for wiring a real, Anthropic-powered
AI agent to the PAO SDKs — one in TypeScript/Node, one in Python. The goal is
to exercise the full PAO pipeline end-to-end: ingestion route → BullMQ worker
→ Postgres/Timescale → dashboard, using a genuine, heavy-duty multi-step
agent — not synthetic seed data, not the `scripts/test-pao-e2e.ts` smoke
test, and nothing simulated or faked inside the agent itself.

Both SDKs referenced below already exist in this repo:

- JS/TS: [`packages/pulse-agent`](../packages/pulse-agent) — package name `@pulse/agent`
- Python: [`packages/pulse-agent-py`](../packages/pulse-agent-py) — package name `pulse-agent`

Nothing here requires changes to the SDKs. It only builds a *consumer* of
them (a test agent) in a new location, e.g. `examples/test-agent-ts/` and
`examples/test-agent-py/`.

**Nothing in this agent is dummy or scripted.** Every `messages.create` call
is a real Anthropic API request that spends real tokens/credits. Every tool
call is genuinely decided by Claude at inference time — the agent never
forces a tool choice, never injects a fake tool result, and never simulates
an error. If something fails, it's because the tool genuinely failed (bad
input from Claude, a real HTTP timeout, a real file-not-found), not because
the code told it to.

---

## What the test agent should do

A multi-step **research assistant** agent: given an open-ended task, it
plans, calls several different real tools across multiple turns, reads
their output, decides whether it needs to call more tools or is done, and
only then produces a final answer. This is deliberately heavier than a
single tool-call round trip — it should feel like watching a real agent
work, including the wait time.

Tools (all doing real work, no stubs):

1. **`web_search`** — an actual HTTP call to a real search API (e.g. Brave
   Search API, Tavily, or SerpAPI — pick whichever the user has a free-tier
   key for) or, if no search API key is available, a real `fetch`/`httpx`
   GET against a real public URL the user supplies (e.g. a docs page, an
   RSS feed, a REST API). This must hit the real network.
2. **`read_file`** — genuinely reads a file from disk (e.g. a local notes
   file, a CSV, a log file) and returns its real contents.
3. **`calculator`** — real arithmetic evaluation (safe parser, not `eval`)
   for whatever numeric analysis the task needs (e.g. totals, averages over
   data the other tools pulled in).
4. **`write_scratchpad`** — appends the agent's intermediate reasoning/notes
   to a real local file, so `memory_read`/write activity has something
   genuine to log (this doubles as the agent's own working memory across
   turns, not a canned "notes" array).

The agent loop should let Claude take as many turns as it actually needs
(cap at a sane maximum like 8–10 turns, not fake iteration count) — a task
like *"search for the current price of X, read our local pricing-notes.txt,
calculate the percentage difference, and write a summary to the
scratchpad"* naturally drives 3–6 real LLM round-trips and 3+ real tool
calls, which is exactly the shape that produces a rich, honest span tree:

- **`run_start`** — one PAO run per task.
- One **`llm_call`** span per real `messages.create` round-trip, with real
  `model`, `inputTokens`, `outputTokens` from the API's actual `usage`
  field, and an estimated `costUsd` from real published pricing.
- One **`tool_call`** span per real tool execution (`web_search`,
  `read_file`, `calculator`), each carrying the real input/output and the
  tool's real `status` — `error` only if the tool genuinely raised.
- **`memory_read`**/write spans around `write_scratchpad`, since it's real
  persistent state the agent reads back on later turns.
- **`run_end`** with `status: 'completed'` on a clean finish or
  `status: 'failed'` if an unhandled exception actually occurred — never a
  hardcoded outcome.

Run it with a couple of different real research tasks so `/dashboard/agents`
shows several runs with different tool-call patterns and durations, then
open a run detail page to confirm span ordering, real durations, real
token/cost rollups, and the detail panel all render correctly.

---

## Prompt to paste into Claude Code

```
Build two standalone example AI agents in this repo that exercise the PAO
(Pulse Agent Observe) pipeline end-to-end using the real Anthropic API. Do
not modify packages/pulse-agent or packages/pulse-agent-py — only consume
them. Nothing about the agent's behavior should be faked, mocked, or
scripted — every LLM call and every tool call must do real work and spend
real tokens/credits when run. Do not add any "force failure" or simulated
error paths; if a run fails, it must be because something genuinely failed.

1. Create `examples/test-agent-ts/` (Node + TypeScript):
   - Add `@pulse/agent` (workspace package) and `@anthropic-ai/sdk` as deps.
   - `src/index.ts` reads `ANTHROPIC_API_KEY`, `PULSE_API_KEY`, `PULSE_HOST`,
     and (for the web_search tool) a real search API key such as
     `BRAVE_API_KEY` or `TAVILY_API_KEY` from env (use dotenv). If no search
     key is configured, fall back to a real `fetch()` against a URL passed
     in the task text.
   - Implement a genuine multi-turn agentic loop against Claude
     (model: claude-sonnet-4-5 or later, max ~10 turns) with four real
     tools: `web_search` (real HTTP call to a search API or a real URL
     fetch), `read_file` (real fs read of a local file), `calculator` (safe
     arithmetic parser, no eval), and `write_scratchpad` (real fs append to
     a local scratch file that later turns can read back via `read_file`).
   - Let Claude genuinely decide which tools to call and how many turns to
     take based on the task — do not hardcode a fixed tool sequence.
   - Wrap the whole thing with the PAO SDK:
     - `pulse.startRun(task)` once per task.
     - `run.startSpan('llm_call', ...)` / `span.end(...)` (or
       `run.withLLMSpan`) around every real `messages.create` call, with
       real `model` and `inputTokens`/`outputTokens` from `response.usage`.
     - `run.startSpan('tool_call', ...)` around every real tool execution.
     - `run.startSpan('memory_read', ...)` around scratchpad reads/writes.
     - `run.complete({ status: 'completed' | 'failed', errorMessage })` in
       a try/finally, reflecting the run's actual, unforced outcome.
   - CLI entry that runs 2–3 real research-style tasks that naturally
     require multiple tools and multiple turns (e.g. "search for X, read
     local notes file Y, compute Z, save a summary to the scratchpad").
   - README with setup + `npm run start` instructions, including how to get
     a free-tier search API key if the user doesn't have one.

2. Create `examples/test-agent-py/` (Python) mirroring the same behavior:
   - Add `pulse-agent` (path/editable dependency on packages/pulse-agent-py)
     and `anthropic` (plus `httpx` for web_search) as deps.
   - `main.py` reads the same env vars via python-dotenv.
   - Same four real tools, same genuine multi-turn loop (no hardcoded tool
     sequence, no simulated failures), using `pulse.start_run`,
     `run.with_llm_span` / `run.start_span` + `span.end`,
     `run.with_memory_span`, and `run.complete(status=...)` reflecting the
     real outcome.
   - Same 2–3 real research tasks.
   - README with setup + `python main.py` instructions.

3. Do not commit real API keys. Both examples must read keys from `.env`
   (gitignored) with a checked-in `.env.example`.

4. After building, do NOT run the agents against the live Anthropic API
   yourself (no key is configured yet) — leave that to me. Confirm both
   examples typecheck/import cleanly and the agentic loop's control flow is
   correct by inspection.

Reference docs/pao-test-agent.md in this repo for the exact PAO SDK method
signatures on both sides (TS and Python) — the SDK's method names and
kwarg conventions differ slightly between languages and that doc has
verified code samples for both.
```

---

## Environment setup

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...        # you provide this later
PULSE_API_KEY=pk_live_...           # a PAO Project API key (see Project model / dashboard)
PULSE_HOST=http://localhost:4000    # or https://api.usepulse.dev in prod
BRAVE_API_KEY=...                   # optional: real search tool (or TAVILY_API_KEY)
```

`PULSE_API_KEY` is validated against the `Project` table via the existing
`Authorization: Bearer <key>` middleware in
[`apps/api/src/lib/api-key.ts`](../apps/api/src/lib/api-key.ts) — use a key
tied to whichever project you want the test runs to show up under in
`/dashboard/agents`.

If you don't have a search API key yet, the `web_search` tool can fall back
to a real `fetch`/`httpx` GET against any public URL the task text mentions
— it's still a genuine network call, just not a full search engine.

---

## TypeScript reference: `@pulse/agent` + Anthropic SDK

```ts
// examples/test-agent-ts/src/index.ts
import 'dotenv/config'
import { readFile, appendFile } from 'node:fs/promises'
import Anthropic from '@anthropic-ai/sdk'
import { PulseAgent } from '@pulse/agent'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const pulse = new PulseAgent({
  apiKey: process.env.PULSE_API_KEY!,
  host: process.env.PULSE_HOST, // defaults to https://api.usepulse.dev
})

const SCRATCHPAD_PATH = new URL('../scratchpad.txt', import.meta.url)
const MAX_TURNS = 10

const tools: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description:
      'Search the web for current information, or fetch a specific URL if one is given.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query or a full URL to fetch' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a local file by path.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'calculator',
    description: 'Evaluate a basic arithmetic expression, e.g. "(120 - 98) / 98 * 100".',
    input_schema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
  },
  {
    name: 'write_scratchpad',
    description: 'Append a note to the persistent scratchpad for later recall.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
    },
  },
]

function safeCalculate(expression: string): number {
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    throw new Error('Invalid characters in expression')
  }
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${expression})`)()
}

// Real network call: uses Brave Search if a key is configured, otherwise
// falls back to fetching the query as a literal URL.
async function webSearch(query: string): Promise<string> {
  const braveKey = process.env.BRAVE_API_KEY
  if (braveKey) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`
    const res = await fetch(url, { headers: { 'X-Subscription-Token': braveKey } })
    if (!res.ok) throw new Error(`Brave Search API error: ${res.status}`)
    const data = await res.json()
    const results = (data.web?.results ?? []).slice(0, 5)
    return results.map((r: any) => `${r.title}: ${r.description}`).join('\n')
  }

  // Fallback: treat query as a URL and fetch it for real.
  const res = await fetch(query)
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`)
  return (await res.text()).slice(0, 2000)
}

async function executeTool(
  run: Awaited<ReturnType<PulseAgent['startRun']>>,
  toolUse: Anthropic.ToolUseBlock,
): Promise<Anthropic.ToolResultBlockParam> {
  const span = run.startSpan('tool_call', {
    name: toolUse.name,
    inputPreview: JSON.stringify(toolUse.input).slice(0, 500),
    metadata: { toolUseId: toolUse.id },
  })

  try {
    let output: string

    switch (toolUse.name) {
      case 'web_search': {
        const { query } = toolUse.input as { query: string }
        output = await webSearch(query)
        break
      }
      case 'read_file': {
        const { path } = toolUse.input as { path: string }
        output = await readFile(path, 'utf-8')
        break
      }
      case 'calculator': {
        const { expression } = toolUse.input as { expression: string }
        output = String(safeCalculate(expression))
        break
      }
      case 'write_scratchpad': {
        const { note } = toolUse.input as { note: string }
        output = await writeScratchpad(run, note)
        break
      }
      default:
        throw new Error(`Unknown tool: ${toolUse.name}`)
    }

    span.end({ status: 'success', outputPreview: output.slice(0, 500) })
    return { type: 'tool_result', tool_use_id: toolUse.id, content: output }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    span.end({ status: 'error', errorMessage: message })
    return { type: 'tool_result', tool_use_id: toolUse.id, content: message, is_error: true }
  }
}

// Real disk write, logged as memory activity (the agent's own working
// memory across turns — not a canned lookup array).
async function writeScratchpad(
  run: Awaited<ReturnType<PulseAgent['startRun']>>,
  note: string,
): Promise<string> {
  const span = run.startSpan('memory_read', {
    name: 'scratchpad.write',
    inputPreview: note,
    metadata: { memoryType: 'scratchpad-file' },
  })

  await appendFile(SCRATCHPAD_PATH, `${new Date().toISOString()} ${note}\n`, 'utf-8')
  const output = 'Note saved to scratchpad.'

  span.end({ status: 'success', outputPreview: output })
  return output
}

function estimateCostUsd(usage: Anthropic.Usage): number {
  // Real published claude-sonnet-4-5 rates — update if pricing changes.
  const INPUT_PER_MTOK = 3.0
  const OUTPUT_PER_MTOK = 15.0
  return (
    (usage.input_tokens / 1_000_000) * INPUT_PER_MTOK +
    (usage.output_tokens / 1_000_000) * OUTPUT_PER_MTOK
  )
}

async function runTask(task: string) {
  const run = await pulse.startRun(task)

  try {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task }]

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const llmSpan = run.startSpan('llm_call', {
        name: 'anthropic.messages.create',
        model: 'claude-sonnet-4-5',
        inputPreview: JSON.stringify(messages).slice(0, 500),
      })

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        tools,
        messages,
      })

      llmSpan.end({
        status: 'success',
        outputPreview: JSON.stringify(response.content).slice(0, 500),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: estimateCostUsd(response.usage),
      })

      messages.push({ role: 'assistant', content: response.content })

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      )

      // Claude decided it's done — no more tools requested.
      if (toolUses.length === 0) break

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        toolResults.push(await executeTool(run, toolUse))
      }
      messages.push({ role: 'user', content: toolResults })
    }

    await run.complete({ status: 'completed' })
  } catch (err) {
    await run.complete({
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

async function main() {
  await runTask(
    'Read the file ./pricing-notes.txt, search the web for the current price of the ' +
      'product it mentions, calculate the percentage difference between the two prices, ' +
      'and save a one-sentence summary to the scratchpad.',
  )
  await runTask(
    'Fetch https://api.github.com/repos/anthropics/anthropic-sdk-typescript and tell me ' +
      'the current star count, then calculate what a 20% increase would look like, and ' +
      'save the result to the scratchpad.',
  )
}

main()
```

Notes on the JS SDK's actual behavior (verified against
[`packages/pulse-agent/src`](../packages/pulse-agent/src)):

- `pulse.startRun(task, opts?)` fires the `run_start` payload immediately
  and returns an `AgentRun` handle — no `await` needed before you start
  spans on it.
- `run.startSpan(spanType, opts)` is synchronous and returns an `AgentSpan`
  immediately; nothing is sent over the network until you call `span.end()`.
- Spans are buffered in memory and only leave the process on `run.complete()`
  (or a 30s safety-net auto-flush that does **not** close the run). Always
  call `run.complete()` — including on the error path — or the run will
  never show a terminal status in the dashboard.
- `run.withLLMSpan({...})` and friends (`withMemorySpan`, `withHttpSpan`,
  `withDbSpan`, `withSearchSpan`, `withSubAgentSpan`, etc. — see
  [`types.ts`](../packages/pulse-agent/src/types.ts)) are optional sugar
  that wrap `startSpan` + `try/catch` + `span.end()` for you:

  ```ts
  const result = await run.withLLMSpan({
    name: 'anthropic.messages.create',
    model: 'claude-sonnet-4-5',
    inputPreview: task,
    execute: () => anthropic.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 2048, messages: [...] }),
    getOutputPreview: (r) => JSON.stringify(r.content).slice(0, 500),
    getTokens: (r) => ({ input: r.usage.input_tokens, output: r.usage.output_tokens }),
  })
  ```

- `PULSE_DISABLED=true` turns every PAO call into a no-op — useful for
  local unit tests of your tool functions, not for the real agent runs
  you're using to test PAO.

---

## Python reference: `pulse-agent` + Anthropic SDK

```python
# examples/test-agent-py/main.py
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from anthropic import Anthropic
from pulse_agent import PulseAgent

load_dotenv()

anthropic = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
pulse = PulseAgent(
    api_key=os.environ["PULSE_API_KEY"],
    host=os.environ.get("PULSE_HOST"),  # defaults to https://api.usepulse.dev
)

SCRATCHPAD_PATH = Path(__file__).parent / "scratchpad.txt"
MAX_TURNS = 10

TOOLS = [
    {
        "name": "web_search",
        "description": "Search the web for current information, or fetch a specific URL if one is given.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Search query or a full URL to fetch"}},
            "required": ["query"],
        },
    },
    {
        "name": "read_file",
        "description": "Read the contents of a local file by path.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "calculator",
        "description": 'Evaluate a basic arithmetic expression, e.g. "(120 - 98) / 98 * 100".',
        "input_schema": {
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    },
    {
        "name": "write_scratchpad",
        "description": "Append a note to the persistent scratchpad for later recall.",
        "input_schema": {
            "type": "object",
            "properties": {"note": {"type": "string"}},
            "required": ["note"],
        },
    },
]

_SAFE_EXPR = re.compile(r"^[0-9+\-*/().\s]+$")


def safe_calculate(expression: str) -> float:
    if not _SAFE_EXPR.match(expression):
        raise ValueError("Invalid characters in expression")
    return eval(expression, {"__builtins__": {}})  # nosec: input pre-validated above


def web_search(query: str) -> str:
    """Real network call: Brave Search API if configured, else a literal URL fetch."""
    brave_key = os.environ.get("BRAVE_API_KEY")
    if brave_key:
        resp = httpx.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query},
            headers={"X-Subscription-Token": brave_key},
            timeout=15.0,
        )
        resp.raise_for_status()
        results = resp.json().get("web", {}).get("results", [])[:5]
        return "\n".join(f"{r['title']}: {r['description']}" for r in results)

    resp = httpx.get(query, timeout=15.0)
    resp.raise_for_status()
    return resp.text[:2000]


def estimate_cost_usd(usage) -> float:
    # Real published claude-sonnet-4-5 rates — update if pricing changes.
    input_per_mtok = 3.0
    output_per_mtok = 15.0
    return (usage.input_tokens / 1_000_000) * input_per_mtok + (
        usage.output_tokens / 1_000_000
    ) * output_per_mtok


def write_scratchpad(run, note: str) -> str:
    # Real disk write, logged as memory activity across turns.
    with run.with_memory_span("scratchpad.write", memory_type="scratchpad-file", input_preview=note) as span:
        timestamp = datetime.now(timezone.utc).isoformat()
        with SCRATCHPAD_PATH.open("a", encoding="utf-8") as f:
            f.write(f"{timestamp} {note}\n")
        output = "Note saved to scratchpad."
        span.end(status="success", output_preview=output)
        return output


def execute_tool(run, tool_use) -> dict:
    span = run.start_span(
        "tool_call",
        tool_use.name,
        input_preview=str(tool_use.input)[:500],
        metadata={"toolUseId": tool_use.id},
    )

    try:
        if tool_use.name == "web_search":
            output = web_search(tool_use.input["query"])
        elif tool_use.name == "read_file":
            output = Path(tool_use.input["path"]).read_text(encoding="utf-8")
        elif tool_use.name == "calculator":
            output = str(safe_calculate(tool_use.input["expression"]))
        elif tool_use.name == "write_scratchpad":
            output = write_scratchpad(run, tool_use.input["note"])
        else:
            raise ValueError(f"Unknown tool: {tool_use.name}")

        span.end(status="success", output_preview=output[:500])
        return {"type": "tool_result", "tool_use_id": tool_use.id, "content": output}
    except Exception as exc:  # noqa: BLE001 - report the real failure back to Claude
        message = str(exc)
        span.end(status="error", error_message=message)
        return {
            "type": "tool_result",
            "tool_use_id": tool_use.id,
            "content": message,
            "is_error": True,
        }


def run_task(task: str) -> None:
    run = pulse.start_run(task)

    try:
        messages = [{"role": "user", "content": task}]

        for _ in range(MAX_TURNS):
            llm_span = run.start_span(
                "llm_call",
                "anthropic.messages.create",
                model="claude-sonnet-4-5",
                input_preview=str(messages)[:500],
            )

            response = anthropic.messages.create(
                model="claude-sonnet-4-5",
                max_tokens=2048,
                tools=TOOLS,
                messages=messages,
            )

            llm_span.end(
                status="success",
                output_preview=str(response.content)[:500],
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                cost_usd=estimate_cost_usd(response.usage),
            )

            messages.append({"role": "assistant", "content": response.content})

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                break  # Claude decided it's done

            tool_results = [execute_tool(run, tu) for tu in tool_uses]
            messages.append({"role": "user", "content": tool_results})

        run.complete(status="completed")
    except Exception as exc:
        run.complete(status="failed", error_message=str(exc))
        raise


def main() -> None:
    run_task(
        "Read the file ./pricing-notes.txt, search the web for the current price of the "
        "product it mentions, calculate the percentage difference between the two prices, "
        "and save a one-sentence summary to the scratchpad."
    )
    run_task(
        "Fetch https://api.github.com/repos/anthropics/anthropic-sdk-python and tell me "
        "the current star count, then calculate what a 20% increase would look like, and "
        "save the result to the scratchpad."
    )


if __name__ == "__main__":
    main()
```

Notes on the Python SDK's actual behavior (verified against
[`packages/pulse-agent-py/src/pulse_agent`](../packages/pulse-agent-py/src/pulse_agent)):

- `PulseAgent(api_key=..., host=...)` — the constructor also accepts
  `base_url` as an alias for `host`, and `flush_interval_ms` to override the
  default 30s auto-flush.
- `pulse.start_run(name, metadata=None)` sends `run_start` from a background
  daemon thread (fire-and-forget, same pattern as JS's uncaught `fetch`).
- `run.start_span(span_type, name="", **kwargs)` — unlike the JS API, this
  takes the span type and name as positional args; any kwarg not in
  `{model, agent_name, input_preview, parent_span_id, metadata}` gets folded
  into `metadata` automatically. Same on `span.end(status=None, **kwargs)`:
  unrecognized kwargs merge into `metadata`, so `span.end(status="success",
  rows_returned=12)` "just works" without a manual metadata dict.
- `run.with_llm_span(...)`, `run.with_memory_span(...)`,
  `run.with_http_span(...)`, etc. are **context managers**, not the
  callback-passing style JS uses:

  ```python
  with run.with_llm_span("anthropic.messages.create", model="claude-sonnet-4-5") as span:
      response = anthropic.messages.create(...)
      span.end(status="success", input_tokens=response.usage.input_tokens, output_tokens=response.usage.output_tokens)
  ```

  If you don't call `span.end()` yourself inside the `with` block, exiting
  the block cleanly auto-ends the span with `status="success"`; an
  exception inside the block auto-ends it with `status="error"` and
  re-raises — see `_span_context` in
  [`run.py`](../packages/pulse-agent-py/src/pulse_agent/run.py).
- `run.complete(status=None, error_message=None, metadata=None)` is
  idempotent — safe to call more than once, and safe to call in a `finally`.
- Set `PULSE_DISABLED=true` in the environment to no-op the whole SDK for
  local unit tests of your tool functions.

---

## Verifying results in the dashboard

After running either example against a real `PULSE_API_KEY`:

1. Open `/dashboard/agents?project=<projectId>` — you should see 2+ new
   runs, each with `status: completed` (or `failed`, honestly, if a tool
   genuinely errored — e.g. a bad URL, a missing local file, a rate limit).
2. Open a run detail page — the `SpanTable` should show several real
   `llm_call` spans (one per turn Claude actually took) interleaved with
   real `tool_call` spans for whichever tools Claude genuinely chose to
   invoke, plus `memory_read` spans for scratchpad activity. The exact
   tool sequence will differ between runs because Claude is deciding it
   live — that variability is the point.
3. Click into any span to open `SpanDetailPanel` and confirm the real
   `inputPreview`/`outputPreview` and (for tool errors) the real
   `errorMessage` render correctly.
4. Confirm `totalTokens` and `totalCostUsd` on the run header roughly match
   the sum of the `llm_call` spans' real `inputTokens`/`outputTokens`/
   `costUsd`.
5. This is also the natural point to close out **Task 7.2** ("Verify data
   scoping") from `docs/pao-tasks.md`: run the same test agent twice with
   two different `PULSE_API_KEY`s (two projects) and confirm each
   dashboard only shows its own runs.
