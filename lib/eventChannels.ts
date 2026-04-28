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

/** Fired by CreateQuestionContent immediately after `apiCreatePoll` succeeds.
 *  Listened to by ThreadContent so a freshly-submitted poll appears inline
 *  in the current thread without a route change / re-fetch. The poll is
 *  already cached + appended to `getCachedAccessiblePolls()` by the
 *  dispatcher, so listeners can rebuild state from the cache directly. */
export const POLL_CREATED_EVENT = 'pollCreated';
export interface PollCreatedDetail {
  poll: Poll;
}
