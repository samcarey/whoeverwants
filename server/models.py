"""Pydantic models for API request/response validation."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class QuestionType(str, Enum):
    yes_no = "yes_no"
    ranked_choice = "ranked_choice"
    time = "time"


class CloseReason(str, Enum):
    manual = "manual"
    deadline = "deadline"
    max_capacity = "max_capacity"


# -- Request models --
#
# Phase 5: the legacy `CreateQuestionRequest` is gone — every question is created via
# `CreatePollRequest` + `CreateQuestionRequest` defined further below.


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
    # Metadata for suggested options (merged into question's options_metadata)
    options_metadata: dict | None = None
    # Time question preference reactions
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
    # Time question preference reactions
    liked_slots: list[str] | None = None
    disliked_slots: list[str] | None = None


class PollVoteItem(BaseModel):
    """One question's worth of vote data inside a unified poll submission.

    `vote_id` toggles insert vs. update: when set, the row identified by
    `vote_id` (which must already be on `question_id`) is updated; when null, a
    new row is inserted. Mirrors per-question `SubmitVoteRequest` /
    `EditVoteRequest` payloads minus `voter_name` (which is poll-level —
    one voter, many question ballots in one transaction).

    `vote_type` is required for inserts (vote_id is null) but optional for
    edits (vote_id is set) — edit logic uses the existing row's vote_type.
    """

    question_id: str
    vote_id: str | None = None
    vote_type: str | None = None
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


class SubmitPollVotesRequest(BaseModel):
    """Atomic multi-question vote submission. All `items` are inserted/updated
    in a single transaction; any item failure rolls back every other item."""

    voter_name: str | None = None
    items: list[PollVoteItem] = Field(..., min_length=1)


class CloseQuestionRequest(BaseModel):
    creator_secret: str
    close_reason: CloseReason = CloseReason.manual


class ReopenQuestionRequest(BaseModel):
    creator_secret: str


class UpdateThreadTitleRequest(BaseModel):
    # Empty string or all-whitespace clears the override (stored as NULL).
    thread_title: str | None = None


class CutoffSuggestionsRequest(BaseModel):
    creator_secret: str


class AccessibleQuestionsRequest(BaseModel):
    question_ids: list[str]
    include_results: bool = False


class RelatedQuestionsRequest(BaseModel):
    question_ids: list[str] = Field(..., max_length=100)


class RelatedQuestionsResponse(BaseModel):
    all_related_ids: list[str]
    original_count: int
    discovered_count: int


# -- Response models --


class QuestionResponse(BaseModel):
    """Sub-question API response shape.

    Phase 5b: wrapper-level fields (creator_secret, response_deadline,
    is_closed, close_reason, short_id, thread_title, suggestion_deadline,
    creator_name) are no longer surfaced here — they live exclusively on the
    parent `PollResponse`. The FE consumes them from the wrapper per the
    addressability paradigm.
    """

    id: str
    title: str
    question_type: str
    options: list[str] | None = None
    created_at: str
    updated_at: str
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
    # Phase 2.5: poll wrapper this question belongs to. Phase 4 backfilled
    # every non-participation question; migration 094 dropped the participation
    # question type entirely, so this is effectively NOT NULL on every row.
    poll_id: str | None = None
    question_index: int | None = None
    # Phase 3.5: the wrapper's `follow_up_to` (a poll_id, or None for
    # thread roots). The FE walks this for thread chains.
    poll_follow_up_to: str | None = None
    results: "QuestionResultsResponse | None" = None
    voter_names: list[str] | None = None


class VoteResponse(BaseModel):
    id: str
    question_id: str
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


class QuestionResultsResponse(BaseModel):
    question_id: str
    title: str
    question_type: str
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
    # Time question fields
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


# -- Poll models. See docs/poll-phasing.md. --


class CreateQuestionRequest(BaseModel):
    """A question inside a poll create request. Wrapper-level fields
    (response_deadline, creator_secret, follow_up_to, etc.) live on the
    poll, not here. `context` disambiguates same-kind questions and is
    stored on questions.details."""

    question_type: QuestionType = QuestionType.yes_no
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
    # Whether the title was auto-generated. Stored on the questions row so that
    # subsequent duplicate flows know whether to retain or regenerate.
    is_auto_title: bool = False


class CreatePollRequest(BaseModel):
    creator_secret: str
    creator_name: str | None = None
    response_deadline: str | None = None
    prephase_deadline: str | None = None
    prephase_deadline_minutes: int | None = None
    # follow_up_to is a QUESTION id (matching the legacy single-question create API).
    # The server resolves it to the parent's poll_id for
    # polls.follow_up_to, and writes the original question_id onto each
    # question's questions.follow_up_to so the existing thread-walking aggregation
    # keeps working until Phase 5.
    follow_up_to: str | None = None
    thread_title: str | None = None
    # Short single-line poll-level context — drives the auto-title's "for X"
    # suffix. Stored on polls.context.
    context: str | None = None
    # Multi-line description (with link support). Stored on polls.details.
    # Independent from context; surfaced to voters but not used for title gen.
    details: str | None = None
    # Optional explicit title; when absent, derived from question categories
    # and `context` via algorithms.poll_title.generate_poll_title.
    title: str | None = None
    questions: list[CreateQuestionRequest] = Field(..., min_length=1)


class PollResponse(BaseModel):
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
    details: str | None = None
    title: str
    created_at: str
    updated_at: str
    questions: list[QuestionResponse]
    # Poll-level voter aggregates (Phase 3.2).
    # Per CLAUDE.md → "Addressability paradigm", poll-scoped data lives
    # at the poll level so the FE never aggregates question vote rows.
    # `voter_names`: distinct named voters across all questions (sorted).
    # `anonymous_count`: max anon vote count across questions (assumes the
    # same anon person typically participates in each sibling question —
    # closer to truth than summing, which would double-count).
    voter_names: list[str] = Field(default_factory=list)
    anonymous_count: int = 0


# Resolve forward references (QuestionResponse.results -> QuestionResultsResponse)
QuestionResponse.model_rebuild()
PollResponse.model_rebuild()
