/**
 * Group-level API helpers.
 *
 * `apiGetMyGroups()` returns every group the caller is a member of
 * (membership-only — `group_members` is the single source of truth). The
 * server resolves membership from the request's browser_id + bearer token
 * and returns every poll in those groups with the full inline-results /
 * voter aggregates that the home page expects. No localStorage question-id
 * list is sent.
 *
 * `apiGetGroupByRouteId(routeId)` returns the same shape for one group,
 * resolved by `routeId` (group short_id / group uuid / poll short_id /
 * poll uuid).
 *
 * Both helpers piggyback on the existing per-poll cache: `cachePoll` is
 * called for each returned poll so subsequent `apiGetPollById` calls hit
 * warm cache.
 *
 * `apiLeaveGroup(routeId)` is the explicit "leave group" action —
 * fire-and-forget DELETE to `/api/groups/{routeId}/membership`. Errors
 * are swallowed because the post-condition is verifiable on the next
 * `/api/groups/mine` call. This is the mechanism behind "forget a group":
 * dropping the membership row removes the group from home.
 */

import type { GroupSummary, Poll } from "@/lib/types";
import {
  cacheAccessiblePolls,
  cacheGroupSummary,
  cachePoll,
  cacheQuestionResults,
  getCachedAccessiblePolls,
  getCachedGroupSummary,
  invalidateAccessibleQuestions,
  invalidateGroupSummary,
  invalidatePoll,
} from "@/lib/questionCache";
import { ApiError, coalesced, groupFetch, toPoll, toQuestionResults } from "./_internal";

function toGroupSummary(data: any): GroupSummary {
  return {
    id: data.id,
    short_id: data.short_id ?? null,
    title: data.title ?? null,
    created_at: data.created_at,
    image_updated_at: data.image_updated_at ?? null,
    privacy: data.privacy ?? null,
    creator_user_id: data.creator_user_id ?? null,
    has_polls: data.has_polls ?? false,
  };
}

function hydrateAndCache(data: any[]): Poll[] {
  const polls = data.map((d) => {
    const poll = toPoll(d);
    cachePoll(poll);
    // Mirror inline per-question results so apiGetQuestionResults hits
    // the per-question results cache without a late re-fetch (matching
    // apiGetAccessibleQuestions's behavior).
    const sub = Array.isArray(d.questions) ? d.questions : [];
    for (let i = 0; i < sub.length; i++) {
      const subData = sub[i];
      if (subData?.results) {
        const results = toQuestionResults(subData.results);
        cacheQuestionResults(subData.id, results);
        if (poll.questions[i]) {
          poll.questions[i].results = results;
        }
      }
    }
    return poll;
  });
  // Merge into the accessible-polls cache (replace entries with the same
  // group_id, keep entries from other groups). Without this, a user who
  // lands directly on `/g/<id>` (deep-link, share, etc.) has the per-poll
  // caches populated but `accessiblePollsCache` stays null — so
  // `buildGroupSyncFromCache` returns null on back-nav from a poll
  // detail, the overlay's GroupContent shows its loading spinner during
  // the slide, and the restored window.scrollY is clamped to a tiny
  // doc-height. Merging here primes the cache for synchronous reads
  // throughout the group's lifetime.
  //
  // Run unconditionally (even for an empty result): the merge keeps every
  // cached entry from OTHER groups (so an empty single-group fetch can't
  // wipe deep-linked groups), and — critically — a `null` cache becomes
  // `[]`. Without this, a signed-out / groupless user's empty `/mine`
  // never populated the cache, so it stayed `null` forever and the home
  // page re-flashed its loading spinner over the empty-state on every
  // mount (e.g. a swipe-back from /explore or /settings). After the first
  // successful fetch the cache is a non-null `[]`, so subsequent mounts
  // render the empty-state synchronously with no spinner.
  const groupIds = new Set<string>();
  for (const p of polls) if (p.group_id) groupIds.add(p.group_id);
  const cached = getCachedAccessiblePolls() ?? [];
  const others = cached.filter((p) => !p.group_id || !groupIds.has(p.group_id));
  cacheAccessiblePolls([...others, ...polls]);
  return polls;
}

