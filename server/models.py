"""Pydantic models for API request/response validation."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class PollType(str, Enum):
    yes_no = "yes_no"
    ranked_choice = "ranked_choice"
    participation = "participation"
    time = "time"


class CloseReason(str, Enum):
    manual = "manual"
    deadline = "deadline"
    max_capacity = "max_capacity"


# -- Request models --


class CreatePollRequest(BaseModel):
    title: str
    poll_type: PollType = PollType.yes_no
    options: list[str] | None = None
    response_deadline: str | None = None
    creator_secret: str
    creator_name: str | None = None
    follow_up_to: str | None = None
    fork_of: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None
    suggestion_deadline: str | None = None
    suggestion_deadline_minutes: int | None = None
    allow_pre_ranking: bool = True
    auto_close_after: int | None = None
    details: str | None = None
    # Location/time fields for participation polls
    location_mode: str | None = None
    location_value: str | None = None
    location_options: list[str] | None = None
    time_mode: str | None = None
    time_value: str | None = None
    time_options: list[str] | None = None
    location_suggestions_deadline_minutes: int | None = None
    location_preferences_deadline_minutes: int | None = None
    time_suggestions_deadline_minutes: int | None = None
    time_preferences_deadline_minutes: int | None = None
    # Time windows for participation polls
    day_time_windows: list[dict] | None = None
    duration_window: dict | None = None
    # Category for autocomplete (suggestion/ranked_choice polls)
    category: str | None = None
    # Metadata for options (thumbnail URLs, info links) keyed by option label
    options_metadata: dict | None = None
    # Whether the title was auto-generated from poll options
    is_auto_title: bool = False
    # Reference location for proximity-based search
    reference_latitude: float | None = None
    reference_longitude: float | None = None
    reference_location_label: str | None = None
    # Minimum responses before results are shown (preference/suggestion polls)
    min_responses: int | None = None
    # Whether to show preliminary results once min_responses is met
    show_preliminary_results: bool = True
    # For time polls: slot is included if its availability count >= max_slot_availability * (min_availability_percent / 100).
    # Default 95 means slots within 5% of the most-available slot pass.
    min_availability_percent: int = 95
    # Optional user-set thread title. Normally inherited from the follow-up parent.
    thread_title: str | None = None


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
    min_participants: int | None = None
    max_participants: int | None = None
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
    min_participants: int | None = None
    max_participants: int | None = None
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None
    # Time poll preference reactions
    liked_slots: list[str] | None = None
    disliked_slots: list[str] | None = None


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
    follow_up_to: str | None = None
    fork_of: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None
    short_id: str | None = None
    suggestion_deadline: str | None = None
    suggestion_deadline_minutes: int | None = None
    allow_pre_ranking: bool = True
    auto_close_after: int | None = None
    details: str | None = None
    # Location/time fields
    location_mode: str | None = None
    location_value: str | None = None
    location_options: list[str] | None = None
    resolved_location: str | None = None
    time_mode: str | None = None
    time_value: str | None = None
    time_options: list[str] | None = None
    resolved_time: str | None = None
    is_sub_poll: bool = False
    sub_poll_role: str | None = None
    parent_participation_poll_id: str | None = None
    location_suggestions_deadline_minutes: int | None = None
    location_preferences_deadline_minutes: int | None = None
    time_suggestions_deadline_minutes: int | None = None
    time_preferences_deadline_minutes: int | None = None
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
    # Phase 2.5: multipoll wrapper this poll belongs to (NULL for participation
    # polls and pre-Phase-4 legacy polls). Used by the FE to group sibling
    # sub-polls when rendering threads.
    multipoll_id: str | None = None
    sub_poll_index: int | None = None
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
    min_participants: int | None = None
    max_participants: int | None = None
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None
    liked_slots: list[str] | None = None
    disliked_slots: list[str] | None = None
    created_at: str
    updated_at: str


class SuggestionCountResponse(BaseModel):
    option: str
    count: int


class TimeSlotResponse(BaseModel):
    round_number: int
    slot_date: str
    slot_start_time: str
    slot_end_time: str
    duration_hours: float
    participant_count: int
    participant_vote_ids: list[str]
    participant_names: list[str]
    is_winner: bool


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
    total_yes_votes: int | None = None
    total_votes: int = 0
    yes_percentage: int | None = None
    no_percentage: int | None = None
    winner: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None
    suggestion_counts: list[SuggestionCountResponse] | None = None
    ranked_choice_rounds: list["RankedChoiceRoundResponse"] | None = None
    ranked_choice_winner: str | None = None
    time_slot_rounds: list[TimeSlotResponse] | None = None
    participating_vote_ids: list[str] | None = None
    participating_voter_names: list[str] | None = None
    # Time poll fields
    availability_counts: dict | None = None  # {slot_key: voter_count}
    max_availability: int | None = None
    included_slots: list[str] | None = None  # slots passing availability threshold (kept for compat)
    like_counts: dict | None = None   # {slot_key: like_count}
    dislike_counts: dict | None = None  # {slot_key: dislike_count}


class ParticipantResponse(BaseModel):
    vote_id: str
    voter_name: str | None = None


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
    # subsequent fork/duplicate flows know whether to retain or regenerate.
    is_auto_title: bool = False


class CreateMultipollRequest(BaseModel):
    creator_secret: str
    creator_name: str | None = None
    response_deadline: str | None = None
    prephase_deadline: str | None = None
    prephase_deadline_minutes: int | None = None
    # follow_up_to / fork_of are POLL ids (matching the legacy single-poll
    # create API). The server resolves them to the parent's multipoll_id for
    # multipolls.follow_up_to / multipolls.fork_of, and writes the original
    # poll_id onto each sub-poll's polls.follow_up_to / polls.fork_of so the
    # existing thread-walking aggregation keeps working until Phase 5.
    follow_up_to: str | None = None
    fork_of: str | None = None
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
    fork_of: str | None = None
    thread_title: str | None = None
    context: str | None = None
    title: str
    created_at: str
    updated_at: str
    sub_polls: list[PollResponse]
    # Multipoll-level participation aggregates (Phase 3.2).
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
