"""HTTP transport for the Pulse Agent Observe (PAO) Python SDK.

Sends batched span payloads to `POST /ingest/agent-span` with
`Authorization: Bearer <api_key>`, matching the npm package's `_flush`
implementation. Unlike the npm package (a single unawaited `fetch`), this
client retries transient failures up to `MAX_RETRIES` times with exponential
backoff -- but it NEVER raises. Observability must never break the caller's
agent.
"""

import logging
import time
from typing import Sequence

import httpx

from .constants import INGEST_PATH
from .types import AgentSpanPayload

logger = logging.getLogger("pulse_agent")

MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 0.5
REQUEST_TIMEOUT_SECONDS = 10.0


class HttpClient:
    def __init__(self, host: str, api_key: str) -> None:
        self._url = f"{host.rstrip('/')}{INGEST_PATH}"
        self._headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

    def send(self, payloads: Sequence[AgentSpanPayload]) -> None:
        if not payloads:
            return

        body = [payload.to_wire() for payload in payloads]
        backoff = INITIAL_BACKOFF_SECONDS

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = httpx.post(
                    self._url,
                    json=body,
                    headers=self._headers,
                    timeout=REQUEST_TIMEOUT_SECONDS,
                )
                if response.status_code < 500:
                    return
                logger.debug(
                    "pulse-agent: ingest returned %s (attempt %d/%d)",
                    response.status_code,
                    attempt,
                    MAX_RETRIES,
                )
            except Exception as exc:  # never let transport errors escape
                logger.debug(
                    "pulse-agent: ingest request failed (attempt %d/%d): %s",
                    attempt,
                    MAX_RETRIES,
                    exc,
                )

            if attempt < MAX_RETRIES:
                time.sleep(backoff)
                backoff *= 2