export async function apiGetMyGroups(
  options: { include_results?: boolean } = {},
): Promise<Poll[]> {
  // Membership-only: the server returns every group the caller (or any
  // browser linked to their signed-in user_id) is a `group_members` row
  // for, based on the browser_id + bearer token. No localStorage
  // question-id list is sent — the legacy `accessible_question_ids`
  // forget bridge has been removed (`group_members` is the single
  // source of truth).
  const data: any[] = await groupFetch('/mine', {
    method: 'POST',
    body: JSON.stringify({
      include_results: options.include_results ?? true,
    }),
  });
  return hydrateAndCache(data);
}

export async function apiGetGroupByRouteId(
  routeId: string,
  options: { include_results?: boolean } = {},
): Promise<Poll[]> {
  const params = new URLSearchParams();
  if (options.include_results === false) params.set('include_results', 'false');
  const qs = params.toString();
  const path = `/by-route-id/${encodeURIComponent(routeId)}${qs ? `?${qs}` : ''}`;
  const data: any[] = await groupFetch(path);
  return hydrateAndCache(data);
}

/** Result of a visibility-aware single-poll read within a group.
 *  - `{ status: 'visible', poll }` — the caller can see the poll.
 *  - `{ status: 'hidden_pre_join', closedAt }` — the poll exists in the
 *    group and the caller is a member, but it closed before they joined,
 *    so its contents are withheld. `closedAt` is the closure timestamp
 *    (ISO) or null. */
export type GroupPollResult =
  | { status: "visible"; poll: Poll }
  | { status: "hidden_pre_join"; closedAt: string | null };

/** Visibility-aware fetch of one poll within a group, used by the
 *  direct-poll-link landing page (`/g/<group>/p/<poll>`).
 *
 *  Unlike `apiGetPollByShortId` (which hits the visibility-BLIND
 *  `/api/polls/{short_id}` and would leak a closed-before-join poll's
 *  contents to a late joiner), this enforces the group visibility rule.
 *  Throws ApiError(404) when the poll doesn't exist in the group (or the
 *  group is private and the caller isn't a member). On a `visible` result
 *  the poll is cached (and the group's accessible-polls cache primed) just
 *  like `apiGetGroupByRouteId`. */
export async function apiGetGroupPoll(
  routeId: string,
  pollRef: string,
): Promise<GroupPollResult> {
  const data = await groupFetch<any>(
    `/by-route-id/${encodeURIComponent(routeId)}/poll/${encodeURIComponent(pollRef)}`,
  );
  if (data?.status === "visible" && data.poll) {
    const [poll] = hydrateAndCache([data.poll]);
    return { status: "visible", poll };
  }
  return { status: "hidden_pre_join", closedAt: data?.closed_at ?? null };
}

/** Create a brand-new empty group and auto-join the caller as a member.
 *  Used by the home new group button. The next `getMyGroups()` call picks up the
 *  new group via the always-fresh `/api/groups/empty` parallel fetch;
 *  the polls cache is unaffected since this group has no polls.
 *
 *  Caches the returned summary so `buildGroupSyncFromCache` can synthesize
 *  the empty `Group` on first render at `/g/<short_id>` — without it, the
 *  slide-overlay unmounts onto a loading spinner ("page disappears and
 *  reappears"). */
export async function apiCreateGroup(): Promise<GroupSummary> {
  const data = await groupFetch<any>('', { method: 'POST' });
  const summary = toGroupSummary(data);
  cacheGroupSummary(summary);
  return summary;
}

/** Empty groups the caller is a member of (joined, zero polls). Returns
 *  `[]` on transient failure — never throws, so an empty-groups blip
 *  can't block the populated list. */
export async function apiGetMyEmptyGroups(): Promise<GroupSummary[]> {
  try {
    const data: any[] = await groupFetch('/empty', { method: 'POST' });
    return Array.isArray(data) ? data.map(toGroupSummary) : [];
  } catch {
    return [];
  }
}

