from unittest.mock import patch

from pulse_agent import AgentRun, PulseAgent
from pulse_agent.http import HttpClient
from pulse_agent.types import AgentSpanPayload


def test_start_run_sends_run_start_payload(mock_http_send, synchronous_flush):
    agent = PulseAgent(api_key="test-key", base_url="http://localhost:3000")
    run = agent.start_run("Summarize report", metadata={"triggeredBy": "cron"})

    assert isinstance(run, AgentRun)
    assert mock_http_send.call_count == 1

    (payloads,), _ = mock_http_send.call_args
    assert len(payloads) == 1

    payload = payloads[0].to_wire()
    assert payload["type"] == "run_start"
    assert payload["task"] == "Summarize report"
    assert isinstance(payload["runId"], str)
    assert isinstance(payload["startedAt"], str)
    assert payload["metadata"]["triggeredBy"] == "cron"


def test_default_host_is_usepulse():
    agent = PulseAgent(api_key="test-key")
    assert agent._host == "https://api.usepulse.dev"


def test_custom_base_url_is_used(mock_http_send, synchronous_flush):
    agent = PulseAgent(api_key="test-key", base_url="http://localhost:3000")
    assert agent._host == "http://localhost:3000"


def test_no_op_mode_makes_zero_http_calls(monkeypatch, mock_http_send, synchronous_flush):
    monkeypatch.setenv("PULSE_DISABLED", "true")

    agent = PulseAgent(api_key="test-key", base_url="http://localhost:3000")
    run = agent.start_run("Test task")
    span = run.start_span("llm_call", name="step-1", input_preview="Hello")
    span.end(output_preview="World", status="success")
    run.complete(status="completed")

    assert mock_http_send.call_count == 0


def test_send_sets_authorization_header_and_url():
    client = HttpClient("http://localhost:3000", "test-key")
    payload = AgentSpanPayload(type="run_start", run_id="r1", started_at="2024-01-01T00:00:00.000Z", task="Test")

    with patch("pulse_agent.http.httpx.post") as mock_post:
        mock_post.return_value.status_code = 200
        client.send([payload])

    args, kwargs = mock_post.call_args
    assert args[0] == "http://localhost:3000/ingest/agent-span"
    assert kwargs["headers"]["Authorization"] == "Bearer test-key"
    assert kwargs["json"] == [payload.to_wire()]


def test_api_key_never_appears_in_logs(caplog):
    client = HttpClient("http://localhost:3000", "super-secret-key")
    payload = AgentSpanPayload(type="run_start", run_id="r1", started_at="2024-01-01T00:00:00.000Z", task="Test")

    with patch("pulse_agent.http.httpx.post", side_effect=ConnectionError("boom")), \
            patch("pulse_agent.http.time.sleep"):
        client.send([payload])

    assert "super-secret-key" not in caplog.text


def test_send_retries_on_failure_then_gives_up_silently():
    client = HttpClient("http://localhost:3000", "test-key")
    payload = AgentSpanPayload(type="run_start", run_id="r1", started_at="2024-01-01T00:00:00.000Z", task="Test")

    with patch("pulse_agent.http.httpx.post", side_effect=ConnectionError("boom")) as mock_post, \
            patch("pulse_agent.http.time.sleep") as mock_sleep:
        client.send([payload])  # must not raise

    assert mock_post.call_count == 3
    assert mock_sleep.call_count == 2
