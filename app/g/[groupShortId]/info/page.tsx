"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { hasAppHistory } from "@/lib/viewTransitions";
import {
  slideToGroupRoot,
  slideToGroupEditTitle,
  slideToGroupInviteMembers,
} from "@/lib/slideOverlay";
import { useGroup } from "@/lib/useGroup";
import { nameCount } from "@/lib/groupUtils";
import {
  apiGetGroupMembers,
  apiPromoteGroupAdmin,
  apiBootGroupMember,
  apiBootGroupAnonymous,
} from "@/lib/api";
import type { GroupRoster, AnonymousMember } from "@/lib/api";
import ConfirmationModal from "@/components/ConfirmationModal";
import {
  GROUP_MEMBERS_CHANGED_EVENT,
  type GroupMembersChangedDetail,
} from "@/lib/eventChannels";
import GroupAvatar from "@/components/GroupAvatar";
import GroupShareButton from "@/components/GroupShareButton";
import GroupPrivacySection from "@/components/GroupPrivacySection";
import HeaderPortal from "@/components/HeaderPortal";
import InitialBubble from "@/components/InitialBubble";
import RosterRow from "@/components/RosterRow";
import MemberActionsSheet from "@/components/MemberActionsSheet";
import { haptic } from "@/lib/haptics";
import InviteLinksSection from "@/components/InviteLinksSection";
import JoinRequestsSection from "@/components/JoinRequestsSection";
import NotificationSettingsCard from "@/components/NotificationSettingsCard";
import { GroupLoading, GroupNotFound } from "@/components/GroupLoadState";
import { getUserName, isCurrentUserName } from "@/lib/userProfile";
import { useMyUserImageUrl } from "@/lib/useMyUserImageUrl";
import {
  getCachedSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/session";

/** Prop-driven inner view. Exposed so the slide overlay can render this
 *  view directly without going through useParams() (the overlay mounts
 *  the component while the URL is still the source page). */
export function GroupInfoView({ groupId }: { groupId: string }) {
  const { group, loading, error } = useGroup(groupId);

  if (loading) return <GroupLoading />;
  if (error || !group) return <GroupNotFound routeId={groupId} />;
  return <Info group={group} groupId={groupId} />;
}

function Info({ group, groupId }: { group: import("@/lib/groupUtils").Group; groupId: string }) {
  const myUserImageUrl = useMyUserImageUrl();
  // Mirror GroupPrivacySection's session-tracking pattern: seed from
  // the localStorage-cached profile on mount, then subscribe to live
  // session changes so the JoinRequestsSection mounts/unmounts the
  // moment the viewer signs in or out without a remount of the page.
  const [session, setSession] = useState<SessionUser | null>(null);
  useEffect(() => {
    setSession(getCachedSessionUser());
    const update = () => setSession(getCachedSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, update);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, update);
  }, []);
  // Migration 142: a pending promote/boot the admin must confirm (both are
  // consequential — promote is permanent, boot removes a member + revokes
  // their invite link).
  const [pendingAction, setPendingAction] = useState<
    | { kind: "promote" | "boot"; userId: string; name: string }
    | { kind: "boot-anon"; handle: string; name: string }
    | null
  >(null);
  // The member whose 3-dots action sheet is open. Named members carry a
  // `userId` (promote/boot); anonymous members carry an opaque `handle`
  // (Remove only — they can't be promoted).
  const [actionsFor, setActionsFor] = useState<
    | { userId: string; name: string }
    | { handle: string; name: string }
    | null
  >(null);
  // Anonymous members are returned only as a count (no per-person data), so
  // the rolled-up "N anonymous" row expands into N identical "Anonymous" rows.
  const [anonExpanded, setAnonExpanded] = useState(false);

  const goBack = () => {
    // Slide overlay: mount the group root above the current page and slide
    // it in from the left. router.back() (or .push if no in-app history)
    // fires in parallel from the overlay host. Eliminates the
    // view-transitions snapshot+commit wait before the first frame.
    slideToGroupRoot({ groupId, direction: 'back', useHistoryBack: hasAppHistory() });
  };

  // /info is the canonical roster. It's built from the ACTUAL membership
  // (`group_members`) via `apiGetGroupMembers`, NOT from
  // `group.participantNames` (poll creators/voters) — otherwise a member who
  // joined via approve / invite-link / "Add people" but hasn't voted on a
  // poll yet is invisible (the reported bug: approve Bob → roster still shows
  // only you). `rosterTick` re-fetches after an approval + on tab refocus.
  const currentUserName = getUserName()?.trim() || null;
  const viewerLabel = currentUserName ?? "You";
  const [roster, setRoster] = useState<GroupRoster | null>(null);
  const [rosterTick, setRosterTick] = useState(0);
  const viewerIsAdmin = roster?.viewer_is_admin ?? false;

  const runPendingAction = () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    const call =
      action.kind === "promote"
        ? apiPromoteGroupAdmin(groupId, action.userId)
        : action.kind === "boot"
          ? apiBootGroupMember(groupId, action.userId)
          : apiBootGroupAnonymous(groupId, action.handle);
    // Refetch the roster on success so the badge / removal reflects.
    call.then(() => setRosterTick((t) => t + 1)).catch(() => {
      setRosterTick((t) => t + 1);
    });
  };
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiGetGroupMembers(groupId)
        .then((r) => { if (!cancelled) setRoster(r); })
        .catch(() => { /* keep the participant-name fallback on failure */ });
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    // The "Add people" screen slides back to this still-mounted page, so a
    // remount can't be relied on — refetch when it reports a membership change.
    const onMembersChanged = (e: Event) => {
      const detail = (e as CustomEvent<GroupMembersChangedDetail>).detail;
      if (detail?.routeId === groupId) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(GROUP_MEMBERS_CHANGED_EVENT, onMembersChanged);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(GROUP_MEMBERS_CHANGED_EVENT, onMembersChanged);
    };
  }, [groupId, rosterTick]);

  // Each member is one person; `key` disambiguates two genuinely-different
  // people who share a name (two "Bob"s). `anonymousExtra` is the rolled-up
  // count of members with no resolvable name (drive-by URL visitors on a
  // public group).
  // `userId` is the account to long-press → profile modal (null = anonymous or
  // the viewer's own row, which isn't long-pressable). `isAdmin` drives the
  // Admin badge + gates the promote/boot actions.
  type MemberRow = {
    name: string;
    key: string;
    userId: string | null;
    isAdmin: boolean;
  };
  let membersList: MemberRow[];
  let totalCount: number;
  let anonymousMembers: AnonymousMember[] = [];
  if (roster) {
    totalCount = roster.members.length + roster.anonymous_count;
    anonymousMembers = [...roster.anonymous_members];
    const rows: MemberRow[] = roster.members.map((m, i) => ({
      name: m.name,
      key: `member-${m.user_id ?? m.name}-${i}`,
      // Don't long-press yourself; otherwise the resolved account.
      userId: isCurrentUserName(m.name) ? null : m.user_id,
      isAdmin: m.is_admin,
    }));
    // The viewer is always a member (visiting auto-joins / the creator is a
    // member). If they aren't a resolved named row, they're one of the
    // anonymous members — surface them as themselves and drop one anonymous
    // slot (the viewer's; anonymous members are indistinguishable, and you
    // can't boot yourself anyway) so the headcount stays right.
    if (!rows.some((r) => isCurrentUserName(r.name))) {
      // Viewer's own row isn't long-pressable (userId null); isAdmin still
      // drives the Admin badge on your own row.
      rows.push({
        name: viewerLabel,
        key: "__viewer__",
        userId: null,
        isAdmin: viewerIsAdmin,
      });
      if (anonymousMembers.length > 0) anonymousMembers.shift();
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    membersList = rows;
  } else {
    // First-paint fallback before the roster lands: poll participants + the
    // viewer (the prior behavior). Replaced within a tick by the real roster.
    membersList = [
      ...group.participantNames.flatMap((name) =>
        Array.from(
          { length: nameCount(group.participantNameCounts, name) },
          (_, i) => ({ name, key: `${name}#${i}`, userId: null, isAdmin: false }),
        ),
      ),
      { name: viewerLabel, key: "__viewer__", userId: null, isAdmin: false },
    ].sort((a, b) => a.name.localeCompare(b.name));
    totalCount = membersList.length;
  }

  // Hero + title also surface the viewer in the solo case so the page
  // doesn't render a gray placeholder + "New Group" fallback for a
  // single-member group. Gated on a real name — we'd rather not invent a
  // group name from "You".
  const showViewerInHero =
    group.participantNames.length === 0 &&
    group.anonymousRespondentCount === 0 &&
    currentUserName !== null;
  const heroNames = showViewerInHero ? [currentUserName] : group.participantNames;
  const displayTitle =
    showViewerInHero && !group.groupTitleOverride ? currentUserName : group.title;

  return (
    <>
      {/* Portaled outside .responsive-scaling-container so position:fixed is
       *  viewport-relative on desktop (the scaling transform would otherwise
       *  make these buttons fixed to the scaled container, not the viewport). */}
      <HeaderPortal>
        <button
          onClick={goBack}
          className="fixed left-3 z-30 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
          aria-label="Go back"
        >
          <svg className="w-6 h-6 text-gray-700 dark:text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {viewerIsAdmin && (
          <button
            onClick={() => slideToGroupEditTitle({ groupId, direction: 'forward' })}
            className="fixed right-3 z-30 h-10 px-4 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 active:opacity-70 text-blue-600 dark:text-blue-400 text-sm font-medium"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
            aria-label="Edit group title"
          >
            Edit
          </button>
        )}
      </HeaderPortal>

      <div className="max-w-4xl mx-auto px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.05rem)' }}>
        <div className="flex flex-col items-center text-center mb-[3.2px]">
          <div className="relative inline-block">
            <GroupAvatar
              imageUrl={group.imageUrl}
              names={heroNames}
              anonymousCount={group.anonymousRespondentCount}
              nameCounts={group.participantNameCounts}
              sizeClassName="w-[8.4rem]"
            />
            <div className="absolute left-full top-1/2 -translate-y-1/2 ml-[0.09rem]">
              <GroupShareButton routeId={groupId} title={group.title} />
            </div>
          </div>
          <h1 className="mt-[0.2rem] text-3xl font-bold text-gray-900 dark:text-white break-words">
            {displayTitle}
          </h1>
        </div>

        <GroupPrivacySection
          group={group}
          groupId={groupId}
          viewerIsAdmin={viewerIsAdmin}
        />

        <JoinRequestsSection
          groupId={groupId}
          enabled={viewerIsAdmin}
          onDecided={(action) => {
            if (action === "approve") setRosterTick((t) => t + 1);
          }}
        />

        <InviteLinksSection groupId={groupId} enabled={viewerIsAdmin} />

        <NotificationSettingsCard groupRouteId={groupId} className="mt-[0.96rem]" />

        {viewerIsAdmin && (
          <button
            type="button"
            onClick={() => slideToGroupInviteMembers({ groupId, direction: 'forward' })}
            className="mt-6 w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-sm font-medium flex items-center justify-center gap-2 transition-transform"
            aria-label="Add people to this group"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3M9 12a4 4 0 100-8 4 4 0 000 8zm0 0c-2.761 0-5 2.239-5 5v1h7" />
            </svg>
            Add people
          </button>
        )}

        <h2 className="mt-4 px-1 mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
          {totalCount} {totalCount === 1 ? 'Member' : 'Members'}
        </h2>

        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {membersList.map(({ name, key, userId, isAdmin }) => {
              // Viewer row resolves either as the literal "You" label
              // (no saved name) or as a real-name row matching the
              // current saved name. `name === "You"` passes `null` to
              // the bubble so it falls through to the gray anonymous
              // fallback instead of rendering a "Y" initial.
              const isViewer = name === viewerLabel || isCurrentUserName(name);
              const imageUrl = isViewer ? myUserImageUrl : null;
              const bubbleName = name === "You" ? null : name;
              // Admins can act on non-admin, account-backed members other
              // than themselves (Q4: admins can't demote/boot each other).
              // `userId` is the member's real account id (main's RosterRow
              // long-press path nulls it only for the viewer's own / anonymous
              // rows, which `!isViewer` / `!!userId` already exclude).
              const canManage = viewerIsAdmin && !!userId && !isViewer && !isAdmin;
              return (
                <RosterRow
                  key={key}
                  displayName={name}
                  bubbleName={bubbleName}
                  imageUrl={imageUrl}
                  userId={userId}
                  isAdmin={isAdmin}
                  actions={
                    canManage ? (
                      <button
                        type="button"
                        // stopPropagation so a tap on the 3-dots doesn't also
                        // fire the row's long-press → profile modal.
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          haptic.medium();
                          setActionsFor({ userId: userId!, name });
                        }}
                        className="shrink-0 w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 active:opacity-70"
                        aria-label={`Actions for ${name}`}
                      >
                        <svg
                          className="w-5 h-5"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden
                        >
                          <circle cx="12" cy="5" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>
                    ) : null
                  }
                />
              );
            })}
            {anonymousMembers.length > 0 && (
              <>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      haptic.light();
                      setAnonExpanded((v) => !v);
                    }}
                    aria-expanded={anonExpanded}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-500 dark:text-gray-400 italic hover:bg-gray-50 dark:hover:bg-gray-800/50 active:opacity-70"
                  >
                    <InitialBubble
                      name={null}
                      sizeClassName="w-8 h-8"
                      className="shrink-0"
                    />
                    <span className="min-w-0 break-words flex-1">
                      {anonymousMembers.length} anonymous
                    </span>
                    <svg
                      className={`shrink-0 w-4 h-4 transition-transform ${anonExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </li>
                {anonExpanded &&
                  anonymousMembers.map((m) => (
                    <li
                      key={`anon-${m.handle}`}
                      className="flex items-center gap-3 px-4 py-3 text-gray-500 dark:text-gray-400 italic"
                    >
                      <InitialBubble
                        name={null}
                        sizeClassName="w-8 h-8"
                        className="shrink-0"
                      />
                      <span className="min-w-0 break-words flex-1">Anonymous</span>
                      {viewerIsAdmin && (
                        <button
                          type="button"
                          onClick={() =>
                            setActionsFor({ handle: m.handle, name: "Anonymous" })
                          }
                          className="shrink-0 w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 active:opacity-70"
                          aria-label="Actions for anonymous member"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
              </>
            )}
          </ul>
        </div>
      </div>

      {actionsFor && (
        <MemberActionsSheet
          isOpen={true}
          name={actionsFor.name}
          // Anonymous members (carry a handle) can be removed but not promoted.
          canMakeAdmin={"userId" in actionsFor}
          canRemove={true}
          onMakeAdmin={() => {
            if ("userId" in actionsFor) {
              setPendingAction({ kind: "promote", userId: actionsFor.userId, name: actionsFor.name });
            }
            setActionsFor(null);
          }}
          onRemove={() => {
            setPendingAction(
              "userId" in actionsFor
                ? { kind: "boot", userId: actionsFor.userId, name: actionsFor.name }
                : { kind: "boot-anon", handle: actionsFor.handle, name: actionsFor.name },
            );
            setActionsFor(null);
          }}
          onClose={() => setActionsFor(null)}
        />
      )}

      {pendingAction && (
        <ConfirmationModal
          isOpen={true}
          onConfirm={runPendingAction}
          onCancel={() => setPendingAction(null)}
          message={
            pendingAction.kind === "promote"
              ? `Make ${pendingAction.name} an admin? Admins can manage members, invites, and group settings. This can't be undone.`
              : `Remove ${pendingAction.name} from the group? Any invite link they joined with stops working. On a public group they can rejoin by visiting the link again.`
          }
          confirmText={pendingAction.kind === "promote" ? "Make admin" : "Remove"}
          confirmButtonClass={
            pendingAction.kind === "promote"
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-red-600 hover:bg-red-700 text-white"
          }
        />
      )}
    </>
  );
}

function GroupInfoInner() {
  const params = useParams();
  const groupId = params.groupShortId as string;
  return <GroupInfoView groupId={groupId} />;
}

export default function GroupInfoPage() {
  return (
    <Suspense fallback={<GroupLoading />}>
      <GroupInfoInner />
    </Suspense>
  );
}