/** Group metadata (no polls, no auto-join). Safe from any read-only
 *  context; returns null on resolution failure.
 *
 *  Short-circuits on cache hit so the new-group-button-create → empty-group destination
 *  doesn't fire a redundant round-trip: `apiCreateGroup` already cached the
 *  summary, and the destination's fetchGroup fallback would otherwise
 *  refetch the same payload to render the same empty group. */
export async function apiGetGroupSummary(routeId: string): Promise<GroupSummary | null> {
  const cached = getCachedGroupSummary(routeId);
  if (cached) return cached;
  try {
    const data = await groupFetch<any>(
      `/by-route-id/${encodeURIComponent(routeId)}/summary`,
    );
    const summary = toGroupSummary(data);
    cacheGroupSummary(summary);
    return summary;
  } catch {
    return null;
  }
}

/** Public link-preview metadata for a group (title + description).
 *  Identity-free, visibility-free — the same endpoint Open Graph
 *  crawlers hit on URL share. Returns null on 404 (route_id doesn't
 *  resolve to a group at all), so consumers can distinguish "group
 *  exists but you don't have access" from "group truly doesn't exist".
 *
 *  Used by `GroupNotFound` to swap the "may not exist or you don't have
 *  access" copy for an honest "this group is private — request access"
 *  message when the group does exist. */
export async function apiGetGroupPreview(
  routeId: string,
): Promise<{ title: string; description: string | null } | null> {
  try {
    const data = await groupFetch<any>(
      `/by-route-id/${encodeURIComponent(routeId)}/preview`,
    );
    return {
      title: typeof data?.title === "string" ? data.title : "",
      description:
        typeof data?.description === "string" ? data.description : null,
    };
  } catch {
    return null;
  }
}

/**
 * Explicit "leave group" action — DELETE the caller's `group_members`
 * row for the resolved group. Idempotent server-side and fire-and-forget
 * client-side: the server returns 204 whether or not a row existed (and
 * even for strangers), so a transient failure is never user-visible. The
 * post-condition is verifiable on the next `/api/groups/mine` call.
 *
 * `routeId` accepts `groups.short_id`, `groups.id`, `polls.short_id`, or
 * `polls.id` — same as `apiGetGroupByRouteId`.
 */
export async function apiLeaveGroup(routeId: string): Promise<void> {
  try {
    await groupFetch(`/${encodeURIComponent(routeId)}/membership`, {
      method: 'DELETE',
    });
  } catch {
    // intentional: see jsdoc
  }
}

/** Update (or clear) a group's title override.
 *
 *  Migration 105 moved the override from `polls.group_title` to
 *  `groups.title`. The endpoint takes a `route_id` (the same four forms
 *  as `apiGetGroupByRouteId`) and updates `groups.title` directly —
 *  one row per group, no per-poll divergence.
 *
 *  Empty string or null clears the override (stored as NULL).
 *
 *  Cache invalidation: every poll in the group carries `group_title`
 *  in its cached payload, so we evict each one (cascades to per-question
 *  caches via `invalidatePoll`) plus the accessible-polls cache. Done
 *  here so callers don't have to remember the cleanup ritual.
 */
export async function apiUpdateGroupTitle(
  routeId: string,
  title: string | null,
): Promise<{ group_id: string; group_short_id: string | null; title: string | null }> {
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/title`,
    {
      method: 'POST',
      body: JSON.stringify({ group_title: title }),
    },
  );
  const result = {
    group_id: data.group_id as string,
    group_short_id: (data.group_short_id ?? null) as string | null,
    title: (data.title ?? null) as string | null,
  };
  const accessible = getCachedAccessiblePolls() ?? [];
  for (const mp of accessible) {
    if (mp.group_id === result.group_id) invalidatePoll(mp.id);
  }
  invalidateAccessibleQuestions();
  invalidateGroupSummary(result.group_id);
  return result;
}

/** Upload (or replace) a group's avatar image. Migration 108.
 *
 *  `imageBlob` is the FE-cropped square image — a JPEG or PNG Blob produced
 *  by the cropper's canvas export. Encoded to base64 and POSTed as JSON
 *  to match the rest of the API's content-type contract.
 *
 *  Invalidates every cached poll in the group (each carries
 *  `group_image_updated_at`) plus the accessible-polls cache, so the next
 *  read picks up the new timestamp + URL.
 */
export async function apiUploadGroupImage(
  routeId: string,
  imageBlob: Blob,
): Promise<{ group_id: string; group_short_id: string | null; image_updated_at: string | null }> {
  const mimeType = imageBlob.type || 'image/jpeg';
  const arrayBuffer = await imageBlob.arrayBuffer();
  const base64 = base64FromArrayBuffer(arrayBuffer);
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/image`,
    {
      method: 'POST',
      body: JSON.stringify({ image_base64: base64, mime_type: mimeType }),
    },
  );
  const result = {
    group_id: data.group_id as string,
    group_short_id: (data.group_short_id ?? null) as string | null,
    image_updated_at: (data.image_updated_at ?? null) as string | null,
  };
  invalidateGroupPolls(result.group_id);
  return result;
}

