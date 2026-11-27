"""Security limits and gates on the service API.

The service trusts nothing in a request body: any Google account can sign in
to the webapp, and the webapp forwards bodies here. These tests pin the
limits that stop one request from exhausting the host or the OpenAI budget,
and the gates that stop a request from steering outbound calls.
"""

import os

os.environ.setdefault("OPENAI_API_KEY", "")
os.environ.setdefault("MODEL_SERVER_URL", "")
os.environ.setdefault("PROJECTOR_URL", "http://projector-test:8001")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from src.api.model_url import effective_model_url  # noqa: E402
from src.core.settings import get_settings  # noqa: E402
from src.llm.models import DEFAULT_MODEL, resolve  # noqa: E402

BASE_CHAT = {
    "message": "hi",
    "history": [],
    "model": "astromind-multi-agent",
    "response_format": "text",
    "data_obj": {"event_list": [[0, 1000]]},
}


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def test_event_list_too_long_is_rejected(client):
    events = [[float(i), 1000.0] for i in range(50_001)]
    r = client.post("/v1/embeddings", json={"event_list": events})
    assert r.status_code == 413


def test_event_list_time_span_too_long_is_rejected(client):
    r = client.post(
        "/v1/object-details-enhanced",
        json={"object_data": {"original_event_list": [[0.0, 1000.0], [3e6, 1000.0]]}},
    )
    assert r.status_code == 413


def test_non_finite_times_are_rejected(client):
    r = client.post(
        "/v1/object-details-enhanced",
        content='{"object_data":{"event_list":[[0,1000],[Infinity,1]]}}',
        headers={"content-type": "application/json"},
    )
    assert r.status_code == 422


@pytest.mark.parametrize(
    "override",
    [
        {"neighbors": [{}] * 26},
        {"message": "x" * 20_001},
        {"history": [{"role": "user", "content": "x"}] * 51},
        {"history": [{"role": "user", "content": "x" * 30_000}] * 4},
        {"max_new_tokens": 100_000},
    ],
)
def test_oversized_chat_requests_are_rejected(client, override):
    r = client.post("/v1/chat/stream", json={**BASE_CHAT, **override})
    assert r.status_code in (413, 422)


def test_no_cors_for_arbitrary_origins(client):
    r = client.options(
        "/v1/chat/stream",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_unknown_openai_models_fall_back_to_default():
    assert resolve("o1-pro") == (get_settings().openai_default_model or DEFAULT_MODEL)
    assert resolve("gpt-5.6-luna") == "gpt-5.6-luna"


def test_client_model_url_ignored_unless_allowed(monkeypatch):
    assert effective_model_url("http://169.254.169.254/", "http://configured") == "http://configured"
    monkeypatch.setenv("ALLOW_CUSTOM_MODEL_URL", "true")
    get_settings.cache_clear()
    try:
        assert effective_model_url("http://custom", "http://configured") == "http://custom"
    finally:
        monkeypatch.delenv("ALLOW_CUSTOM_MODEL_URL")
        get_settings.cache_clear()
