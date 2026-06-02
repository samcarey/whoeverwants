"""Limited-supply question resolution.

There are `supply_count` slots for something; voters claim them first-come,
first-served. A vote is a CLAIM (is_abstain = false) or a DECLINE
(is_abstain = true). Claims are ordered by `created_at` (earliest first);
the first `supply_count` are secured, the rest waitlisted. Declines never
take a slot, so if an earlier claimer switches to a decline (edit), the
ordering recomputes and the next waitlisted claimer is promoted.
"""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class SupplyClaim:
    name: str | None
    secured: bool
    position: int  # 1-based rank among claims (claim order)
    created_at: str  # ISO timestamp of the claim (the first-come ordering key)


@dataclass
class LimitedSupplyResult:
    supply_count: int
    claim_count: int  # total claims (secured + waitlisted)
    secured_count: int  # min(claim_count, supply_count)
    waitlist_count: int  # max(claim_count - supply_count, 0)
    is_full: bool
    claims: list[SupplyClaim]  # ordered by claim time, secured first


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

    claims: list[SupplyClaim] = []
    for idx, vote in enumerate(claim_votes):
        claims.append(
            SupplyClaim(
                name=vote.get("voter_name"),
                secured=idx < supply,
                position=idx + 1,
                created_at=_created_at_iso(vote),
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
