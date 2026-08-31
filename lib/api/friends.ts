/**
 * Friends API client (migration 158): the /contacts overview (friends /
 * requests / suggestions / blocks / contact groups / the shareable friend
 * code), the request lifecycle, and the /f/<code> profile lookup.
 *
 * `friendsOverviewCache` is the last-resolved snapshot (no TTL) so /contacts
 * can paint its settled state on the first commit of a swipe-back/slide
 * handoff — the groupRosterCache convention.
 */

import { friendFetch } from "./_internal";

export interface FriendPerson {
  user_id: string;
  name: string | null;
  image_updated_at?: string | null;
}

export interface FriendRequestRef extends FriendPerson {
  id: string;
  created_at?: string | null;
}

export interface ContactGroup {
  id: string;
  name: string;
  members: FriendPerson[];
}

export interface FriendsOverview {
  signed_in: boolean;
  friend_code: string | null;
  friends: FriendPerson[];
  incoming: FriendRequestRef[];
  outgoing: FriendRequestRef[];
  suggestions: FriendPerson[];
  blocked: FriendPerson[];
  groups: ContactGroup[];
}

export interface FriendProfile {
  user_id: string;
  name: string | null;
  created_at?: string | null;
  image_updated_at?: string | null;
  relationship: "self" | "friends" | "incoming" | "outgoing" | "blocked" | "none";
}

let friendsOverviewCache: FriendsOverview | null = null;

export function getCachedFriendsOverview(): FriendsOverview | null {
  return friendsOverviewCache;
}

export async function apiGetFriendsOverview(): Promise<FriendsOverview> {
  const overview = await friendFetch<FriendsOverview>("");
  friendsOverviewCache = overview;
  return overview;
}

export function apiSendFriendRequest(opts: {
  toUserId?: string;
  code?: string;
}): Promise<{ status: string }> {
  return friendFetch<{ status: string }>("/requests", {
    method: "POST",
    body: JSON.stringify({ to_user_id: opts.toUserId ?? null, code: opts.code ?? null }),
  });
}

export function apiAcceptFriendRequest(requestId: string): Promise<{ status: string }> {
  return friendFetch<{ status: string }>(`/requests/${requestId}/accept`, { method: "POST" });
}

export function apiRejectFriendRequest(requestId: string): Promise<{ status: string }> {
  return friendFetch<{ status: string }>(`/requests/${requestId}/reject`, { method: "POST" });
}

export function apiBlockFriendRequest(requestId: string): Promise<{ status: string }> {
  return friendFetch<{ status: string }>(`/requests/${requestId}/block`, { method: "POST" });
}

export function apiUnfriend(userId: string): Promise<void> {
  return friendFetch<void>(`/friendship/${userId}`, { method: "DELETE" });
}

export function apiBlockUser(userId: string): Promise<{ status: string }> {
  return friendFetch<{ status: string }>("/blocks", {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function apiUnblockUser(userId: string): Promise<void> {
  return friendFetch<void>(`/blocks/${userId}`, { method: "DELETE" });
}

export function apiCreateContactGroup(
  name: string,
  memberIds: string[] = [],
): Promise<{ id: string; name: string }> {
  return friendFetch<{ id: string; name: string }>("/groups", {
    method: "POST",
    body: JSON.stringify({ name, member_ids: memberIds }),
  });
}

export function apiUpdateContactGroup(
  groupId: string,
  opts: { name?: string; memberIds?: string[] },
): Promise<{ status: string }> {
  return friendFetch<{ status: string }>(`/groups/${groupId}`, {
    method: "PUT",
    body: JSON.stringify({
      name: opts.name ?? null,
      member_ids: opts.memberIds ?? null,
    }),
  });
}

export function apiDeleteContactGroup(groupId: string): Promise<void> {
  return friendFetch<void>(`/groups/${groupId}`, { method: "DELETE" });
}

export function apiGetFriendProfile(code: string): Promise<FriendProfile> {
  return friendFetch<FriendProfile>(`/profile/${encodeURIComponent(code)}`);
}
