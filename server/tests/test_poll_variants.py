"""Unit tests for the poll-variant LLM retry/bail semantics.

`generate_variant_titles` must retry past a transient empty reply (small local
models like nous-hermes2 flake) but bail immediately on a hard failure so a
down endpoint isn't hammered for every attempt. These monkeypatch `_one_call`
so no real LLM/network is involved.
"""
from services import variant_llm


def _configure(monkeypatch):
    monkeypatch.setattr(variant_llm, "_LLM_URL", "http://stub/v1/chat/completions")
    monkeypatch.setattr(variant_llm, "_LLM_MODEL", "stub-model")


def test_retries_past_transient_empty_parse(monkeypatch):
    _configure(monkeypatch)
    calls = {"n": 0}

    def fake(base_title, want, avoid):
        calls["n"] += 1
        # First attempt flakes (parsed nothing); second succeeds.
        if calls["n"] == 1:
            return []
        return ["Should we order Thai?", "Should we cook at home?"][:want]

    monkeypatch.setattr(variant_llm, "_one_call", fake)
    out = variant_llm.generate_variant_titles("Should we get pizza?", 2)
    assert out == ["Should we order Thai?", "Should we cook at home?"]
    assert calls["n"] == 2  # retried past the empty first attempt


def test_bails_immediately_on_hard_failure(monkeypatch):
    _configure(monkeypatch)
    calls = {"n": 0}

    def fake(base_title, want, avoid):
        calls["n"] += 1
        return None  # endpoint down / HTTP error

    monkeypatch.setattr(variant_llm, "_one_call", fake)
    out = variant_llm.generate_variant_titles("Should we get pizza?", 2)
    assert out == []
    assert calls["n"] == 1  # did NOT burn the remaining attempts on a dead endpoint


def test_unconfigured_returns_empty_without_calling(monkeypatch):
    monkeypatch.setattr(variant_llm, "_LLM_URL", "")
    monkeypatch.setattr(variant_llm, "_LLM_MODEL", "")
    called = {"n": 0}

    def fake(*a, **k):
        called["n"] += 1
        return None

    monkeypatch.setattr(variant_llm, "_one_call", fake)
    assert variant_llm.generate_variant_titles("Should we get pizza?", 2) == []
    assert called["n"] == 0  # short-circuits on is_configured()
