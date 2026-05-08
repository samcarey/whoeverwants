/**
 * DOM markers shared between the thread page (writer) and the
 * create-poll component (reader). Hardcoding these strings at each
 * call site invites typos that silently break the integration —
 * keep them centralized.
 */

/** `<body data-thread-id="...">` is set by the thread page on mount
 *  with the current thread's uuid. The in-card form in CreateQuestionContent
 *  reads it to attach a new poll to the thread (passes through as
 *  `req.thread_id` to `apiCreatePoll`). Migration 105 retired the
 *  per-question follow-up chain; the thread is now the addressable unit. */
export const THREAD_ID_ATTR = 'data-thread-id';

/** Portal target rendered by the thread page (and the empty `/t/`
 *  placeholder) where CreateQuestionContent portals the always-on
 *  draft poll card. */
export const DRAFT_POLL_PORTAL_ID = 'draft-poll-portal';

/** Marker attribute on the fixed-position thread header. Used by code
 *  that needs to scroll to a position just below the header (e.g.
 *  scrolling a newly-inserted draft card to the top of the visible area)
 *  without re-implementing the header-height measurement here. */
export const THREAD_HEADER_ATTR = 'data-thread-header';
