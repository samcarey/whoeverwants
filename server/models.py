"""Pydantic models for API request/response validation."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class PollType(str, Enum):
    yes_no = "yes_no"
    ranked_choice = "ranked_choice"
    nomination = "nomination"
    participation = "participation"


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
    auto_create_preferences: bool = False
    auto_preferences_deadline_minutes: int | None = None
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
    # Category for autocomplete (nomination/ranked_choice polls)
    category: str | None = None
    # Metadata for options (thumbnail URLs, info links) keyed by option label
    options_metadata: dict | None = None
    # Whether the title was auto-generated from poll options
    is_auto_title: bool = False
    # Reference location for proximity-based search
    reference_latitude: float | None = None
    reference_longitude: float | None = None
    reference_location_label: str | None = None


class SubmitVoteRequest(BaseModel):
    vote_type: str
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    nominations: list[str] | None = None
    is_abstain: bool = False
    voter_name: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None
    # Metadata for nominated options (merged into poll's options_metadata)
    options_metadata: dict | None = None


class EditVoteRequest(BaseModel):
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    nominations: list[str] | None = None
    is_abstain: bool = False
    voter_name: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None


class ClosePollRequest(BaseModel):
    creator_secret: str
    close_reason: CloseReason = CloseReason.manual


class ReopenPollRequest(BaseModel):
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
    auto_create_preferences: bool = False
    auto_preferences_deadline_minutes: int | None = None
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
    response_count: int | None = None
    results: "PollResultsResponse | None" = None


class VoteResponse(BaseModel):
    id: str
    poll_id: str
    vote_type: str
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    nominations: list[str] | None = None
    is_abstain: bool = False
    voter_name: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None
    voter_day_time_windows: list[dict] | None = None
    voter_duration: dict | None = None
    created_at: str
    updated_at: str


class NominationCountResponse(BaseModel):
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
    total_votes: int = 0
    yes_percentage: int | None = None
    no_percentage: int | None = None
    winner: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None
    nomination_counts: list[NominationCountResponse] | None = None
    ranked_choice_rounds: list["RankedChoiceRoundResponse"] | None = None
    ranked_choice_winner: str | None = None
    time_slot_rounds: list[TimeSlotResponse] | None = None


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


# Resolve forward references (PollResponse.results -> PollResultsResponse)
PollResponse.model_rebuild()
