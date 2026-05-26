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
  apiRecordPollView,
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
  apiGetMyGroups,
  apiGetGroupByRouteId,
  apiCreateGroup,
  apiGetMyEmptyGroups,
  apiGetGroupSummary,
  apiLeaveGroup,
  apiUpdateGroupTitle,
  apiUpdateGroupPrivacy,
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
} from "./groups";
export type {
  GroupJoinRequest,
  CreateGroupJoinRequestResult,
  GroupInvite,
  CreateGroupInviteOptions,
  InvitableAccount,
} from "./groups";

export {
  apiGetMyUserProfile,
  apiGetPollCategoryHistory,
  apiUploadMyUserImage,
  apiDeleteMyUserImage,
  buildUserImageUrl,
  cacheMyUserProfile,
  getCachedMyUserProfile,
  clearCachedMyUserProfile,
  getMyUserImageUrl,
  USER_PROFILE_CHANGED_EVENT,
} from "./users";
export type { UserProfile, PollCategoryHistory } from "./users";

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
