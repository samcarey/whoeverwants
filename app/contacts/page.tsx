"use client";

/**
 * Contacts: friends, friend requests (incoming + sent), friend-request
 * suggestions (people you've been in suggested events together with),
 * private contact groups (the With/Without picker's groups pool), the
 * shareable friend link, and the block list.
 *
 * Reached from home's upper-right people button (which used to open the
 * group list — that page is now behind the "Groups Button" experimental
 * flag). Built on the /groups page pattern: own fixed title bar, floating
 * back button via HeaderPortal, swipe-back that reveals HomeBackdropHost
 * and commits to `/`.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiAcceptFriendRequest,
  apiBlockFriendRequest,
  apiBlockUser,
  apiCreateContactGroup,
  apiDeleteContactGroup,
  apiGetFriendsOverview,
  apiRejectFriendRequest,
  apiSendFriendRequest,
  apiUnblockUser,
  apiUnfriend,
  apiUpdateContactGroup,
  getCachedFriendsOverview,
  type ContactGroup,
  type FriendPerson,
  type FriendsOverview,
} from "@/lib/api/friends";
import { buildUserImageUrl } from "@/lib/api/users";
import {
  SHOW_HOME_BACKDROP_EVENT,
  HIDE_HOME_BACKDROP_EVENT,
} from "@/lib/eventChannels";
import {
  useSwipeBackGesture,
  useHeaderPortalRef,
  resetSwipeBackChrome,
} from "@/lib/useSwipeBackGesture";
import { setSwipeScrollbarLock } from "@/lib/scrollbarLock";
import { usePageReady } from "@/lib/usePageReady";
import { navigateWithTransition } from "@/lib/viewTransitions";
import { SESSION_CHANGED_EVENT } from "@/lib/session";
import { getUserName } from "@/lib/userProfile";
import { isValidUserName } from "@/lib/nameValidation";
import { copyTextToClipboard } from "@/lib/clipboard";
import { ApiError } from "@/lib/api/_internal";
import HeaderPortal from "@/components/HeaderPortal";
import ContactsTitleBar from "@/components/ContactsTitleBar";
import InitialBubble from "@/components/InitialBubble";
import ConfirmationModal from "@/components/ConfirmationModal";
import SignInModal from "@/components/SignInModal";
import AccountGateModal from "@/components/AccountGateModal";
import CandidatePicker, { type Candidate } from "@/components/CandidatePicker";

const CARD_CLASS =
  "rounded-3xl bg-gray-50 dark:bg-gray-800 px-4 divide-y divide-gray-200 dark:divide-gray-700";
const SECTION_LABEL_CLASS =
  "block text-[17.5px] font-medium text-gray-500 dark:text-gray-400 mb-1 px-1";

type PendingAction =
  | { kind: "unfriend"; person: FriendPerson }
  | { kind: "blockFriend"; person: FriendPerson }
  | { kind: "blockRequest"; requestId: string; person: FriendPerson }
  | { kind: "deleteGroup"; group: ContactGroup };

function personLabel(p: FriendPerson): string {
  return p.name?.trim() || "Someone";
}

function Avatar({ person }: { person: FriendPerson }) {
  return (
    <InitialBubble
      name={person.name?.trim() || null}
      imageUrl={
        person.image_updated_at
          ? buildUserImageUrl(person.user_id, person.image_updated_at)
          : null
      }
      sizeClassName="w-8 h-8"
    />
  );
}

export default function ContactsPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<FriendsOverview | null>(() =>
    typeof window === "undefined" ? null : getCachedFriendsOverview(),
  );
  const [loading, setLoading] = useState(overview === null);
  const [error, setError] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  // Suggestion rows the user tapped "Add" on this session (optimistic).
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  // Name-gate retry thunk (AccountGateModal pattern).
  const [pendingNameRetry, setPendingNameRetry] = useState<(() => void) | null>(null);

  usePageReady(true);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    resetSwipeBackChrome();
    setSwipeScrollbarLock(false);
  }, []);

  const refresh = useCallback(async (opts?: { showSpinner?: boolean }) => {
    if (opts?.showSpinner) setLoading(true);
    setError(null);
    try {
      const next = await apiGetFriendsOverview();
      setOverview(next);
    } catch (err) {
      console.error("Failed to load contacts:", err);
      if (!getCachedFriendsOverview()) {
        setError("Couldn't load your contacts. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh({ showSpinner: overview === null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const refetch = () => void refresh();
    window.addEventListener(SESSION_CHANGED_EVENT, refetch);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, refetch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  const headerPortalRef = useHeaderPortalRef();
  const { swipeWrapperRef, touchHandlers } = useSwipeBackGesture({
    headerRef: headerPortalRef,
    showBackdrop: () => window.dispatchEvent(new Event(SHOW_HOME_BACKDROP_EVENT)),
    hideBackdrop: () => window.dispatchEvent(new Event(HIDE_HOME_BACKDROP_EVENT)),
    onCommit: () => router.push("/"),
  });

  const surfaceActionError = (err: unknown, fallback: string) => {
    setActionError(err instanceof ApiError && err.message ? err.message : fallback);
  };

  const runAction = async (work: () => Promise<unknown>, fallback: string) => {
    setActionError(null);
    try {
      await work();
    } catch (err) {
      surfaceActionError(err, fallback);
    }
    await refresh();
  };

  /** Sending a request needs a saved name (the recipient has to recognize
   *  you) — stash a retry thunk behind AccountGateModal when it's missing. */
  const gateOnName = (retry: () => void): boolean => {
    if (isValidUserName(getUserName())) return true;
    setPendingNameRetry(() => retry);
    return false;
  };

  const sendRequestTo = (person: FriendPerson) => {
    const doSend = () => {
      setRequestedIds((prev) => new Set(prev).add(person.user_id));
      void runAction(
        () => apiSendFriendRequest({ toUserId: person.user_id }),
        "Couldn't send the request",
      );
    };
    if (gateOnName(doSend)) doSend();
  };

  const copyFriendLink = () => {
    const code = overview?.friend_code;
    if (!code) return;
    const url = `${window.location.origin}/f/${code}`;
    void copyTextToClipboard(url).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const setGroupMembers = (group: ContactGroup, next: string[]) => {
    // Optimistic local update so the picked pill appears/disappears instantly.
    setOverview((prev) => {
      if (!prev) return prev;
      const friendsById = new Map(prev.friends.map((f) => [f.user_id, f]));
      return {
        ...prev,
        groups: prev.groups.map((g) =>
          g.id === group.id
            ? {
                ...g,
                members: next
                  .map((id) => friendsById.get(id))
                  .filter((m): m is FriendPerson => !!m),
              }
            : g,
        ),
      };
    });
    void runAction(
      () => apiUpdateContactGroup(group.id, { memberIds: next }),
      "Couldn't update the group",
    );
  };

  const addGroupMember = (group: ContactGroup, c: Candidate) => {
    if (!c.id) return;
    const current = group.members.map((m) => m.user_id);
    if (current.includes(c.id)) return;
    setGroupMembers(group, [...current, c.id]);
  };

  const removeGroupMember = (group: ContactGroup, c: Candidate) => {
    setGroupMembers(
      group,
      group.members.map((m) => m.user_id).filter((id) => id !== c.id),
    );
  };

  const createGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setNewGroupOpen(false);
    setNewGroupName("");
    void runAction(async () => {
      const created = await apiCreateContactGroup(name);
      setExpandedGroupId(created.id);
    }, "Couldn't create the group");
  };

  const confirmPendingAction = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === "unfriend") {
      void runAction(() => apiUnfriend(action.person.user_id), "Couldn't remove the friend");
    } else if (action.kind === "blockFriend") {
      void runAction(() => apiBlockUser(action.person.user_id), "Couldn't block them");
    } else if (action.kind === "blockRequest") {
      void runAction(() => apiBlockFriendRequest(action.requestId), "Couldn't block them");
    } else if (action.kind === "deleteGroup") {
      void runAction(() => apiDeleteContactGroup(action.group.id), "Couldn't delete the group");
    }
  };

  const pendingActionMessage = (() => {
    if (!pendingAction) return "";
    if (pendingAction.kind === "unfriend")
      return `Remove ${personLabel(pendingAction.person)} from your friends?`;
    if (pendingAction.kind === "deleteGroup")
      return `Delete the group "${pendingAction.group.name}"?`;
    return `Block ${personLabel(pendingAction.person)}? They won't be able to send you requests, and you'll never be suggested for events together.`;
  })();

  const outgoingIds = new Set(overview?.outgoing.map((o) => o.user_id) ?? []);

  return (
    <>
      <HeaderPortal>
        <ContactsTitleBar fixed />
        <button
          onClick={() => navigateWithTransition(router, "/", "back")}
          className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
          aria-label="Go back"
        >
          <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </HeaderPortal>

      <div
        ref={swipeWrapperRef}
        {...touchHandlers}
        className="touch-pan-y"
        style={{
          willChange: "transform",
          position: "relative",
          zIndex: 2,
          background: "var(--background)",
          minHeight: "100dvh",
          marginLeft: "calc(-1rem - max(0.35rem, env(safe-area-inset-left, 0px)))",
          marginRight: "calc(-1rem - max(0.35rem, env(safe-area-inset-right, 0px)))",
        }}
      >
        <div
          className="max-w-4xl mx-auto"
          style={{
            paddingLeft: "max(1rem, env(safe-area-inset-left, 0px))",
            paddingRight: "max(1rem, env(safe-area-inset-right, 0px))",
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 3.5rem)",
            paddingBottom: "6rem",
          }}
        >
          {loading && (
            <div className="flex justify-center items-center py-8">
              <svg className="animate-spin h-8 w-8 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          )}

          {error && !loading && (
            <div className="p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded-md text-center">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => void refresh({ showSpinner: true })}
                className="mt-3 inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && overview && !overview.signed_in && (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                Sign in to add friends and build contact groups
              </p>
              <button
                type="button"
                onClick={() => setSignInOpen(true)}
                className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Sign In
              </button>
            </div>
          )}

          {!loading && !error && overview?.signed_in && (
            <div className="space-y-5">
              {actionError && (
                <div className="p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-xl text-sm text-center">
                  {actionError}
                </div>
              )}

              {/* Incoming friend requests */}
              {overview.incoming.length > 0 && (
                <section>
                  <span className={SECTION_LABEL_CLASS}>Friend Requests</span>
                  <div className={CARD_CLASS}>
                    {overview.incoming.map((req) => (
                      <div key={req.id} className="flex items-center gap-3 py-2.5 min-h-12">
                        <Avatar person={req} />
                        <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-gray-100">
                          {personLabel(req)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              () => apiAcceptFriendRequest(req.id),
                              "Couldn't accept the request",
                            )
                          }
                          className="shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-full"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              () => apiRejectFriendRequest(req.id),
                              "Couldn't decline the request",
                            )
                          }
                          className="shrink-0 text-sm text-gray-500 dark:text-gray-400 hover:underline"
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingAction({ kind: "blockRequest", requestId: req.id, person: req })
                          }
                          className="shrink-0 text-sm text-red-600 dark:text-red-400 hover:underline"
                        >
                          Block
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Friend link */}
              <section>
                <span className={SECTION_LABEL_CLASS}>Invite a Friend</span>
                <div className={CARD_CLASS}>
                  <button
                    type="button"
                    onClick={copyFriendLink}
                    className="w-full flex items-center gap-3 h-12 text-left"
                  >
                    <svg className="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                    <span className="flex-1 text-blue-600 dark:text-blue-400 font-medium">
                      {copied ? "Copied!" : "Copy your friend link"}
                    </span>
                  </button>
                </div>
                <p className="mt-1 px-1 text-xs text-gray-500 dark:text-gray-400">
                  Send it to someone — they&apos;ll see your profile and can send you a
                  friend request you approve.
                </p>
              </section>

              {/* Friends */}
              <section>
                <span className={SECTION_LABEL_CLASS}>Friends</span>
                <div className={CARD_CLASS}>
                  {overview.friends.length === 0 && (
                    <p className="py-4 text-sm text-gray-500 dark:text-gray-400">
                      No friends yet — accept a request or share your link above.
                    </p>
                  )}
                  {overview.friends.map((friend) => (
                    <div key={friend.user_id} className="flex items-center gap-3 py-2.5 min-h-12">
                      <Avatar person={friend} />
                      <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-gray-100">
                        {personLabel(friend)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPendingAction({ kind: "unfriend", person: friend })}
                        className="shrink-0 text-sm text-gray-500 dark:text-gray-400 hover:underline"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction({ kind: "blockFriend", person: friend })}
                        className="shrink-0 text-sm text-red-600 dark:text-red-400 hover:underline"
                      >
                        Block
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Suggestions (people from shared suggested events / groups) */}
              {(overview.suggestions.length > 0 || overview.outgoing.length > 0) && (
                <section>
                  <span className={SECTION_LABEL_CLASS}>People From Your Events</span>
                  <div className={CARD_CLASS}>
                    {overview.outgoing.map((req) => (
                      <div key={req.id} className="flex items-center gap-3 py-2.5 min-h-12">
                        <Avatar person={req} />
                        <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-gray-100">
                          {personLabel(req)}
                        </span>
                        <span className="shrink-0 text-sm text-gray-400 dark:text-gray-500">
                          Requested
                        </span>
                      </div>
                    ))}
                    {overview.suggestions.map((person) => (
                      <div key={person.user_id} className="flex items-center gap-3 py-2.5 min-h-12">
                        <Avatar person={person} />
                        <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-gray-100">
                          {personLabel(person)}
                        </span>
                        {requestedIds.has(person.user_id) || outgoingIds.has(person.user_id) ? (
                          <span className="shrink-0 text-sm text-gray-400 dark:text-gray-500">
                            Requested
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => sendRequestTo(person)}
                            className="shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-full"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Contact groups */}
              <section>
                <div className="flex items-center justify-between mb-1 px-1">
                  <span className="text-[17.5px] font-medium text-gray-500 dark:text-gray-400">
                    Groups
                  </span>
                  <button
                    type="button"
                    onClick={() => setNewGroupOpen((v) => !v)}
                    className="w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"
                    aria-label="New group"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-3">
                  {newGroupOpen && (
                    <div className={`${CARD_CLASS} flex items-center gap-2 py-2.5`}>
                      <div className="relative flex-1 min-w-0">
                        <input
                          type="text"
                          value={newGroupName}
                          onChange={(e) => setNewGroupName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") createGroup();
                            else if (e.key === "Escape") {
                              setNewGroupOpen(false);
                              setNewGroupName("");
                            }
                          }}
                          placeholder="Group name"
                          maxLength={50}
                          autoFocus
                          className="w-full h-9 pl-3 pr-8 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          // Cancel: close the input card and drop the typed name.
                          // mousedown-preventDefault so the tap doesn't blur-flash
                          // the focused input before the click lands.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setNewGroupOpen(false);
                            setNewGroupName("");
                          }}
                          aria-label="Cancel new group"
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={createGroup}
                        disabled={!newGroupName.trim()}
                        className="shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium rounded-full"
                      >
                        Create
                      </button>
                    </div>
                  )}
                  {overview.groups.length === 0 && !newGroupOpen && (
                    <div className={CARD_CLASS}>
                      <p className="py-4 text-sm text-gray-500 dark:text-gray-400">
                        Group your friends (&quot;Climbing crew&quot;, &quot;Family&quot;) to pick them
                        all at once in an activity&apos;s With field. Only you see your groups.
                      </p>
                    </div>
                  )}
                  {overview.groups.map((group) => {
                    const expanded = expandedGroupId === group.id;
                    return (
                      <div key={group.id} className={`${CARD_CLASS} py-1`}>
                        <button
                          type="button"
                          onClick={() => setExpandedGroupId(expanded ? null : group.id)}
                          className="w-full flex items-center gap-3 h-11 text-left"
                        >
                          <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-gray-100">
                            {group.name}
                          </span>
                          <span className="shrink-0 text-sm text-gray-400 dark:text-gray-500">
                            {group.members.length || "No"} {group.members.length === 1 ? "person" : "people"}
                          </span>
                          <svg
                            className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        {expanded && (
                          <div className="pb-2">
                            {overview.friends.length === 0 ? (
                              <p className="py-2 text-sm text-gray-500 dark:text-gray-400">
                                Add friends first — groups are made of your friends.
                              </p>
                            ) : (
                              /* The same search-box picker the With/Without
                                 fields use: type to filter your friends, tap
                                 to add; picks render as removable pills.
                                 Options are least-relevant-first (the picker
                                 reverses), so reverse-alphabetical here puts
                                 A nearest the box. */
                              <CandidatePicker
                                label="Members"
                                emptyValue="No one yet"
                                selected={group.members.map((m) => ({
                                  kind: "people" as const,
                                  id: m.user_id,
                                  name: personLabel(m),
                                }))}
                                options={[...overview.friends]
                                  .sort((a, b) => personLabel(b).localeCompare(personLabel(a)))
                                  .map((f) => ({
                                    kind: "people" as const,
                                    id: f.user_id,
                                    name: personLabel(f),
                                  }))}
                                onAdd={(c) => addGroupMember(group, c)}
                                onRemove={(c) => removeGroupMember(group, c)}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setPendingAction({ kind: "deleteGroup", group })}
                              className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
                            >
                              Delete group
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Blocked */}
              {overview.blocked.length > 0 && (
                <section>
                  <span className={SECTION_LABEL_CLASS}>Blocked</span>
                  <div className={CARD_CLASS}>
                    {overview.blocked.map((person) => (
                      <div key={person.user_id} className="flex items-center gap-3 py-2.5 min-h-12">
                        <span className="flex-1 min-w-0 truncate text-gray-500 dark:text-gray-400">
                          {personLabel(person)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              () => apiUnblockUser(person.user_id),
                              "Couldn't unblock them",
                            )
                          }
                          className="shrink-0 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          <SignInModal isOpen={signInOpen} onClose={() => setSignInOpen(false)} />
          <AccountGateModal
            isOpen={pendingNameRetry !== null}
            message="to add friends"
            onSubmit={() => {
              const retry = pendingNameRetry;
              setPendingNameRetry(null);
              retry?.();
            }}
            onCancel={() => setPendingNameRetry(null)}
          />
          <ConfirmationModal
            isOpen={pendingAction !== null}
            message={pendingActionMessage}
            confirmText={
              pendingAction?.kind === "unfriend"
                ? "Remove"
                : pendingAction?.kind === "deleteGroup"
                  ? "Delete"
                  : "Block"
            }
            onConfirm={confirmPendingAction}
            onCancel={() => setPendingAction(null)}
          />
        </div>
      </div>
    </>
  );
}
