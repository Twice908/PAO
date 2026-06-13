"""AgentRun: mirrors `packages/pulse-agent/src/run.ts`."""

import threading
import uuid
from contextlib import contextmanager
from typing import Any, Callable, Dict, Iterator, List, Optional

from ._util import now_iso
from .constants import (
    AGENT_MESSAGE,
    DEFAULT_FLUSH_INTERVAL_MS,
    ERROR,
    LLM_CALL,
    MEMORY_READ,
    RUN_END,
    SUCCESS,
    TOOL_CALL,
)
from .span import AgentSpan
from .types import AgentSpanPayload, StartSpanOpts

# Recognized `start_span()` kwargs that map directly onto `StartSpanOpts`
# fields. Anything else passed to `start_span()` is folded into `metadata`.
_KNOWN_START_SPAN_FIELDS = {"model", "agent_name", "input_preview", "parent_span_id", "metadata"}

_METADATA_PREVIEW_LENGTH = 200


def _build_span_opts(name: str, kwargs: Dict[str, Any]) -> StartSpanOpts:
    known: Dict[str, Any] = {}
    extra: Dict[str, Any] = {}
    for key, value in kwargs.items():
        if key in _KNOWN_START_SPAN_FIELDS:
            known[key] = value
        else:
            extra[key] = value

    metadata = known.get("metadata")
    if extra:
        metadata = {**(metadata or {}), **extra}

    return StartSpanOpts(
        name=name,
        model=known.get("model"),
        agent_name=known.get("agent_name"),
        input_preview=known.get("input_preview"),
        parent_span_id=known.get("parent_span_id"),
        metadata=metadata,
    )


