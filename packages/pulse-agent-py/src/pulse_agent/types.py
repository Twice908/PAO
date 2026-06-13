"""Type definitions for the Pulse Agent Observe (PAO) Python SDK.

`AgentSpanPayload` mirrors the TypeScript `AgentSpanPayload` type in
`packages/pulse-agent/src/types.ts` field-for-field. `to_wire()` converts
the Python (snake_case) representation into the camelCase JSON shape
expected by `POST /ingest/agent-span`, dropping unset (`None`) fields the
same way `JSON.stringify` drops `undefined` values in the npm package.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class AgentSpanPayload:
    type: str
    run_id: str
    started_at: str
    span_id: Optional[str] = None
    parent_span_id: Optional[str] = None
    task: Optional[str] = None
    agent_name: Optional[str] = None
    span_type: Optional[str] = None
    name: Optional[str] = None
    model: Optional[str] = None
    ended_at: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    input_preview: Optional[str] = None
    output_preview: Optional[str] = None
    status: Optional[str] = None
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_wire(self) -> Dict[str, Any]:
        """Serialize to the camelCase shape sent to `/ingest/agent-span`."""
        wire = {
            "type": self.type,
            "runId": self.run_id,
            "spanId": self.span_id,
            "parentSpanId": self.parent_span_id,
            "task": self.task,
            "agentName": self.agent_name,
            "spanType": self.span_type,
            "name": self.name,
            "model": self.model,
            "startedAt": self.started_at,
            "endedAt": self.ended_at,
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "costUsd": self.cost_usd,
            "inputPreview": self.input_preview,
            "outputPreview": self.output_preview,
            "status": self.status,
            "errorMessage": self.error_message,
            "metadata": self.metadata,
        }
        return {key: value for key, value in wire.items() if value is not None}


@dataclass
class StartSpanOpts:
    """Options captured when a span is started (mirrors `StartSpanOpts`)."""

    name: str = ""
    model: Optional[str] = None
    agent_name: Optional[str] = None
    input_preview: Optional[str] = None
    parent_span_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
