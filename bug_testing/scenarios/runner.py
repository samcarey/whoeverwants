"""Test runner that captures every result and any failure as a finding."""
import json
import time
import traceback
from contextlib import contextmanager
from typing import Any, Dict, List, Optional


class Finding:
    """One bug, observation, or improvement opportunity."""
    SEVERITY = ["INFO", "MINOR", "MAJOR", "CRITICAL"]

    def __init__(self, scenario: str, category: str, severity: str, summary: str,
                 detail: str = "", evidence: Optional[Dict] = None,
                 fixed: bool = False):
        assert severity in self.SEVERITY, severity
        self.scenario = scenario
        self.category = category
        self.severity = severity
        self.summary = summary
        self.detail = detail
        self.evidence = evidence or {}
        self.fixed = fixed
        self.timestamp = time.time()


class TestResult:
    def __init__(self, name: str, group: str):
        self.name = name
        self.group = group
        self.status = "pending"  # pending | pass | fail | error | skip
        self.duration_ms = 0
        self.notes: List[str] = []
        self.findings: List[Finding] = []
        self.error: Optional[str] = None
        self.traceback: Optional[str] = None
        self.evidence: Dict[str, Any] = {}

    def note(self, msg: str):
        self.notes.append(msg)

    def finding(self, **kw):
        self.findings.append(Finding(scenario=self.name, **kw))

    def evid(self, **kw):
        self.evidence.update(kw)

    def to_dict(self):
        return {
            "name": self.name,
            "group": self.group,
            "status": self.status,
            "duration_ms": self.duration_ms,
            "notes": self.notes,
            "findings": [
                {
                    "scenario": f.scenario, "category": f.category,
                    "severity": f.severity, "summary": f.summary,
                    "detail": f.detail, "evidence": f.evidence,
                    "fixed": f.fixed,
                }
                for f in self.findings
            ],
            "error": self.error,
            "traceback": self.traceback,
            "evidence": self.evidence,
        }


class Runner:
    def __init__(self):
        self.results: List[TestResult] = []

    @contextmanager
    def case(self, name: str, group: str = "general"):
        r = TestResult(name, group)
        self.results.append(r)
        t0 = time.time()
        try:
            yield r
            if r.status == "pending":
                r.status = "pass"
        except AssertionError as e:
            r.status = "fail"
            r.error = str(e)
            r.traceback = traceback.format_exc()
        except Exception as e:
            r.status = "error"
            r.error = f"{type(e).__name__}: {e}"
            r.traceback = traceback.format_exc()
        finally:
            r.duration_ms = int((time.time() - t0) * 1000)

    def summary(self):
        out = {"pass": 0, "fail": 0, "error": 0, "skip": 0}
        for r in self.results:
            out[r.status] = out.get(r.status, 0) + 1
        return out

    def save(self, path: str):
        with open(path, "w") as f:
            json.dump({
                "results": [r.to_dict() for r in self.results],
                "summary": self.summary(),
            }, f, indent=2, default=str)


def assert_eq(actual, expected, msg=""):
    if actual != expected:
        raise AssertionError(f"{msg}: expected {expected!r}, got {actual!r}")


def assert_true(cond, msg=""):
    if not cond:
        raise AssertionError(msg or "assertion failed")


def assert_in(needle, haystack, msg=""):
    if needle not in haystack:
        raise AssertionError(f"{msg}: {needle!r} not in {haystack!r}")


def assert_lt(a, b, msg=""):
    if not a < b:
        raise AssertionError(f"{msg}: {a!r} not < {b!r}")


def assert_le(a, b, msg=""):
    if not a <= b:
        raise AssertionError(f"{msg}: {a!r} not <= {b!r}")
