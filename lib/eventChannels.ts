/**
 * Cross-component custom event channels.
 *
 * Pattern matches `QUESTION_VOTES_CHANGED_EVENT` in `lib/api/votes.ts`:
 * a string-named CustomEvent dispatched on `window` with a typed `detail`
 * payload, so listeners can subscribe across module / portal boundaries
 * without prop drilling. Centralized here so the dispatcher and listener
 * sides can't drift apart.
 *
 * Add a new event by exporting a const + a `*Detail` type alongside it.
 */

import type { Poll } from "@/lib/types";

/** Fired by CreateQuestionContent immediately on Submit (BEFORE the API call
 *  resolves). Carries a placeholder Poll built from the draft state.
 *  GroupContent listens, inserts the placeholder into its poll list, and
 *  fades the new card in via the `card-pending-enter` CSS class.
 *  The real apiCreatePoll continues in parallel; on success it fires
 *  `POLL_HYDRATED_EVENT` with the real Poll keyed by the placeholder id. */
export const POLL_PENDING_EVENT = 'pollPending';
export interface PollPendingDetail {
  poll: Poll;
}

/** Fired after `apiCreatePoll` resolves. Identifies the placeholder by the
 *  id it was inserted with so GroupContent can swap its fields in-place. */
export const POLL_HYDRATED_EVENT = 'pollHydrated';
export interface PollHydratedDetail {
  placeholderId: string;
  poll: Poll;
}

/** Fired when `apiCreatePoll` rejects. GroupContent removes the orphan
 *  placeholder from group state so the user doesn't see a partial card
 *  with no chrome lingering after a failed submit. The form is restored
 *  separately by CreateQuestionContent. */
export const POLL_FAILED_EVENT = 'pollFailed';
export interface PollFailedDetail {
  placeholderId: string;
}

/** Fired by GroupList when bulk-forget selection mode toggles on the home
 *  page. The template listens to hide the upper-left settings gear so the
 *  cancel (X) button portalled into the same slot owns the hit area. */
export const HOME_SELECTION_MODE_CHANGE_EVENT = 'homeSelectionModeChange';
export interface HomeSelectionModeChangeDetail {
  active: boolean;
}

/** Fired after a group's membership changes from a surface OTHER than the
 *  /info page itself (today: the "Add people" / invite-members screen, which
 *  slides BACK to a still-mounted /info — so /info can't rely on a remount to
 *  re-read the roster). /info listens and refetches its member list when the
 *  `routeId` matches. (Join-request approvals are handled in-place via
 *  JoinRequestsSection's `onDecided`, so they don't need this.) */
export const GROUP_MEMBERS_CHANGED_EVENT = 'groupMembersChanged';
export interface GroupMembersChangedDetail {
  /** The group route id (short_id or uuid) whose membership changed. */
  routeId: string;
}

/** Fired after the long-press profile modal's "Forget" action succeeds
 *  (`apiForgetUserContact` resolved). Contact-driven lists that are already
 *  mounted — today the invite-members ("Add people") screen, which is the
 *  main surface where a no-shared-groups person appears — listen and drop
 *  the forgotten account from their local state, since the modal lives at
 *  the layout level and can't reach them via props. */
export const USER_CONTACT_FORGOTTEN_EVENT = 'userContactForgotten';
export interface UserContactForgottenDetail {
  /** The forgotten account's user_id. */
  userId: string;
}

/** Fired by `slideToGroup()` / `slideToGroupInfo()` / `slideToGroupEditTitle()`
 *  / `slideToGroupRoot()` to ask `SlideOverlayHost` to mount the destination
 *  overlay + run the slide-in animation. The host calls `router.push(href)`
 *  (or `router.back()` when `useHistoryBack` is true) in parallel so the
 *  URL/history catch up while the CSS slide plays — see `lib/slideOverlay.tsx`
 *  for the full lifecycle. */
export const SLIDE_TO_GROUP_EVENT = 'slideToGroup';

export type SlideOverlayKind =
  | { type: 'group'; groupId: string }
  | { type: 'groupInfo'; groupId: string }
  | { type: 'groupEditTitle'; groupId: string }
  // Invite-members screen at /g/<group>/invite-members. Search the caller's
  // contacts, select accounts with round checkboxes, Update to add them.
  // Reached from the "Add people" button atop the /info members list.
  | { type: 'groupInviteMembers'; groupId: string }
  // Scheduled page at /g/<group>/scheduled. Lists the upcoming auto-opening
  // instances of the group's recurring polls (prototype). Reached from the
  // "Scheduled ›" link at the top of the group scroll.
  | { type: 'groupScheduled'; groupId: string }
  // Per-poll detail page. Tapping a card on /g/<group> slides to
  // /g/<group>/p/<pollShortId>, which renders the poll's full content
  // (results, ballots, voter list) without card chrome.
  | { type: 'pollDetail'; groupId: string; pollShortId: string }
  // Per-poll info page at /g/<group>/p/<pollShortId>/info. Hosts the
  // poll-level actions (forget / reopen / close / cutoff) and the full
  // respondent list. Tapping the title on the poll detail page slides here.
  | { type: 'pollInfo'; groupId: string; pollShortId: string }
  // Empty "New Group" placeholder, used by the home new group button. The overlay
  // renders the same content as `/g/`'s EmptyPlaceholder; the actual group
  // is created via `apiCreateGroup` in parallel, and the caller fires
  // `router.push('/g/<short_id>')` once it resolves (or `/g` on failure).
  // The host skips its automatic `router.push(href)` for this kind so the
  // caller owns the navigation.
  | { type: 'newGroup' };