/** Clear a group's avatar image (FE falls back to initials). Idempotent
 *  server-side — safe to call even when no image is set. */
export async function apiDeleteGroupImage(
  routeId: string,
): Promise<{ group_id: string; group_short_id: string | null }> {
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/image`,
    { method: 'DELETE' },
  );
  const result = {
    group_id: data.group_id as string,
    group_short_id: (data.group_short_id ?? null) as string | null,
  };
  invalidateGroupPolls(result.group_id);
  return result;
}

function invalidateGroupPolls(groupId: string) {
  const accessible = getCachedAccessiblePolls() ?? [];
  for (const mp of accessible) {
    if (mp.group_id === groupId) invalidatePoll(mp.id);
  }
  invalidateAccessibleQuestions();
  invalidateGroupSummary(groupId);
}

/** Phase E: flip a group's privacy (creator-only).
 *
 *  Requires the caller's session token (the fetch wrapper attaches it
 *  automatically). The server verifies the session's user_id matches
 *  the group's recorded `creator_user_id`. Returns the updated privacy
 *  + creator_user_id on success.
 *
 *  Throws `ApiError` with status 401 (signed out), 403 (not the
 *  creator OR legacy group with no recorded creator), 404 (unknown
 *  group), or 400 (bad privacy value).
 *
 *  Invalidates every cached poll in the group (each carries
 *  `group_privacy`) plus the accessible-polls cache so subsequent
 *  reads pick up the flipped state.
 */
export async function apiUpdateGroupPrivacy(
  routeId: string,
  privacy: 'public' | 'private',
): Promise<{
  group_id: string;
  group_short_id: string | null;
  privacy: string;
  creator_user_id: string | null;
}> {
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/privacy`,
    {
      method: 'POST',
      body: JSON.stringify({ privacy }),
    },
  );
  const result = {
    group_id: data.group_id as string,
    group_short_id: (data.group_short_id ?? null) as string | null,
    privacy: data.privacy as string,
    creator_user_id: (data.creator_user_id ?? null) as string | null,
  };
  // Same invalidation pattern as title/image: every poll in the group
  // carries `group_privacy`, so evict each one to drop stale state.
  invalidateGroupPolls(result.group_id);
  return result;
}

/** Phase I: claim a group that has no recorded creator (grandfathered or
 *  anonymous-created). Atomic server-side: first signed-in member to
 *  claim wins via `UPDATE WHERE creator_user_id IS NULL`. After the
 *  claim, the caller becomes the recorded creator and unlocks every
 *  creator-only surface — privacy toggle, join-request approval,
 *  invite-link minting.
 *
 *  Throws `ApiError` with status 401 (signed out), 403 (signed in but
 *  not a member of the group), 404 (unknown group), or 409 (group
 *  already has a creator — either claimed before or a concurrent claim
 *  beat ours).
 *
 *  Invalidates every cached poll in the group (each carries
 *  `group_creator_user_id`) plus the accessible-polls cache so
 *  subsequent reads pick up the new creator id.
 */
