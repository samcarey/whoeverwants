"""Thin API helper that mirrors what the frontend would send."""
import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional
import httpx

API_BASE = os.environ.get("API_BASE", "https://api.latest.whoeverwants.com")
DEFAULT_TIMEOUT = 30.0
MAX_429_RETRIES = 6
MAX_429_BACKOFF = 20.0
THROTTLE_S = float(os.environ.get("API_THROTTLE", "0.15"))


def _request_with_retry(client: httpx.Client, method: str, url: str, **kwargs):
    """Retry on 429 with exponential backoff + base throttle."""
    if THROTTLE_S > 0:
        time.sleep(THROTTLE_S)
    for attempt in range(MAX_429_RETRIES):
        resp = client.request(method, url, **kwargs)
        if resp.status_code != 429:
            return resp
        wait = min(2.0 ** attempt, MAX_429_BACKOFF)
        time.sleep(wait)
    return resp


class Browser:
    """Simulates one browser/device with its own browser_id, like a real user."""

    def __init__(self, name: str = "anon", api_base: str = API_BASE):
        self.name = name
        self.browser_id = str(uuid.uuid4())
        self.client = httpx.Client(base_url=api_base, timeout=DEFAULT_TIMEOUT)
        self.creator_secrets: Dict[str, str] = {}

    def close(self):
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    @property
    def headers(self):
        return {"X-Browser-Id": self.browser_id, "Content-Type": "application/json"}

    def _req(self, method, url, **kw):
        kw.setdefault("headers", self.headers)
        return _request_with_retry(self.client, method, url, **kw)

    # ── Poll create ──
    def create_poll(
        self,
        questions: List[Dict],
        *,
        group_id: Optional[str] = None,
        title: Optional[str] = None,
        creator_name: Optional[str] = None,
        details: Optional[str] = None,
        response_deadline: Optional[str] = None,
        prephase_deadline: Optional[str] = None,
        prephase_deadline_minutes: Optional[int] = None,
        allow_pre_ranking: Optional[bool] = None,
        show_preliminary_results: Optional[bool] = None,
        min_responses: Optional[int] = None,
        context: Optional[str] = None,
        is_auto_title: Optional[bool] = None,
        group_title: Optional[str] = None,
    ) -> Dict:
        creator_secret = f"test-{uuid.uuid4().hex[:12]}"
        body: Dict[str, Any] = {
            "creator_secret": creator_secret,
            "questions": questions,
        }
        for k, v in [
            ("group_id", group_id),
            ("title", title),
            ("creator_name", creator_name),
            ("details", details),
            ("response_deadline", response_deadline),
            ("prephase_deadline", prephase_deadline),
            ("prephase_deadline_minutes", prephase_deadline_minutes),
            ("allow_pre_ranking", allow_pre_ranking),
            ("show_preliminary_results", show_preliminary_results),
            ("min_responses", min_responses),
            ("context", context),
            ("is_auto_title", is_auto_title),
            ("group_title", group_title),
        ]:
            if v is not None:
                body[k] = v
        resp = self._req("POST", "/api/polls", json=body)
        if resp.status_code != 201:
            raise RuntimeError(f"create_poll failed {resp.status_code}: {resp.text}")
        data = resp.json()
        self.creator_secrets[data["id"]] = creator_secret
        return data

    # ── Voting ──
    def submit_votes(self, poll_id: str, voter_name: Optional[str], items: List[Dict]) -> List[Dict]:
        body = {"items": items}
        if voter_name:
            body["voter_name"] = voter_name
        resp = self._req("POST", f"/api/polls/{poll_id}/votes", json=body)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"submit_votes failed {resp.status_code}: {resp.text}")
        return resp.json()

    # ── Reads ──
    def get_poll(self, poll_id: str) -> Dict:
        r = self._req("GET", f"/api/polls/by-id/{poll_id}")
        if r.status_code != 200:
            raise RuntimeError(f"get_poll failed {r.status_code}: {r.text}")
        return r.json()

    def get_poll_by_short(self, short_id: str) -> Dict:
        r = self._req("GET", f"/api/polls/{short_id}")
        if r.status_code != 200:
            raise RuntimeError(f"get_poll_by_short failed {r.status_code}: {r.text}")
        return r.json()

    def get_question_results(self, qid: str) -> Dict:
        r = self._req("GET", f"/api/questions/{qid}/results")
        if r.status_code != 200:
            raise RuntimeError(f"results failed {r.status_code}: {r.text}")
        return r.json()

    def get_question_votes(self, qid: str) -> List[Dict]:
        r = self._req("GET", f"/api/questions/{qid}/votes")
        if r.status_code != 200:
            raise RuntimeError(f"votes failed {r.status_code}: {r.text}")
        return r.json()

    def get_my_groups(self, accessible_question_ids: Optional[List[str]] = None) -> List[Dict]:
        body = {"accessible_question_ids": accessible_question_ids or []}
        r = self._req("POST", "/api/groups/mine", json=body)
        if r.status_code != 200:
            raise RuntimeError(f"my_groups failed {r.status_code}: {r.text}")
        return r.json()

    def get_group_by_route(self, route_id: str, p: Optional[str] = None) -> List[Dict]:
        params = {"p": p} if p else None
        r = self._req("GET", f"/api/groups/by-route-id/{route_id}", params=params)
        if r.status_code != 200:
            raise RuntimeError(f"group_by_route failed {r.status_code}: {r.text}")
        return r.json()

    def get_group_summary(self, route_id: str) -> Dict:
        r = self._req("GET", f"/api/groups/by-route-id/{route_id}/summary")
        if r.status_code != 200:
            raise RuntimeError(f"group_summary failed {r.status_code}: {r.text}")
        return r.json()

    def create_empty_group(self) -> Dict:
        r = self._req("POST", "/api/groups")
        if r.status_code != 201:
            raise RuntimeError(f"create_empty failed {r.status_code}: {r.text}")
        return r.json()

    def leave_group(self, route_id: str) -> int:
        r = self._req("DELETE", f"/api/groups/{route_id}/membership")
        return r.status_code

    def close_poll(self, poll_id: str) -> Dict:
        secret = self.creator_secrets.get(poll_id)
        if not secret:
            raise RuntimeError(f"no creator secret for {poll_id}")
        r = self._req("POST", f"/api/polls/{poll_id}/close",
                      json={"creator_secret": secret})
        if r.status_code != 200:
            raise RuntimeError(f"close failed {r.status_code}: {r.text}")
        return r.json()

    def reopen_poll(self, poll_id: str) -> Dict:
        secret = self.creator_secrets.get(poll_id)
        if not secret:
            raise RuntimeError(f"no creator secret for {poll_id}")
        r = self._req("POST", f"/api/polls/{poll_id}/reopen",
                      json={"creator_secret": secret})
        if r.status_code != 200:
            raise RuntimeError(f"reopen failed {r.status_code}: {r.text}")
        return r.json()

    def cutoff_suggestions(self, poll_id: str) -> Dict:
        secret = self.creator_secrets.get(poll_id)
        r = self._req("POST", f"/api/polls/{poll_id}/cutoff-suggestions",
                      json={"creator_secret": secret})
        if r.status_code != 200:
            raise RuntimeError(f"cutoff failed {r.status_code}: {r.text}")
        return r.json()

    def update_group_title(self, route_id: str, title: Optional[str]) -> Dict:
        r = self._req("POST", f"/api/groups/{route_id}/title",
                      json={"group_title": title})
        if r.status_code != 200:
            raise RuntimeError(f"title failed {r.status_code}: {r.text}")
        return r.json()


