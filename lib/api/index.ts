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
  apiCancelRecurrence,
  apiRecordPollView,
  apiSetPollFollowState,
} from "./polls";
export type { QuestionType, CreateQuestionParams, CreatePollParams } from "./polls";

export {
  QUESTION_VOTES_CHANGED_EVENT,
  apiGetVotes,
  apiGetPlusOneCandidates,
  apiSubmitPollVotes,
} from "./votes";
export type { ApiVote, PollVoteItem, PlusOneCandidate } from "./votes";

export { apiGetQuestionResults } from "./results";

export { apiShowtimesNearby } from "./showtimes";
export type { ShowtimeSession, ShowtimeFilm, ShowtimeCinema, ShowtimesNearbyResponse } from "./showtimes";

export {
  apiGetMyGroups,
  apiGetGroupByRouteId,
  apiGetGroupPoll,
  apiCreateGroup,
  apiGetMyEmptyGroups,
  apiGetGroupSummary,
  apiGetGroupPreview,
  apiLeaveGroup,
  apiUpdateGroupTitle,
  apiUpdateGroupPrivacy,
  apiClaimGroup,
  apiUploadGroupImage,
  apiDeleteGroupImage,
  apiCreateGroupJoinRequest,
  apiListGroupJoinRequests,
  apiDecideGroupJoinRequest,
  apiCreateGroupInvite,
  apiListGroupInvites,
  apiRevokeGroupInvite,
  apiGetGroupInvitableAccounts,
  apiAddGroupMembers,
  apiGetGroupMembers,
} from "./groups";
export type {
  GroupJoinRequest,
  CreateGroupJoinRequestResult,
  GroupInvite,
  CreateGroupInviteOptions,
  GroupPollResult,
  InvitableAccount,
  GroupMember,
  GroupRoster,
} from "./groups";

export {
  apiGetMyUserProfile,
  apiGetPollCategoryHistory,
  apiGetCategoryOptions,
  apiUploadMyUserImage,
  apiDeleteMyUserImage,
  buildUserImageUrl,
  cacheMyUserProfile,
  getCachedMyUserProfile,
  clearCachedMyUserProfile,
  getMyUserImageUrl,
  USER_PROFILE_CHANGED_EVENT,
} from "./users";
export type { UserProfile, PollCategoryHistory, CategoryOptionEntry } from "./users";

export {
  apiSearchLocations,
  apiSearchRestaurants,
  apiGeocode,
  apiSearchMovies,
  apiSearchVideoGames,
} from "./search";
export type { SearchResult } from "./search";

export {
  apiRequestMagicLink,
  apiVerifyMagicLink,
  apiGetMe,
  apiSignOut,
  apiSignInWithOAuth,
  apiGetAuthProviders,
  apiPasskeyRegistrationOptions,
  apiPasskeyRegistrationVerify,
  apiPasskeyAuthenticationOptions,
  apiPasskeyAuthenticationVerify,
  apiListPasskeys,
  apiDeletePasskey,
  apiRenamePasskey,
  apiRedeemInvite,
  apiRequestRecoveryEmail,
  apiVerifyRecoveryEmail,
  apiDeleteAccount,
  apiCreateNameAccount,
  apiSetRecoveryReminderDismissed,
  apiAdoptInstantSession,
  getCurrentUser,
} from "./auth";
export type {
  MagicLinkRequestResponse,
  SessionResponse,
  AuthProvidersResponse,
  OAuthProvider,
  PasskeySummary,
  PasskeyListResponse,
  PasskeyRegistrationResult,
  InviteRedeemResult,
  RecoveryEmailRequestResponse,
} from "./auth";