export async function apiClaimGroup(
  routeId: string,
): Promise<{
  group_id: string;
  group_short_id: string | null;
  privacy: string;
  creator_user_id: string;
}> {
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/claim`,
    { method: 'POST' },
  );
  const result = {
    group_id: data.group_id as string,
    group_short_id: (data.group_short_id ?? null) as string | null,
    privacy: data.privacy as string,
    creator_user_id: data.creator_user_id as string,
  };
  invalidateGroupPolls(result.group_id);
  return result;
}

/**
 * Phase F: join-request helpers.
 *
 * Three operations:
 *   * `apiCreateGroupJoinRequest(routeId, message)` — signed-in
 *     non-member requests access. Returns the request summary + a
 *     status enum ('pending' | 'already_pending' | 'already_member')
 *     so callers can differentiate UX states.
 *   * `apiListGroupJoinRequests(routeId)` — creator-only list of
 *     pending requests for their group.
 *   * `apiDecideGroupJoinRequest(routeId, requestId, action)` —
 *     creator approves or denies a pending request. Action 'approve'
 *     writes a `group_members` row server-side; the approved user sees
 *     the group on next refresh.
 *
 * All three throw `ApiError` on non-2xx (401 = signed out, 403 = not
 * the creator, 404 = unknown group / already-decided request, etc.).
 */

export interface GroupJoinRequest {
  id: string;
  group_id: string;
  requester_user_id: string;
  requester_email: string | null;
  /** Account display_name. Populated for real requests (a name is
   *  required to request access); may be null for legacy/edge rows. */
  requester_name: string | null;
  /** Profile-photo cache-buster; null when the requester has no
   *  uploaded photo. Feed into `buildUserImageUrl(requester_user_id, ...)`. */
  requester_image_updated_at: string | null;
  message: string | null;
  requested_at: string;
}

export interface CreateGroupJoinRequestResult {
  status: 'pending' | 'already_pending' | 'already_member';
  request: GroupJoinRequest | null;
}

export async function apiCreateGroupJoinRequest(
  routeId: string,
  message: string | null,
): Promise<CreateGroupJoinRequestResult> {
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/join-requests`,
    {
      method: 'POST',
      body: JSON.stringify({ message: message ?? null }),
    },
  );
  return {
    status: data.status,
    request: data.request ?? null,
  };
}

export async function apiListGroupJoinRequests(
  routeId: string,
): Promise<GroupJoinRequest[]> {
  const data = await groupFetch<any[]>(
    `/${encodeURIComponent(routeId)}/join-requests`,
  );
  return Array.isArray(data) ? data : [];
}

export async function apiDecideGroupJoinRequest(
  routeId: string,
  requestId: string,
  action: 'approve' | 'deny',
): Promise<{ request_id: string; status: 'approved' | 'denied' }> {
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/join-requests/${encodeURIComponent(requestId)}/decide`,
    {
      method: 'POST',
      body: JSON.stringify({ action }),
    },
  );
  return {
    request_id: data.request_id,
    status: data.status,
  };
}

/**
 * Phase G: invite-link helpers.
 *
 * Three creator-side operations + one redeem (which lives on the
 * `auth` namespace because the URL the joiner clicked has no
 * route_id, only a raw token):
 *   * `apiCreateGroupInvite(routeId, options)` — mint a new invite.
 *     The response includes the raw `token` + a host-derived `url`
 *     exactly ONCE; lose it and the creator has to mint again.
 *   * `apiListGroupInvites(routeId)` — active invites for a group,
 *     creator-only.
 *   * `apiRevokeGroupInvite(routeId, inviteId)` — mark an invite
 *     revoked.
 *   * `apiRedeemInvite(token)` is exported from `lib/api/auth.ts`.
 *
 * The list endpoint deliberately omits `token` and `url` (one-shot at
 * create time) — a lost URL means a new invite, not a "view the link
 * again" affordance.
 */

export interface GroupInvite {
  id: string;
  group_id: string;
  mode: 'single' | 'multi';
  target_poll_id: string | null;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  created_at: string;
  /** Populated only on the create-response shape, NEVER on list. */
  token?: string | null;
  /** Populated only on the create-response shape, NEVER on list. */
  url?: string | null;
}

export interface CreateGroupInviteOptions {
  mode?: 'single' | 'multi';
  max_uses?: number | null;
  target_poll_id?: string | null;
  expires_in_hours?: number | null;
}

export async function apiCreateGroupInvite(
  routeId: string,
  options: CreateGroupInviteOptions = {},
): Promise<GroupInvite> {
  const body = {
    mode: options.mode ?? 'multi',
    max_uses: options.max_uses ?? null,
    target_poll_id: options.target_poll_id ?? null,
    expires_in_hours: options.expires_in_hours ?? null,
  };
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/invites`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  return data as GroupInvite;
}

