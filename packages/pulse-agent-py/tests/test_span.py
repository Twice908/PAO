from pulse_agent.constants import MAX_PREVIEW_LENGTH
from pulse_agent.span import AgentSpan
from pulse_agent.types import StartSpanOpts

STARTED_AT = "2024-01-01T00:00:00.000Z"


def test_end_pushes_payload_to_buffer():
    captured = []
    opts = StartSpanOpts(name="step-1", model="gpt-4o", input_preview="Hello")
    span = AgentSpan("span-1", "run-1", STARTED_AT, "llm_call", opts, captured.append)

    span.end(status="success", output_preview="World", input_tokens=10, output_tokens=5, cost_usd=0.0012)

    assert len(captured) == 1
    payload = captured[0].to_wire()
    assert payload["spanId"] == "span-1"
    assert payload["runId"] == "run-1"
    assert payload["spanType"] == "llm_call"
    assert payload["name"] == "step-1"
    assert payload["model"] == "gpt-4o"
    assert payload["status"] == "success"
    assert payload["inputTokens"] == 10
    assert payload["outputTokens"] == 5
    assert payload["costUsd"] == 0.0012
    assert payload["outputPreview"] == "World"
    assert payload["startedAt"] == STARTED_AT
    assert "endedAt" in payload


def test_end_is_idempotent():
    captured = []
    opts = StartSpanOpts(name="step-1")
    span = AgentSpan("span-1", "run-1", STARTED_AT, "llm_call", opts, captured.append)

    span.end(status="success")
    span.end(status="error")  # ignored -- span already ended

    assert len(captured) == 1
    assert captured[0].status == "success"
    assert span.ended is True


def test_unknown_kwargs_become_metadata():
    captured = []
    opts = StartSpanOpts(name="step-1")
    span = AgentSpan("span-1", "run-1", STARTED_AT, "llm_call", opts, captured.append)

    span.end(output_preview="4", tokens=100)

    assert captured[0].metadata == {"tokens": 100}
    assert span.metadata == {"tokens": 100}


def test_end_metadata_falls_back_to_start_metadata():
    captured = []
    opts = StartSpanOpts(name="step-1", metadata={"memoryType": "vector"})
    span = AgentSpan("span-1", "run-1", STARTED_AT, "memory_read", opts, captured.append)

    span.end(status="success")

    assert captured[0].metadata == {"memoryType": "vector"}


def test_preview_truncation():
    captured = []
    opts = StartSpanOpts(name="big", input_preview="i" * 600)
    span = AgentSpan("span-1", "run-1", STARTED_AT, "llm_call", opts, captured.append)

    span.end(output_preview="o" * 700)

    payload = captured[0]
    assert len(payload.input_preview) == MAX_PREVIEW_LENGTH
    assert len(payload.output_preview) == MAX_PREVIEW_LENGTH
    assert payload.input_preview == "i" * MAX_PREVIEW_LENGTH
    assert payload.output_preview == "o" * MAX_PREVIEW_LENGTH


def test_to_wire_drops_unset_fields():
    captured = []
    opts = StartSpanOpts(name="step-1")
    span = AgentSpan("span-1", "run-1", STARTED_AT, "llm_call", opts, captured.append)

    span.end(status="success")

    wire = captured[0].to_wire()
    assert "model" not in wire
    assert "inputTokens" not in wire
    assert "errorMessage" not in wire
    assert "metadata" not in wire


def test_noop_span_never_pushes():
    captured = []
    opts = StartSpanOpts(name="step-1")
    span = AgentSpan("span-1", "run-1", STARTED_AT, "llm_call", opts, captured.append, disabled=True)

    span.end(status="success")

    assert captured == []
    assert span.ended is False
