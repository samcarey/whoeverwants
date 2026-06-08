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
 *  create-poll search bar. Rendered INSIDE the page content (GroupContent /
 *  EmptyPlaceholder) — not at the layout level — so the fixed bar inherits
 *  the page's transform during a slide overlay (it's inside the overlay's
 *  `contain: strict` box) and the swipe-back backdrop's containing block,
 *  making it slide / be-revealed WITH the page exactly like the fixed
 *  GroupHeader. */
export const DRAFT_POLL_PORTAL_ID = 'draft-poll-portal';

/** CSS variable on `<html>` holding the create-poll search bar's measured
 *  height, so the group page can reserve matching bottom padding (its last
 *  poll card clears the floating pill). Written by CreateQuestionContent
 *  (which renders + measures the bar). A `:root` default in globals.css
 *  covers the first paint before the bar mounts + measures. */
export const PANEL_HEIGHT_VAR = '--bubble-bar-panel-height';

/** Marker attribute on the fixed-position group header. Used by code
 *  that needs to scroll to a position just below the header (e.g.
 *  scrolling a newly-inserted draft card to the top of the visible area)
 *  without re-implementing the header-height measurement here. */
export const GROUP_HEADER_ATTR = 'data-group-header';
