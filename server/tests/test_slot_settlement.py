"""Deferred SETTLEMENT of slot-event parties (migration 162).

Tapping "I'm In" commits you to the ACTIVITY, not to a party. Confirmations
pool on the key's intake row until it is safe to split them — the deadline,
or earlier once nobody left undecided could change the split — so arrival
order can never squeeze anyone out. The pure partition solver + the
should-settle rule are tested directly; the API tests pin the end-to-end
behaviour, including the case the feature exists for: a tight maximum
tapped first no longer strands someone whose minimum needed the bigger
group."""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

import services.slot_events as se
from services.slot_events import _partition, _should_settle, settle_due_keys
from tests.conftest import TEST_DB_URL, bid_headers
from tests.test_slot_events import _act, _cand, _confirm, _create_slot, _day, _dtw, _events


@pytest.fixture(autouse=True)
def _deferred(monkeypatch):
    """A zero lead → the deadline IS the event start, always in the future
    for the far-out days these tests use, so a key only settles through the
    "safe" rules (or an explicit settle_due_keys(now=...) call)."""
    monkeypatch.setattr(se, "SETTLE_LEAD_HOURS", 0)


NOW = datetime(2030, 1, 1, tzinfo=timezone.utc)
LATER = NOW + timedelta(days=1)
EARLIER = NOW - timedelta(days=1)


# ---------------------------------------------------------------- solver

def test_partition_keeps_a_monotone_set_whole():
    a, b, c = _cand("a"), _cand("b"), _cand("c")
    assert [sorted(x.user_id for x in g) for g in _partition([a, b, c], {}, {})] == [["a", "b", "c"]]


def test_partition_splits_around_a_maximum_and_prefers_nobody_alone():
    # Owen caps at 3; five people → 3 + 2 beats 4 + 1 (nobody alone).
    owen = _cand("owen", max_people=3)
    others = [_cand(n) for n in ("maya", "nina", "sam", "theo")]
    groups = sorted((sorted(x.user_id for x in g) for g in _partition([owen] + others, {}, {})), key=len)
    assert [len(g) for g in groups] == [2, 3]
    assert "owen" in groups[1]


def test_partition_serves_a_minimum_over_a_tight_maximum():
    # Owen caps at 2, Theo needs 4: the only split that serves everyone is
    # Owen alone + the four — "fewest left out" outranks "nobody alone".
    owen = _cand("owen", max_people=2)
    theo = _cand("theo", min_people=4)
    rest = [_cand(n) for n in ("maya", "nina", "sam")]
    groups = sorted((sorted(x.user_id for x in g) for g in _partition([owen, theo] + rest, {}, {})), key=len)
    assert groups == [["owen"], ["maya", "nina", "sam", "theo"]]


def test_partition_respects_exclusions():
    nina = _cand("nina", exclude_people={"owen"})
    owen, sam = _cand("owen"), _cand("sam")
    groups = _partition([nina, owen, sam], {}, {})
    for g in groups:
        ids = {x.user_id for x in g}
        assert not ({"nina", "owen"} <= ids)


def test_partition_greedy_path_still_valid():
    cands = [_cand(f"u{i}", max_people=4) for i in range(se.SETTLE_SOLVER_CAP + 3)]
    groups = _partition(cands, {}, {})
    assert sum(len(g) for g in groups) == len(cands)
    assert all(len(g) <= 4 for g in groups)


# ---------------------------------------------------------------- should-settle rule

def _pool(*cs):
    return {c.user_id: c for c in cs}


def test_should_settle_on_deadline():
    cands = _pool(_cand("a", max_people=2), _cand("b"), _cand("c"))
    assert _should_settle(NOW, EARLIER, cands, {"a"}, {}, {})
    assert not _should_settle(NOW, LATER, cands, {"a"}, {}, {})


def test_should_settle_at_once_when_the_pool_is_monotone():
    cands = _pool(_cand("a"), _cand("b"), _cand("c"))
    assert _should_settle(NOW, LATER, cands, {"a"}, {}, {})


def test_should_settle_once_everyone_confirmed():
    cands = _pool(_cand("a", max_people=2), _cand("b"), _cand("c"))
    assert not _should_settle(NOW, LATER, cands, {"a", "b"}, {}, {})
    assert _should_settle(NOW, LATER, cands, {"a", "b", "c"}, {}, {})


def test_should_settle_when_no_latecomer_could_share_a_party():
    # d's window never meets anyone's → their tap can only start a separate
    # party, so the confirmed split is safe to decide now.
    cands = _pool(_cand("a", max_people=2), _cand("b"), _cand("d", windows=((1200, 1300),)))
    assert _should_settle(NOW, LATER, cands, {"a", "b"}, {}, {})
    # ...but a compatible latecomer holds it open — saturation is NOT safety.
    cands = _pool(_cand("a", max_people=2), _cand("b"), _cand("c"))
    assert not _should_settle(NOW, LATER, cands, {"a", "b"}, {}, {})


# ---------------------------------------------------------------- API

def _mk(client, bid, day, act, **who):
    a = {"name": act}
    if who:
        a["who_with"] = [who]
    _create_slot(client, browser_id=bid, day_time_windows=_dtw(day), activities=[a])


