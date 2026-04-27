/**
 * API client for the Python backend. The implementation is split by domain
 * across the sibling files (polls, multipolls, votes, results, search); this
 * index re-exports the public surface so existing `import ... from
 * "@/lib/api"` callsites keep working without churn.
 */

export { ApiError } from "./_internal";
export type { ApiRankedChoiceRound } from "./_internal";

export {
  apiGetPollByShortId,
  apiGetPollById,
  apiFindDuplicatePoll,
  apiGetRelatedPolls,
  apiGetAccessiblePolls,
  apiGetAllPollIds,
} from "./polls";

export {
  apiCreateMultipoll,
  apiGetMultipollByShortId,
  apiGetMultipollById,
  apiCloseMultipoll,
  apiReopenMultipoll,
  apiCutoffMultipollSuggestions,
  apiCutoffMultipollAvailability,
  apiUpdateMultipollThreadTitle,
} from "./multipolls";
export type { SubPollType, CreateSubPollParams, CreateMultipollParams } from "./multipolls";

export {
  POLL_VOTES_CHANGED_EVENT,
  apiGetVotes,
  apiSubmitMultipollVotes,
} from "./votes";
export type { ApiVote, MultipollVoteItem } from "./votes";

export { apiGetPollResults } from "./results";

export {
  apiSearchLocations,
  apiSearchRestaurants,
  apiGeocode,
  apiSearchMovies,
  apiSearchVideoGames,
} from "./search";
export type { SearchResult } from "./search";