export async function apiListGroupInvites(
  routeId: string,
): Promise<GroupInvite[]> {
  const data = await groupFetch<any[]>(
    `/${encodeURIComponent(routeId)}/invites`,
  );
  return Array.isArray(data) ? (data as GroupInvite[]) : [];
}

export async function apiRevokeGroupInvite(
  routeId: string,
  inviteId: string,
): Promise<void> {
  await groupFetch(
    `/${encodeURIComponent(routeId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE' },
  );
}

/**
 * Invite members directly ("address book"):
 *   * `apiGetGroupInvitableAccounts(routeId)` — accounts the caller has
 *     encountered (shared a group with) who aren't already members of this
 *     group. Server-sorted: most current shared groups first, then most
 *     recently seen together. Any member can call this.
 *   * `apiAddGroupMembers(routeId, userIds)` — add the selected accounts to
 *     the group (each gets a push). Only the caller's own contacts are
 *     accepted server-side; returns how many were actually added.
 */

export interface InvitableAccount {
  user_id: string;
  /** Account display name. May be null for accounts that never set one. */
  name: string | null;
  /** Number of OTHER groups the caller currently shares with this account. */
  shared_group_count: number;
  /** ISO timestamp the pair was last observed sharing a group. */
  last_seen_at: string;
}

export async function apiGetGroupInvitableAccounts(
  routeId: string,
): Promise<InvitableAccount[]> {
  const data = await groupFetch<any[]>(
    `/${encodeURIComponent(routeId)}/invitable-accounts`,
  );
  return Array.isArray(data) ? (data as InvitableAccount[]) : [];
}

export async function apiAddGroupMembers(
  routeId: string,
  userIds: string[],
): Promise<{ added: number }> {
  const data = await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/members`,
    {
      method: 'POST',
      body: JSON.stringify({ user_ids: userIds }),
    },
  );
  return { added: typeof data?.added === 'number' ? data.added : 0 };
}

export interface GroupMember {
  /** Resolved display name (account display_name, else recent voter name). */
  name: string;
  /** Account id when this member is signed in; null for anonymous browsers. */
  user_id: string | null;
  /** Migration 142: is this member a group admin? (always false for anonymous
   *  members — admins are account-keyed). */
  is_admin: boolean;
}

/** An anonymous (no resolvable name) member. `handle` is an opaque,
 *  group-scoped id (NOT a browser_id) the boot-by-handle endpoint matches. */
export interface AnonymousMember {
  handle: string;
}

const EMPTY_ROSTER: GroupRoster = {
  members: [],
  anonymous_count: 0,
  anonymous_members: [],
  viewer_anonymous_handle: null,
  viewer_is_admin: false,
};

/** Parse the server's `anonymous_members` array into `AnonymousMember[]`. */
function parseAnonymousMembers(data: any): AnonymousMember[] {
  return Array.isArray(data?.anonymous_members)
    ? (data.anonymous_members as any[])
        .filter((m) => typeof m?.handle === 'string')
        .map((m) => ({ handle: m.handle as string }))
    : [];
}

export interface GroupRoster {
  /** Named members, one per distinct person (account-aware de-dup). */
  members: GroupMember[];
  /** Distinct members with no resolvable name (drive-by public-group joins). */
  anonymous_count: number;
  /** Same set as `anonymous_count`, one entry each with a boot handle. */
  anonymous_members: AnonymousMember[];
  /** The viewer's own anonymous handle (when they're a nameless member), so the
   *  FE can drop exactly their entry from the displayed list. Null otherwise. */
  viewer_anonymous_handle: string | null;
  /** Migration 142: is the viewer an admin of this group? Gates the /info
   *  admin chrome (privacy toggle, invites, join requests, add-people,
   *  promote/boot, title/avatar edits). */
  viewer_is_admin: boolean;
}