class AgentRun:
    def __init__(
        self,
        run_id: str,
        created_at: str,
        flush_fn: Callable[[List[AgentSpanPayload]], None],
        name: Optional[str] = None,
        flush_interval_ms: int = DEFAULT_FLUSH_INTERVAL_MS,
        disabled: bool = False,
    ) -> None:
        self.id = run_id
        self.run_id = run_id
        self.name = name
        self.created_at = created_at

        self._started_at = created_at
        self._flush_fn = flush_fn
        self._disabled = disabled
        self._buffer: List[AgentSpanPayload] = []
        self._lock = threading.Lock()
        self._completed = False
        self._flush_timer: Optional[threading.Timer] = None

        if not disabled:
            self._flush_timer = threading.Timer(flush_interval_ms / 1000, self._timer_flush)
            self._flush_timer.daemon = True
            self._flush_timer.start()

    def start_span(self, span_type: str, name: str = "", **kwargs: Any) -> AgentSpan:
        """Start a span and return a handle for it.

        `kwargs` may include `model`, `agent_name`, `input_preview`,
        `parent_span_id`, `metadata`; any other kwargs are folded into
        `metadata`.
        """
        if self._disabled:
            return AgentSpan.noop()

        opts = _build_span_opts(name, kwargs)
        span_id = str(uuid.uuid4())
        started_at = now_iso()
        return AgentSpan(span_id, self.run_id, started_at, span_type, opts, self._push_to_buffer)

    def _push_to_buffer(self, payload: AgentSpanPayload) -> None:
        with self._lock:
            self._buffer.append(payload)

    def complete(
        self,
        status: Optional[str] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Flush all buffered spans plus a `run_end` payload.

        `status` is one of "completed" | "failed" | "interrupted".
        Idempotent -- subsequent calls are no-ops.
        """
        if self._disabled or self._completed:
            return
        self._completed = True

        if self._flush_timer is not None:
            self._flush_timer.cancel()
            self._flush_timer = None

        self._do_flush(is_final=True, status=status, error_message=error_message, metadata=metadata)

    def _timer_flush(self) -> None:
        if not self._completed:
            # Auto-flush buffered spans WITHOUT finalizing the run.
            # Sending run_end here would close the run server-side and
            # cause spans that end after the timer to be dropped.
            self._do_flush(is_final=False)

    def _do_flush(
        self,
        is_final: bool,
        status: Optional[str] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        with self._lock:
            payloads = list(self._buffer)
            if is_final:
                self._buffer = []

        if is_final:
            payloads.append(
                AgentSpanPayload(
                    type=RUN_END,
                    run_id=self.run_id,
                    started_at=self._started_at,
                    ended_at=now_iso(),
                    status=status,
                    error_message=error_message,
                    metadata=metadata,
                )
            )
        # Timer flush (is_final=False): the buffer is left intact. Spans
        # added after the timer still accumulate and are included in the
        # final flush when complete() is called.

        if not payloads:
            return

        self._flush_fn(payloads)

    @contextmanager
    def _span_context(self, span_type: str, name: str, **start_kwargs: Any) -> Iterator[AgentSpan]:
        span = self.start_span(span_type, name, **start_kwargs)
        try:
            yield span
        except Exception as exc:
            span.end(status=ERROR, error_message=str(exc))
            raise
        else:
            if not span.ended:
                span.end(status=SUCCESS)

    def with_llm_span(
        self,
        name: str,
        model: Optional[str] = None,
        agent_name: Optional[str] = None,
        input_preview: Optional[str] = None,
    ):
        return self._span_context(LLM_CALL, name, model=model, agent_name=agent_name, input_preview=input_preview)

    def with_memory_span(self, name: str, memory_type: Optional[str] = None, input_preview: Optional[str] = None):
        metadata = {"memoryType": memory_type} if memory_type is not None else None
        return self._span_context(MEMORY_READ, name, input_preview=input_preview, metadata=metadata)

    def with_agent_message_span(
        self,
        name: str,
        from_agent: Optional[str] = None,
        to_agent: Optional[str] = None,
        input_preview: Optional[str] = None,
    ):
        metadata: Dict[str, Any] = {}
        if from_agent is not None:
            metadata["fromAgent"] = from_agent
        if to_agent is not None:
            metadata["toAgent"] = to_agent
        return self._span_context(AGENT_MESSAGE, name, input_preview=input_preview, metadata=metadata or None)

    def with_http_span(
        self,
        name: str,
        url: Optional[str] = None,
        method: Optional[str] = None,
        input_preview: Optional[str] = None,
    ):
        metadata: Dict[str, Any] = {}
        if url is not None:
            metadata["url"] = url[:_METADATA_PREVIEW_LENGTH]
        if method is not None:
            metadata["method"] = method
        return self._span_context(TOOL_CALL, name, input_preview=input_preview, metadata=metadata or None)

    def with_db_span(
        self,
        name: str,
        operation: Optional[str] = None,
        table: Optional[str] = None,
        input_preview: Optional[str] = None,
    ):
        metadata: Dict[str, Any] = {}
        if operation is not None:
            metadata["operation"] = operation
        if table is not None:
            metadata["table"] = table
        return self._span_context(TOOL_CALL, name, input_preview=input_preview, metadata=metadata or None)

    def with_file_span(
        self,
        name: str,
        file_path: Optional[str] = None,
        operation: Optional[str] = None,
        input_preview: Optional[str] = None,
    ):
        metadata: Dict[str, Any] = {}
        if file_path is not None:
            metadata["filePath"] = file_path[:_METADATA_PREVIEW_LENGTH]
        if operation is not None:
            metadata["operation"] = operation
        return self._span_context(TOOL_CALL, name, input_preview=input_preview, metadata=metadata or None)

    def with_embedding_span(
        self,
        name: str,
        model: Optional[str] = None,
        input_preview: Optional[str] = None,
        dimensions: Optional[int] = None,
    ):
        metadata: Dict[str, Any] = {}
        if model is not None:
            metadata["model"] = model
        if dimensions is not None:
            metadata["dimensions"] = dimensions
        return self._span_context(TOOL_CALL, name, input_preview=input_preview, metadata=metadata or None)

    def with_search_span(
        self,
        name: str,
        index: Optional[str] = None,
        query: Optional[str] = None,
        top_k: Optional[int] = None,
    ):
        metadata: Dict[str, Any] = {}
        if index is not None:
            metadata["index"] = index
        if query is not None:
            metadata["query"] = query[:_METADATA_PREVIEW_LENGTH]
        if top_k is not None:
            metadata["topK"] = top_k
        return self._span_context(TOOL_CALL, name, metadata=metadata or None)

    def with_code_span(self, name: str, language: Optional[str] = None, input_preview: Optional[str] = None):
        metadata: Dict[str, Any] = {}
        if language is not None:
            metadata["language"] = language
        truncated_input = input_preview[:_METADATA_PREVIEW_LENGTH] if input_preview is not None else None
        return self._span_context(TOOL_CALL, name, input_preview=truncated_input, metadata=metadata or None)

    def with_human_approval_span(self, name: str, prompt: Optional[str] = None, timeout_ms: Optional[int] = None):
        metadata: Dict[str, Any] = {}
        if prompt is not None:
            metadata["prompt"] = prompt[:_METADATA_PREVIEW_LENGTH]
        if timeout_ms is not None:
            metadata["timeoutMs"] = timeout_ms
        return self._span_context(TOOL_CALL, name, metadata=metadata or None)

    def with_sub_agent_span(self, name: str, sub_agent_name: Optional[str] = None, input_preview: Optional[str] = None):
        metadata: Dict[str, Any] = {}
        if sub_agent_name is not None:
            metadata["subAgentName"] = sub_agent_name
        truncated_input = input_preview[:_METADATA_PREVIEW_LENGTH] if input_preview is not None else None
        return self._span_context(TOOL_CALL, name, input_preview=truncated_input, metadata=metadata or None)

    @staticmethod
    def noop() -> "AgentRun":
        return AgentRun("", now_iso(), lambda payloads: None, disabled=True)
