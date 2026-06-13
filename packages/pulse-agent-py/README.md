# pulse-agent

Python SDK for [Pulse Agent Observe (PAO)](https://usepulse.dev) — AI agent
observability. This package mirrors the [`@pulse/agent`](../pulse-agent)
npm package: same payload shapes, same `/ingest/agent-span` endpoint, same
fire-and-forget guarantees.

## Quick start

```python
from pulse_agent import PulseAgent

pulse = PulseAgent(api_key="pk_live_...")

run = pulse.start_run("My Task")
span = run.start_span("llm_call", model="gpt-4o", input_preview="What is 2+2?")
span.end(output_preview="4", input_tokens=12, output_tokens=1, status="success")
run.complete(status="completed")
```

## Configuration

```python
PulseAgent(
    api_key="pk_live_...",   # required
    base_url="https://api.usepulse.dev",  # optional, defaults to api.usepulse.dev
    flush_interval_ms=30_000,             # optional, auto-flush interval for buffered spans
)
```

Set `PULSE_DISABLED=true` to turn the SDK into a complete no-op (every
method returns immediately and no network calls are made) — useful in
tests and CI.

## Spans

`run.start_span(span_type, name=..., **opts)` accepts:

- `model`, `agent_name`, `input_preview`, `parent_span_id`, `metadata`
- any other keyword argument is merged into `metadata`

`span.end(status=..., **opts)` accepts:

- `output_preview`, `input_tokens`, `output_tokens`, `cost_usd`, `error_message`, `metadata`
- any other keyword argument is merged into `metadata`

`status` is one of `"success"`, `"error"`, `"timeout"` for spans, and
`"completed"`, `"failed"`, `"interrupted"` for `run.complete()`.

## Context manager helpers

`AgentRun` provides context managers for common span types. Each one starts
a span, yields it, and automatically calls `span.end(status="success")` on a
clean exit or `span.end(status="error", error_message=...)` if an exception
is raised (the exception still propagates):

```python
with run.with_llm_span("gpt-4o completion", model="gpt-4o", input_preview=prompt) as span:
    result = call_llm(prompt)
    span.end(status="success", output_preview=result, input_tokens=120, output_tokens=42)
```

Available helpers: `with_llm_span`, `with_memory_span`, `with_agent_message_span`,
`with_http_span`, `with_db_span`, `with_file_span`, `with_embedding_span`,
`with_search_span`, `with_code_span`, `with_human_approval_span`,
`with_sub_agent_span`.

## Guarantees

- Never raises to the caller and never blocks the agent's execution thread —
  HTTP sends happen on a background thread with silent retries.
- `input_preview` / `output_preview` are truncated to 500 characters before
  being sent.
- Buffered spans flush on `run.complete()` or every `flush_interval_ms`
  (default 30s), whichever comes first.
- The API key is never logged.

## Development

```bash
pip install -e ".[dev]"
pytest
```
