/**
 * API client for the Python backend. The implementation is split by domain
 * across the sibling files (questions, polls, votes, results, search); this
 * index re-exports the public surface so existing `import ... from
 * "@/lib/api"` callsites keep working without churn.
 */

export { ApiError } from "./_internal";
export type { ApiRankedChoiceRound } from "./_internal";

export {
  apiGetQuestionByShortId,
  apiGetQuestionById,
  apiFindDuplicateQuestion,
  apiGetRelatedQuestions,
  apiGetAccessibleQuestions,
  apiGetAllQuestionIds,
} from "./questions";

export {
  apiCreatePoll,
  apiGetPollByShortId,
  apiGetPollById,
  apiClosePoll,
  apiReopenPoll,
  apiCutoffPollSuggestions,
  apiCutoffPollAvailability,
  apiUpdatePollThreadTitle,
} from "./polls";
export type { QuestionType, CreateQuestionParams, CreatePollParams } from "./polls";

export {
  QUESTION_VOTES_CHANGED_EVENT,
  apiGetVotes,
  apiSubmitPollVotes,
} from "./votes";
export type { ApiVote, PollVoteItem } from "./votes";

export { apiGetQuestionResults } from "./results";

export {
  apiSearchLocations,
  apiSearchRestaurants,
  apiGeocode,
  apiSearchMovies,
  apiSearchVideoGames,
} from "./search";
export type { SearchResult } from "./search";
