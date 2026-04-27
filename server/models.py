"""Pydantic models for API request/response validation."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class PollType(str, Enum):
    yes_no = "yes_no"
    ranked_choice = "ranked_choice"
    time = "time"


class CloseReason(str, Enum):
    manual = "manual"
    deadline = "deadline"
    max_capacity = "max_capacity"


# -- Request models --
#
# Phase 5: the legacy `CreatePollRequest` is gone — every poll is created via
# `CreateMultipollRequest` + `CreateSubPollRequest` defined further below.


class SubmitVoteRequest(BaseModel):
    vote_type: str
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    # Tiered ballot for equal/tied rankings: list of tiers, each a list of
    # equally-ranked options. E.g. [["A"], ["B", "C"]] means A is 1st and
    # B and C are tied for 2nd. Optional — when absent, ranked_choices is
    # used as a flat ordering.
    ranked_choice_tiers: list[list[str]] | None = None
    suggestions: list[str] | None = None
    is_abstain: bool = False
    is_ranking_abstain: bool = False
    voter_name: str | None = None
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None
    # Metadata for suggested options (merged into poll's options_metadata)
    options_metadata: dict | None = None
    # Time poll preference reactions
    liked_slots: list[str] | None = None
    disliked_slots: list[str] | None = None


class EditVoteRequest(BaseModel):
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    ranked_choice_tiers: list[list[str]] | None = None
    suggestions: list[str] | None = None
    is_abstain: bool = False
    is_ranking_abstain: bool = False
    voter_name: str | None = None
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None
    # Time poll preference reactions
    liked_slots: list[str] | None = None
    disliked_slots: list[str] | None = None


class MultipollVoteItem(BaseModel):
    """One sub-poll's worth of vote data inside a unified multipoll submission.

    `vote_id` toggles insert vs. update: when set, the row identified by
    `vote_id` (which must already be on `sub_poll_id`) is updated; when null, a
    new row is inserted. Mirrors per-sub-poll `SubmitVoteRequest` /
    `EditVoteRequest` payloads minus `voter_name` (which is multipoll-level —
    one voter, many sub-poll ballots in one transaction).
    """

    sub_poll_id: str
    vote_id: str | None = None
    vote_type: str
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    ranked_choice_tiers: list[list[str]] | None = None
    suggestions: list[str] | None = None
    is_abstain: bool = False
    is_ranking_abstain: bool = False
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None
    options_metadata: dict | None = None
    liked_slots: list[str] | None = None
    disliked_slots: list[str] | None = None


class SubmitMultipollVotesRequest(BaseModel):
    """Atomic multi-sub-poll vote submission. All `items` are inserted/updated
    in a single transaction; any item failure rolls back every other item."""

    voter_name: str | None = None
    items: list[MultipollVoteItem] = Field(..., min_length=1)


class ClosePollRequest(BaseModel):
    creator_secret: str
    close_reason: CloseReason = CloseReason.manual


class ReopenPollRequest(BaseModel):
    creator_secret: str


class UpdateThreadTitleRequest(BaseModel):
    # Empty string or all-whitespace clears the override (stored as NULL).
    thread_title: str | None = None


class CutoffSuggestionsRequest(BaseModel):
    creator_secret: str


class AccessiblePollsRequest(BaseModel):
    poll_ids: list[str]
    include_results: bool = False


class RelatedPollsRequest(BaseModel):
    poll_ids: list[str] = Field(..., max_length=100)


class RelatedPollsResponse(BaseModel):
    all_related_ids: list[str]
    original_count: int
    discovered_count: int


# -- Response models --


class PollResponse(BaseModel):
    """Sub-poll API response shape.

    Wrapper-level fields (creator_secret, response_deadline, is_closed,
    close_reason, short_id, thread_title, suggestion_deadline, creator_name)
    are sourced from the parent multipoll via JOIN — see `_SELECT_POLL_FULL`
    in `routers/polls.py`. They remain on `PollResponse` so that legacy FE
    callsites that read `poll.is_closed` etc. keep working without a 30-file
    refactor; the long-term direction (per CLAUDE.md → Addressability) is for
    the FE to source these from the `Multipoll` wrapper directly.
    """

    id: str
    title: str
    poll_type: str
    options: list[str] | None = None
    response_deadline: str | None = None
    created_at: str
    updated_at: str
    creator_secret: str | None = None
    creator_name: str | None = None
    is_closed: bool = False
    close_reason: str | None = None
    short_id: str | None = None
    suggestion_deadline: str | None = None
    suggestion_deadline_minutes: int | None = None
    allow_pre_ranking: bool = True
    auto_close_after: int | None = None
    details: str | None = None
    day_time_windows: list[dict] | None = None
    duration_window: dict | None = None
    category: str | None = None
    options_metadata: dict | None = None
    reference_latitude: float | None = None
    reference_longitude: float | None = None
    reference_location_label: str | None = None
    is_auto_title: bool = False
    min_responses: int | None = None
    show_preliminary_results: bool = True
    response_count: int | None = None
    min_availability_percent: int | None = None
    thread_title: str | None = None
    # Phase 2.5: multipoll wrapper this poll belongs to. Phase 4 backfilled
    # every non-participation poll; Phase 5 makes participation polls go
    # away entirely, so this is effectively NOT NULL on every row.
    multipoll_id: str | None = None
    sub_poll_index: int | None = None
    # Phase 3.5: the wrapper's `follow_up_to` (a multipoll_id, or None for
    # thread roots). The FE walks this for thread chains.
    multipoll_follow_up_to: str | None = None
    results: "PollResultsResponse | None" = None
    voter_names: list[str] | None = None


class VoteResponse(BaseModel):
    id: str
    poll_id: str
    vote_type: str
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    ranked_choice_tiers: list[list[str]] | None = None
    suggestions: list[str] | None = None
    is_abstain: bool = False
    is_ranking_abstain: bool = False
    voter_name: str | None = None
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None
    liked_slots: list[str] | None = None
    disliked_slots: list[str] | None = None
    created_at: str
    updated_at: str


class SuggestionCountResponse(BaseModel):
    option: str
    count: int


class PollResultsResponse(BaseModel):
    poll_id: str
    title: str
    poll_type: str
    created_at: str
    response_deadline: str | None = None
    options: list[str] | None = None
    yes_count: int | None = None
    no_count: int | None = None
    abstain_count: int | None = None
    total_votes: int = 0
    yes_percentage: int | None = None
    no_percentage: int | None = None
    winner: str | None = None
    suggestion_counts: list[SuggestionCountResponse] | None = None
    ranked_choice_rounds: list["RankedChoiceRoundResponse"] | None = None
    ranked_choice_winner: str | None = None
    # Time poll fields
    availability_counts: dict | None = None  # {slot_key: voter_count}
    max_availability: int | None = None
    included_slots: list[str] | None = None  # slots passing availability threshold (kept for compat)
    like_counts: dict | None = None   # {slot_key: like_count}
    dislike_counts: dict | None = None  # {slot_key: dislike_count}


class RankedChoiceRoundResponse(BaseModel):
    round_number: int
    option_name: str
    vote_count: int
    is_eliminated: bool
    borda_score: int | None = None
    tie_broken_by_borda: bool = False


# -- Multipoll models. See docs/multipoll-phasing.md. --


class CreateSubPollRequest(BaseModel):
    """A sub-poll inside a multipoll create request. Wrapper-level fields
    (response_deadline, creator_secret, follow_up_to, etc.) live on the
    multipoll, not here. `context` disambiguates same-kind sub-polls and is
    stored on polls.details."""

    poll_type: PollType = PollType.yes_no
    category: str | None = None
    options: list[str] | None = None
    options_metadata: dict | None = None
    context: str | None = None
    suggestion_deadline_minutes: int | None = None
    allow_pre_ranking: bool = True
    min_responses: int | None = None
    show_preliminary_results: bool = True
    min_availability_percent: int = 95
    day_time_windows: list[dict] | None = None
    duration_window: dict | None = None
    reference_latitude: float | None = None
    reference_longitude: float | None = None
    reference_location_label: str | None = None
    # Whether the title was auto-generated. Stored on the polls row so that
    # subsequent duplicate flows know whether to retain or regenerate.
    is_auto_title: bool = False


class CreateMultipollRequest(BaseModel):
    creator_secret: str
    creator_name: str | None = None
    response_deadline: str | None = None
    prephase_deadline: str | None = None
    prephase_deadline_minutes: int | None = None
    # follow_up_to is a POLL id (matching the legacy single-poll create API).
    # The server resolves it to the parent's multipoll_id for
    # multipolls.follow_up_to, and writes the original poll_id onto each
    # sub-poll's polls.follow_up_to so the existing thread-walking aggregation
    # keeps working until Phase 5.
    follow_up_to: str | None = None
    thread_title: str | None = None
    context: str | None = None
    # Optional explicit title; when absent, derived from sub-poll categories
    # and `context` via algorithms.multipoll_title.generate_multipoll_title.
    title: str | None = None
    sub_polls: list[CreateSubPollRequest] = Field(..., min_length=1)


class MultipollResponse(BaseModel):
    id: str
    short_id: str | None = None
    creator_secret: str | None = None
    creator_name: str | None = None
    response_deadline: str | None = None
    prephase_deadline: str | None = None
    prephase_deadline_minutes: int | None = None
    is_closed: bool = False
    close_reason: str | None = None
    follow_up_to: str | None = None
    thread_title: str | None = None
    context: str | None = None
    title: str
    created_at: str
    updated_at: str
    sub_polls: list[PollResponse]
    # Multipoll-level voter aggregates (Phase 3.2).
    # Per CLAUDE.md → "Addressability paradigm", multipoll-scoped data lives
    # at the multipoll level so the FE never aggregates sub-poll vote rows.
    # `voter_names`: distinct named voters across all sub-polls (sorted).
    # `anonymous_count`: max anon vote count across sub-polls (assumes the
    # same anon person typically participates in each sibling sub-poll —
    # closer to truth than summing, which would double-count).
    voter_names: list[str] = Field(default_factory=list)
    anonymous_count: int = 0


# Resolve forward references (PollResponse.results -> PollResultsResponse)
PollResponse.model_rebuild()
MultipollResponse.model_rebuild()
