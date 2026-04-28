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

// (Form-modal lifecycle events were retired when the docked bottom panel was
//  replaced by a true blocking modal owned by CreateQuestionContent. The
//  modal is now URL-driven via `?create=1` so no cross-component event
//  signaling is needed for it.)

import type { Poll } from "@/lib/types";

/** Fired by CreateQuestionContent immediately on Submit (BEFORE the API call
 *  resolves). Carries a placeholder Poll built from the draft state plus the
 *  bounding box of the unmounting draft card. ThreadContent listens, inserts
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
 *  id it was inserted with so ThreadContent can swap its fields in-place. */
export const POLL_HYDRATED_EVENT = 'pollHydrated';
export interface PollHydratedDetail {
  placeholderId: string;
  poll: Poll;
}
