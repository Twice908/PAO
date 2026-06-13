"""PulseAgent: mirrors `packages/pulse-agent/src/agent.ts`."""

import os
import threading
import uuid
from typing import Any, Dict, List, Optional

from ._util import now_iso
from .constants import DEFAULT_FLUSH_INTERVAL_MS, DEFAULT_HOST, RUN_START
from .http import HttpClient
from .run import AgentRun
from .types import AgentSpanPayload


class PulseAgent:
    """Entry point for instrumenting an agent run.

    Network calls are fire-and-forget (sent from a background thread) and
    never raise -- if the backend is unreachable, the SDK fails silently so
    it can never break the host application. Set `PULSE_DISABLED=true` to
    turn the SDK into a complete no-op (useful in tests/CI).
    """

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        host: Optional[str] = None,
        flush_interval_ms: Optional[int] = None,
    ) -> None:
        self._api_key = api_key
        self._host = (base_url or host or DEFAULT_HOST).rstrip("/")
        self._flush_interval_ms = flush_interval_ms if flush_interval_ms is not None else DEFAULT_FLUSH_INTERVAL_MS
        self._disabled = os.environ.get("PULSE_DISABLED") == "true"
        self._http: Optional[HttpClient] = None if self._disabled else HttpClient(self._host, api_key)

    def start_run(self, name: str, metadata: Optional[Dict[str, Any]] = None) -> AgentRun:
        if self._disabled:
            return AgentRun.noop()

        run_id = str(uuid.uuid4())
        started_at = now_iso()

        run_start_payload = AgentSpanPayload(
            type=RUN_START,
            run_id=run_id,
            started_at=started_at,
            task=name,
            metadata=metadata,
        )
        self._flush([run_start_payload])

        return AgentRun(run_id, started_at, self._flush, name=name, flush_interval_ms=self._flush_interval_ms)

    def _flush(self, payloads: List[AgentSpanPayload]) -> None:
        if not payloads or self._http is None:
            return
        threading.Thread(target=self._http.send, args=(payloads,), daemon=True).start()
