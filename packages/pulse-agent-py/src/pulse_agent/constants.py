"""Shared constants for the Pulse Agent Observe (PAO) Python SDK.

These mirror the `SpanType` union and status literals used by the
`@pulse/agent` npm package and validated by the PAO backend's Zod schema
for `POST /ingest/agent-span`.
"""

DEFAULT_HOST = "https://api.usepulse.dev"
INGEST_PATH = "/ingest/agent-span"
MAX_PREVIEW_LENGTH = 500
DEFAULT_FLUSH_INTERVAL_MS = 30_000

# --- Payload types (AgentSpanPayload.type) ---
RUN_START = "run_start"
RUN_END = "run_end"
SPAN = "span"

# --- Span types (AgentSpanPayload.spanType) ---
LLM_CALL = "llm_call"
TOOL_CALL = "tool_call"
MEMORY_READ = "memory_read"
AGENT_MESSAGE = "agent_message"
ERROR = "error"

SPAN_TYPES = (LLM_CALL, TOOL_CALL, MEMORY_READ, AGENT_MESSAGE, ERROR)

# --- Span-level statuses (AgentSpanPayload.status when type == "span") ---
SUCCESS = "success"
TIMEOUT = "timeout"
# ERROR (above) doubles as the span-level "error" status.

SPAN_STATUSES = (SUCCESS, ERROR, TIMEOUT)

# --- Run-level statuses (AgentSpanPayload.status when type == "run_end") ---
COMPLETED = "completed"
FAILED = "failed"
INTERRUPTED = "interrupted"

RUN_STATUSES = (COMPLETED, FAILED, INTERRUPTED)