def _settle_now(day):
    with psycopg.connect(TEST_DB_URL, row_factory=psycopg.rows.dict_row) as conn:
        settled = settle_due_keys(conn, [day], now=datetime.now(timezone.utc) + timedelta(days=3650))
        conn.commit()
    return settled


def test_tight_maximum_tapped_first_no_longer_strands_a_minimum(client):
    """THE case: Owen (max 2) taps first with Sam. Under instant settlement
    Maya/Nina/Theo were left to form a 3 — and Theo (min 4) got nothing.
    Pooled + settled later, the engine puts Owen alone and the four together:
    everyone served."""
    day = _day(6)
    act = _act("Trivia")
    owen, sam, maya, nina, theo = (str(uuid.uuid4()) for _ in range(5))
    _mk(client, owen, day, act, max_people=2)
    _mk(client, theo, day, act, min_people=4)
    for b in (sam, maya, nina):
        _mk(client, b, day, act)

    r = _confirm(client, browser_id=owen, day=day, activity=act)
    assert r.status_code == 200 and r.json()["settled"] is False
    intake = r.json()["id"]
    for b in (sam, maya, nina):
        card = _confirm(client, browser_id=b, day=day, activity=act).json()
        assert card["id"] == intake and card["settled"] is False and card["can_confirm"]
    # Theo is NOT locked out by the four already in.
    theo_card = next(e for e in _events(client, browser_id=theo) if e["id"] == intake)
    assert theo_card["can_confirm"] and theo_card["settled"] is False
    card = _confirm(client, browser_id=theo, day=day, activity=act).json()
    # Everyone has confirmed → settled at once, and the split serves all five.
    assert card["settled"] is True
    theo_cards = _events(client, browser_id=theo)
    mine = next(e for e in theo_cards if e["viewer_confirmed"])
    assert mine["met"] and mine["confirmed_count"] == 4
    owen_cards = _events(client, browser_id=owen)
    owen_mine = next(e for e in owen_cards if e["viewer_confirmed"])
    assert owen_mine["confirmed_count"] == 1 and owen_mine["met"]  # alone, and that's a met event


def test_monotone_pool_settles_on_first_confirm(client):
    """No maxima / exclusions anywhere → nothing to defer: the old instant
    behaviour, settled from the first tap."""
    day = _day(6)
    act = _act("Walk")
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    _mk(client, a, day, act)
    _mk(client, b, day, act)
    r = _confirm(client, browser_id=a, day=day, activity=act).json()
    assert r["settled"] is True and r["settles_at"] is None
    assert _confirm(client, browser_id=b, day=day, activity=act).json()["met"]


def test_unsettled_card_reports_the_provisional_split(client):
    """Before settlement `met` reads off the provisional split: two in who
    fit together → both see "on"; a third whose max is 1 sees Pending."""
    day = _day(6)
    act = _act("Sauna")
    a, b, loner = (str(uuid.uuid4()) for _ in range(3))
    _mk(client, a, day, act)
    _mk(client, b, day, act)
    _mk(client, loner, day, act, max_people=1)
    _confirm(client, browser_id=a, day=day, activity=act)
    card = _confirm(client, browser_id=b, day=day, activity=act).json()
    assert card["settled"] is False and card["met"] and card["confirmed_count"] == 2
    assert card["settles_at"] and card["settles_at"].endswith("+00:00")


def test_deadline_settles_and_splits_into_parties(client):
    day = _day(6)
    act = _act("Climb")
    a, b, c = (str(uuid.uuid4()) for _ in range(3))
    _mk(client, a, day, act, max_people=2)
    _mk(client, b, day, act)
    _mk(client, c, day, act)
    _mk(client, str(uuid.uuid4()), day, act)  # an undecided 4th keeps it open
    intake = _confirm(client, browser_id=a, day=day, activity=act).json()["id"]
    _confirm(client, browser_id=b, day=day, activity=act)
    _confirm(client, browser_id=c, day=day, activity=act)
    assert all(e["settled"] is False for e in _events(client, browser_id=a) if e["id"] == intake)
    assert _settle_now(day) == [intake]
    # a's cap of 2 → {a, x} + {y}: two settled parties, ranks/ids intact.
    ids = {e["id"] for e in _events(client, browser_id=b) if e["id"]}
    assert intake in ids and len(ids) == 2
    for bid in (a, b, c):
        mine = next(e for e in _events(client, browser_id=bid) if e["viewer_confirmed"])
        assert mine["settled"] is True and mine["settles_at"] is None


def test_backing_out_of_the_pool_and_late_join_after_settlement(client):
    day = _day(6)
    act = _act("Bowling")
    a, b, c = (str(uuid.uuid4()) for _ in range(3))
    _mk(client, a, day, act, max_people=2)
    _mk(client, b, day, act)
    _mk(client, c, day, act)
    _confirm(client, browser_id=a, day=day, activity=act)
    _confirm(client, browser_id=b, day=day, activity=act)
    r = _confirm(client, browser_id=b, day=day, activity=act, confirmed=False).json()
    assert not r["viewer_confirmed"]
    # Everyone left decides → settled; c then joins post-settlement under the
    # party rules (a's pair has room).
    _settle_now(day)
    card = _confirm(client, browser_id=c, day=day, activity=act).json()
    assert card["settled"] is True and card["met"] and card["confirmed_count"] == 2
