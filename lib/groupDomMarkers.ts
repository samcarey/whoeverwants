/**
 * DOM markers shared between the group page (writer) and the
 * create-poll component (reader). Hardcoding these strings at each
 * call site invites typos that silently break the integration —
 * keep them centralized.
 */

/** `<body data-group-id="...">` is set by the group page on mount
 *  with the current group's uuid. The in-card form in CreateQuestionContent
 *  reads it to attach a new poll to the group (passes through as
 *  `req.group_id` to `apiCreatePoll`). Migration 105 retired the
 *  per-question follow-up chain; the group is now the addressable unit. */
export const GROUP_ID_ATTR = 'data-group-id';

/** Portal target rendered by the group page (and the empty `/g/`
 *  placeholder) where CreateQuestionContent portals the always-on
 *  draft poll card. */
export const DRAFT_POLL_PORTAL_ID = 'draft-poll-portal';

/** Marker attribute on the fixed-position group header. Used by code
 *  that needs to scroll to a position just below the header (e.g.
 *  scrolling a newly-inserted draft card to the top of the visible area)
 *  without re-implementing the header-height measurement here. */
export const GROUP_HEADER_ATTR = 'data-group-header';
