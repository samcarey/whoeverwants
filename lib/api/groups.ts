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
import { groupFetch, toPoll, toQuestionResults } from "./_internal";

function toGroupSummary(data: any): GroupSummary {
  return {
    id: data.id,
    short_id: data.short_id ?? null,
    title: data.title ?? null,
    created_at: data.created_at,
    image_updated_at: data.image_updated_at ?? null,
    privacy: data.privacy ?? null,
    creator_user_id: data.creator_user_id ?? null,
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
  if (polls.length > 0) {
    const groupIds = new Set<string>();
    for (const p of polls) if (p.group_id) groupIds.add(p.group_id);
    const cached = getCachedAccessiblePolls() ?? [];
    const others = cached.filter((p) => !p.group_id || !groupIds.has(p.group_id));
    cacheAccessiblePolls([...others, ...polls]);
  }
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