/** The group's ACTUAL roster from `group_members` — named members plus a
 *  rolled-up anonymous count. Distinct from `Group.participantNames`, which
 *  only reflects poll creators/voters (so a just-approved member who hasn't
 *  voted yet would be missing). Members-only for private groups (404 maps to
 *  an empty roster). In-flight coalesced: the slide-overlay handoff mounts
 *  GroupContent (and /info) twice in quick succession, and both instances
 *  fetch the roster — without coalescing every navigation would fire two
 *  identical /members GETs. */
const groupMembersInFlight = new Map<string, Promise<GroupRoster>>();
export async function apiGetGroupMembers(
  routeId: string,
): Promise<GroupRoster> {
  return coalesced(groupMembersInFlight, routeId, null, async () => {
    try {
      const data = await groupFetch<any>(
        `/${encodeURIComponent(routeId)}/members`,
      );
      return {
        members: Array.isArray(data?.members)
          ? (data.members as any[]).map((m) => ({
              name: m.name,
              user_id: m.user_id ?? null,
              is_admin: !!m.is_admin,
            }))
          : [],
        anonymous_count:
          typeof data?.anonymous_count === 'number' ? data.anonymous_count : 0,
        anonymous_members: parseAnonymousMembers(data),
        viewer_anonymous_handle:
          typeof data?.viewer_anonymous_handle === 'string'
            ? data.viewer_anonymous_handle
            : null,
        viewer_is_admin: !!data?.viewer_is_admin,
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return EMPTY_ROSTER;
      }
      throw err;
    }
  });
}

/** A single poll's respondent roster — same shape as the group members roster
 *  (one entry per distinct voter person + a rolled-up anonymous count). Drives
 *  the poll /info respondents list (per-person rows + long-press to profile).
 *  `is_admin` / `viewer_is_admin` are not meaningful here (it's a voter roster,
 *  not group membership) — defaulted false to satisfy the shared types. */
export async function apiGetGroupPollVoters(
  routeId: string,
  pollRef: string,
): Promise<GroupRoster> {
  try {
    const data = await groupFetch<any>(
      `/by-route-id/${encodeURIComponent(routeId)}/poll/${encodeURIComponent(pollRef)}/voter-identities`,
    );
    return {
      members: Array.isArray(data?.members)
        ? (data.members as any[]).map((m) => ({
            name: m.name,
            user_id: m.user_id ?? null,
            is_admin: false,
          }))
        : [],
      anonymous_count:
        typeof data?.anonymous_count === 'number' ? data.anonymous_count : 0,
      anonymous_members: parseAnonymousMembers(data),
      viewer_anonymous_handle: null,
      viewer_is_admin: false,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return EMPTY_ROSTER;
    }
    throw err;
  }
}

/** Migration 142: promote a member to admin (admin-only). */
export async function apiPromoteGroupAdmin(
  routeId: string,
  userId: string,
): Promise<void> {
  await groupFetch<any>(`/${encodeURIComponent(routeId)}/admins`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

/** Migration 142: remove a non-admin member from a group and revoke the
 *  invite they joined through (admin-only; works on public groups too). */
export async function apiBootGroupMember(
  routeId: string,
  userId: string,
): Promise<void> {
  await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/members/${encodeURIComponent(userId)}/boot`,
    { method: 'POST' },
  );
}

/** Remove a specific ANONYMOUS member by their opaque roster handle
 *  (admin-only). The server never exposes the raw browser_id. */
export async function apiBootGroupAnonymous(
  routeId: string,
  handle: string,
): Promise<void> {
  await groupFetch<any>(
    `/${encodeURIComponent(routeId)}/members/by-handle/${encodeURIComponent(handle)}/boot`,
    { method: 'POST' },
  );
}

/** Encode an ArrayBuffer as base64. Chunked to avoid the `apply()`
 *  call-stack limit on big buffers — handles the 5 MiB max-image-size
 *  cap comfortably. */
function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}
