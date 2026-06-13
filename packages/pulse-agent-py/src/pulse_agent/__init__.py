"""Pulse Agent Observe (PAO) SDK for AI agent observability.

>>> from pulse_agent import PulseAgent
>>> pulse = PulseAgent(api_key="pk_live_...")
>>> run = pulse.start_run("My Task")
>>> span = run.start_span("llm_call", model="gpt-4o", input_preview="What is 2+2?")
>>> span.end(output_preview="4", input_tokens=12, output_tokens=1, status="success")
>>> run.complete(status="completed")
"""

from . import constants
from .client import PulseAgent
from .run import AgentRun
from .span import AgentSpan
from .types import AgentSpanPayload, StartSpanOpts

__version__ = "0.1.0"

__all__ = [
    "PulseAgent",
    "AgentRun",
    "AgentSpan",
    "AgentSpanPayload",
    "StartSpanOpts",
    "constants",
    "__version__",
]