def yes_no_q(category: str = "yes_no", details: Optional[str] = None) -> Dict:
    q = {"question_type": "yes_no", "category": category}
    # Server expects per-question disambiguator as `context` at create time
    # (it's stored as `questions.details` and surfaced as `details` in responses).
    if details:
        q["context"] = details
    return q


def ranked_choice_q(options: List[str], *, category: str = "custom",
                    details: Optional[str] = None,
                    options_metadata: Optional[Dict] = None) -> Dict:
    q = {"question_type": "ranked_choice", "category": category, "options": options}
    if details:
        q["context"] = details
    if options_metadata:
        q["options_metadata"] = options_metadata
    return q


def suggestion_q(*, category: str = "custom", details: Optional[str] = None,
                 suggestion_deadline_minutes: int = 60) -> Dict:
    """A ranked_choice question in 'suggestion phase' has no options at create time."""
    q = {
        "question_type": "ranked_choice",
        "category": category,
        "suggestion_deadline_minutes": suggestion_deadline_minutes,
    }
    if details:
        q["context"] = details
    return q


def time_q(*, day_time_windows: List[Dict], duration_window: Optional[Dict] = None,
           min_availability_percent: int = 95, details: Optional[str] = None) -> Dict:
    q = {
        "question_type": "time",
        "category": "custom",
        "day_time_windows": day_time_windows,
        "min_availability_percent": min_availability_percent,
    }
    if duration_window:
        q["duration_window"] = duration_window
    if details:
        q["context"] = details
    return q