/** Fired by `SlideOverlayHost` whenever a group-kind slide overlay
 *  (`'group'` or `'newGroup'`) mounts or unmounts. `<GroupContent>` (the
 *  group root view, which is the slide's destination in these cases)
 *  subscribes via `useIsSlideOverlayGroupActive()` and elevates its
 *  portaled scroll-helper arrows above the overlay (z-70 instead of z-40)
 *  while active — without elevation the arrows sit at z-40 underneath the
 *  overlay's z-60 opaque background and only become visible after the
 *  overlay unmounts (~410ms in, surfacing as "arrows only appear after
 *  the transition"). Non-group kinds (`'groupInfo'`, `'pollDetail'`, etc.)
 *  don't fire this event because the source group's arrows under those
 *  overlays should remain at the default z-40 and naturally get covered
 *  as the overlay slides across the viewport. */
export const SLIDE_OVERLAY_GROUP_ACTIVE_EVENT = 'slideOverlayGroupActive';
export interface SlideOverlayGroupActiveDetail {
  active: boolean;
}

export interface SlideToGroupDetail {
  /** Canonical destination href, e.g. `/g/abc?p=xyz`. */
  href: string;
  /** Slide direction. `forward` enters from the right (translateX(100%) → 0);
   *  `back` enters from the left (translateX(-100%) → 0). */
  direction: 'forward' | 'back';
  /** When true, the host calls `router.back()` instead of `router.push(href)`
   *  to advance the URL. Used by in-app back navs that have a real history
   *  entry to pop, so the existing history stack isn't extended pointlessly. */
  useHistoryBack?: boolean;
  /** Discriminated union of the destination's page kind + payload. The
   *  overlay renders the matching prop-driven view component. */
  kind: SlideOverlayKind;
  /** Visual scroll offset (in pixels) to apply to the destination's cards
   *  wrapper via CSS transform while the slide plays. Used by
   *  group-kind slides (`slideToGroup` / `slideToGroupRoot`) so the
   *  overlay shows the user's saved scroll position throughout the
   *  animation rather than the top of the list with a snap to the
   *  restored `window.scrollY` on unmount. Only the cards wrapper
   *  transforms — the fixed GroupHeader stays at viewport top
   *  naturally (sidesteps the WebKit contain:strict +
   *  position-fixed-scrolls-with-content interaction). */
  overlayCardsOffset?: number;
  /** Follow-up slide to play once THIS slide has landed (URL flipped +
   *  slide duration elapsed). The overlay host dispatches it from its
   *  unmount timer's url-matched branch — never from the safety-timeout
   *  branch — so the chain is sequenced on the real router commit instead
   *  of a caller-side duration guess. Used by the solo-group "Add People"
   *  CTA to play group → /info → /invite-members so the back chain matches
   *  the manual path (invite-members' back returns to /info). */
  chainTo?: SlideToGroupDetail;
}

/** Fired by GroupContent when a swipe-back gesture is recognized AND when it
 *  commits to navigation. The host (HomeBackdropHost in app/layout.tsx)
 *  mounts a body-level portal showing home's chrome + cached GroupList,
 *  positioned identically to the real home route. It persists across the
 *  router.push commit so there's no blank frame between the swipe wrapper
 *  unmounting and home rendering. */
export const SHOW_HOME_BACKDROP_EVENT = 'home-backdrop:show';

/** Fired by snap-back / cancel paths in GroupContent AND by the home page's
 *  mount effect (so the backdrop dismisses itself once home has rendered
 *  through it). */
export const HIDE_HOME_BACKDROP_EVENT = 'home-backdrop:hide';

/** Fired by PollDetail's swipe-back gesture when motion is recognized AND
 *  when it commits to navigation. GroupBackdropHost (in app/layout.tsx)
 *  mounts a body-level portal showing the cached group page underneath the
 *  poll detail page. Mirrors the home-backdrop architecture but for the
 *  poll→group transition instead of group→home. */
export const SHOW_GROUP_BACKDROP_EVENT = 'group-backdrop:show';
export interface GroupBackdropShowDetail {
  groupId: string;
}

/** Fired by snap-back / cancel paths in PollDetail AND by GroupPageInner's
 *  mount effect (so the backdrop dismisses itself once the real group page
 *  has rendered through it). */
export const HIDE_GROUP_BACKDROP_EVENT = 'group-backdrop:hide';
