import time

import pytest

from pulse_agent import PulseAgent
from pulse_agent.constants import MAX_PREVIEW_LENGTH


def _new_run(mock_http_send, **kwargs):
    agent = PulseAgent(api_key="test-key", base_url="http://localhost:3000", **kwargs)
    run = agent.start_run("Test task")
    mock_http_send.reset_mock()
    return run


def test_span_end_buffers_without_flushing(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    span = run.start_span("llm_call", name="gpt-4o", input_preview="Hello")
    span.end(status="success", output_preview="World", input_tokens=10, output_tokens=5)

    mock_http_send.assert_not_called()


def test_complete_flushes_all_spans_plus_run_end(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    span1 = run.start_span("llm_call", name="step-1")
    span1.end(status="success")

    span2 = run.start_span("tool_call", name="step-2")
    span2.end(status="success")

    run.complete(status="completed")

    assert mock_http_send.call_count == 1
    (payloads,), _ = mock_http_send.call_args
    assert [p.type for p in payloads] == ["span", "span", "run_end"]
    assert payloads[-1].status == "completed"


def test_complete_is_idempotent(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    run.complete(status="completed")
    run.complete(status="failed")

    assert mock_http_send.call_count == 1


def test_preview_truncated_to_500_chars(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    span = run.start_span("llm_call", name="big-call", input_preview="i" * 600)
    span.end(output_preview="o" * 700)
    run.complete(status="completed")

    (payloads,), _ = mock_http_send.call_args
    span_payload = payloads[0]
    assert len(span_payload.input_preview) == MAX_PREVIEW_LENGTH
    assert len(span_payload.output_preview) == MAX_PREVIEW_LENGTH
    assert span_payload.input_preview == "i" * MAX_PREVIEW_LENGTH
    assert span_payload.output_preview == "o" * MAX_PREVIEW_LENGTH


def test_unknown_end_kwargs_become_metadata(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    span = run.start_span("llm_call", model="gpt-4o", input_preview="What is 2+2?")
    span.end(output_preview="4", tokens=100)
    run.complete()

    (payloads,), _ = mock_http_send.call_args
    span_payload = payloads[0]
    assert span_payload.model == "gpt-4o"
    assert span_payload.output_preview == "4"
    assert span_payload.metadata == {"tokens": 100}


def test_with_llm_span_success(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    with run.with_llm_span("gpt-4o completion", model="gpt-4o", input_preview="2+2?") as span:
        span.end(status="success", output_preview="4", input_tokens=5, output_tokens=1)

    run.complete(status="completed")

    (payloads,), _ = mock_http_send.call_args
    span_payload = payloads[0]
    assert span_payload.span_type == "llm_call"
    assert span_payload.model == "gpt-4o"
    assert span_payload.status == "success"


def test_with_llm_span_auto_ends_on_success(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    with run.with_llm_span("gpt-4o completion", model="gpt-4o"):
        pass

    run.complete(status="completed")

    (payloads,), _ = mock_http_send.call_args
    assert payloads[0].status == "success"


def test_with_http_span_records_error_on_exception(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    with pytest.raises(RuntimeError):
        with run.with_http_span("fetch-data", url="https://example.com/api", method="GET"):
            raise RuntimeError("boom")

    run.complete(status="failed")

    (payloads,), _ = mock_http_send.call_args
    span_payload = payloads[0]
    assert span_payload.span_type == "tool_call"
    assert span_payload.status == "error"
    assert span_payload.error_message == "boom"
    assert span_payload.metadata == {"url": "https://example.com/api", "method": "GET"}


def test_with_memory_span_sets_memory_type_metadata(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send)

    with run.with_memory_span("recall", memory_type="vector") as span:
        span.end(status="success", output_preview="found it")

    run.complete()

    (payloads,), _ = mock_http_send.call_args
    span_payload = payloads[0]
    assert span_payload.span_type == "memory_read"
    assert span_payload.metadata == {"memoryType": "vector"}


def test_flush_timer_flushes_without_finalizing_run(mock_http_send, synchronous_flush):
    run = _new_run(mock_http_send, flush_interval_ms=50)

    span = run.start_span("llm_call", name="step-1")
    span.end(status="success")

    time.sleep(0.2)

    assert mock_http_send.call_count == 1
    (payloads,), _ = mock_http_send.call_args
    assert [p.type for p in payloads] == ["span"]


def test_noop_run_makes_zero_http_calls(mock_http_send, synchronous_flush):
    from pulse_agent import AgentRun

    run = AgentRun.noop()
    span = run.start_span("llm_call", name="step-1")
    span.end(status="success")
    run.complete(status="completed")

    mock_http_send.assert_not_called()
