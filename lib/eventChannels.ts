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
 *  resolves). Carries a placeholder Poll built from the draft state plus the
 *  bounding box of the unmounting draft card. GroupContent listens, inserts
 *  the placeholder into its poll list, and FLIP-animates the new card from
 *  the captured bbox to its natural collapsed-card position over 1s.
 *  The real apiCreatePoll continues in parallel; on success it fires
 *  `POLL_HYDRATED_EVENT` with the real Poll keyed by the placeholder id. */
export const POLL_PENDING_EVENT = 'pollPending';
export interface PollPendingDetail {
  poll: Poll;
  fromBbox: { x: number; y: number; width: number; height: number };
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
  // Per-poll detail page. Tapping a card on /g/<group> slides to
  // /g/<group>/p/<pollShortId>, which renders the poll's full content
  // (results, ballots, voter list) without card chrome.
  | { type: 'pollDetail'; groupId: string; pollShortId: string }
  // Per-poll info page at /g/<group>/p/<pollShortId>/info. Hosts the
  // poll-level actions (forget / reopen / close / cutoff) and the full
  // respondent list. Tapping the title on the poll detail page slides here.
  | { type: 'pollInfo'; groupId: string; pollShortId: string }
  // Empty "New Group" placeholder, used by the home "+" FAB. The overlay
  // renders the same content as `/g/`'s EmptyPlaceholder; the actual group
  // is created via `apiCreateGroup` in parallel, and the caller fires
  // `router.push('/g/<short_id>')` once it resolves (or `/g` on failure).
  // The host skips its automatic `router.push(href)` for this kind so the
  // caller owns the navigation.
  | { type: 'newGroup' };

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
}
