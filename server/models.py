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


class SubmitVoteRequest(BaseModel):
    vote_type: str
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    nominations: list[str] | None = None
    is_abstain: bool = False
    voter_name: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None


class EditVoteRequest(BaseModel):
    yes_no_choice: str | None = None
    ranked_choices: list[str] | None = None
    nominations: list[str] | None = None
    is_abstain: bool = False
    voter_name: str | None = None
    min_participants: int | None = None
    max_participants: int | None = None


class ClosePollRequest(BaseModel):
    creator_secret: str
    close_reason: CloseReason = CloseReason.manual


class ReopenPollRequest(BaseModel):
    creator_secret: str


class AccessiblePollsRequest(BaseModel):
    poll_ids: list[str]


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
    created_at: str
    updated_at: str


class NominationCountResponse(BaseModel):
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
    min_participants: int | None = None
    max_participants: int | None = None
    nomination_counts: list[NominationCountResponse] | None = None
    ranked_choice_rounds: list["RankedChoiceRoundResponse"] | None = None
    ranked_choice_winner: str | None = None


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
