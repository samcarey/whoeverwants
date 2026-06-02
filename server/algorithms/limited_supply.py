"""Limited-supply question resolution.

There are `supply_count` slots for something; voters claim them first-come,
first-served. A vote is a CLAIM (is_abstain = false) or a DECLINE
(is_abstain = true). Claims are ordered by `created_at` (earliest first);
the first `supply_count` slots are secured, the rest waitlisted. Declines never
take a slot, so if an earlier claimer switches to a decline (edit), the
ordering recomputes and the next waitlisted claimer is promoted.

A single claim can take MORE THAN ONE slot via the "plus one/more" feature:
a vote that represents the submitter plus N additional people (the optional
`plus_one_names` array) consumes `1 + N` slots. The claim is expanded into one
SupplyClaim per represented person (the submitter first, then each named/unnamed
plus-one), all sharing the claim's `created_at` so they stay contiguous in the
first-come ordering. Because slots are awarded per person, a claim can straddle
the secured/waitlist boundary — e.g. for 2 spots a "me + 2 friends" claim
secures 2 people and waitlists the third (first-come, first-served per head,
maximizing utilization rather than wasting the remaining spots).
"""

from dataclasses import dataclass
from datetime import datetime

from algorithms.weights import vote_weight


@dataclass
class SupplyClaim:
    name: str | None
    secured: bool
    position: int  # 1-based rank among claims (claim order)
    created_at: str  # ISO timestamp of the claim (the first-come ordering key)


@dataclass
class LimitedSupplyResult:
    supply_count: int
    claim_count: int  # total people claiming (a plus-one claim counts each head)
    secured_count: int  # min(claim_count, supply_count)
    waitlist_count: int  # max(claim_count - supply_count, 0)
    is_full: bool
    claims: list[SupplyClaim]  # one entry per person, ordered by claim time, secured first


def _created_at_key(vote: dict):
    val = vote.get("created_at")
    if isinstance(val, datetime):
        return val
    # Fall back to string sort (ISO timestamps sort lexicographically) so the
    # algorithm is robust whether the row carries a datetime or a string.
    return str(val or "")


def _created_at_iso(vote: dict) -> str:
    val = vote.get("created_at")
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val or "")


def calculate_limited_supply_result(
    votes: list[dict], supply_count: int
) -> LimitedSupplyResult:
    """Resolve a limited-supply question.

    Args:
        votes: vote dicts, each with `is_abstain`, `voter_name`, `created_at`.
        supply_count: number of available slots (>= 1).
    """
    supply = max(int(supply_count or 0), 0)

    claim_votes = [v for v in votes if not v.get("is_abstain", False)]
    claim_votes.sort(key=_created_at_key)

    # Expand each claim into one entry per represented person: the submitter
    # first, then each plus-one (named or "" = unnamed). All share the claim's
    # created_at, so they stay grouped in claim order. `position` is the global
    # 1-based rank across every person; the first `supply` are secured.
    claims: list[SupplyClaim] = []
    position = 0
    for vote in claim_votes:
        created = _created_at_iso(vote)
        weight = vote_weight(vote)
        raw_plus_ones = vote.get("plus_one_names")
        plus_ones = raw_plus_ones if isinstance(raw_plus_ones, list) else []
        for person_idx in range(weight):
            if person_idx == 0:
                name = vote.get("voter_name")
            else:
                # plus_ones has `weight - 1` entries; guard defensively in case a
                # malformed row's weight and array length disagree.
                pidx = person_idx - 1
                name = plus_ones[pidx] if pidx < len(plus_ones) else None
            position += 1
            claims.append(
                SupplyClaim(
                    # "" (an unnamed plus-one) collapses to None so the FE shows
                    # its generic "Spot taken" / "Waiting" placeholder.
                    name=name or None,
                    secured=position <= supply,
                    position=position,
                    created_at=created,
                )
            )

    claim_count = len(claims)
    secured_count = min(claim_count, supply)
    waitlist_count = max(claim_count - supply, 0)

    return LimitedSupplyResult(
        supply_count=supply,
        claim_count=claim_count,
        secured_count=secured_count,
        waitlist_count=waitlist_count,
        is_full=claim_count >= supply,
        claims=claims,
    )
