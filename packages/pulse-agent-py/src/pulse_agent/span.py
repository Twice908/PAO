"""AgentSpan: mirrors `packages/pulse-agent/src/span.ts`."""

from typing import Any, Callable, Dict, Optional

from ._util import now_iso
from .constants import LLM_CALL, MAX_PREVIEW_LENGTH, SPAN
from .types import AgentSpanPayload, StartSpanOpts

# Recognized `end()` kwargs that map directly onto AgentSpanPayload fields.
# Anything else passed to `end()` is folded into `metadata`.
_KNOWN_END_FIELDS = {
    "output_preview",
    "input_tokens",
    "output_tokens",
    "cost_usd",
    "error_message",
    "metadata",
}


class AgentSpan:
    def __init__(
        self,
        span_id: str,
        run_id: str,
        started_at: str,
        span_type: str,
        opts: StartSpanOpts,
        push_to_buffer: Callable[[AgentSpanPayload], None],
        disabled: bool = False,
    ) -> None:
        self.span_id = span_id
        self.run_id = run_id
        self.span_type = span_type
        self.name = opts.name
        self.created_at = started_at
        self.started_at = started_at
        self.metadata: Dict[str, Any] = dict(opts.metadata or {})

        self._opts = opts
        self._push_to_buffer = push_to_buffer
        self._disabled = disabled
        self._ended = False

    @property
    def ended(self) -> bool:
        return self._ended

    def end(self, status: Optional[str] = None, **kwargs: Any) -> None:
        """Mark the span complete and push its payload to the run's buffer.

        `status` is one of "success" | "error" | "timeout". Recognized
        kwargs (`output_preview`, `input_tokens`, `output_tokens`,
        `cost_usd`, `error_message`, `metadata`) map onto `AgentSpanPayload`
        fields; any other kwargs are merged into `metadata`.
        """
        if self._disabled or self._ended:
            return
        self._ended = True

        known: Dict[str, Any] = {}
        extra: Dict[str, Any] = {}
        for key, value in kwargs.items():
            if key in _KNOWN_END_FIELDS:
                known[key] = value
            else:
                extra[key] = value

        metadata = known.get("metadata")
        if extra:
            metadata = {**(metadata or {}), **extra}
        if metadata is None:
            metadata = self._opts.metadata

        self.metadata = dict(metadata or {})

        output_preview = known.get("output_preview")
        if output_preview is not None:
            output_preview = output_preview[:MAX_PREVIEW_LENGTH]

        input_preview = self._opts.input_preview
        if input_preview is not None:
            input_preview = input_preview[:MAX_PREVIEW_LENGTH]

        payload = AgentSpanPayload(
            type=SPAN,
            run_id=self.run_id,
            span_id=self.span_id,
            parent_span_id=self._opts.parent_span_id,
            span_type=self.span_type,
            name=self._opts.name,
            model=self._opts.model,
            agent_name=self._opts.agent_name,
            started_at=self.started_at,
            ended_at=now_iso(),
            input_tokens=known.get("input_tokens"),
            output_tokens=known.get("output_tokens"),
            cost_usd=known.get("cost_usd"),
            input_preview=input_preview,
            output_preview=output_preview,
            status=status,
            error_message=known.get("error_message"),
            metadata=metadata,
        )

        self._push_to_buffer(payload)

    @staticmethod
    def noop() -> "AgentSpan":
        return AgentSpan("", "", now_iso(), LLM_CALL, StartSpanOpts(name=""), lambda payload: None, disabled=True)
