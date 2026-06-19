/**
 * DOM markers shared between the group/explore pages (writers) and the
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

/** `<body data-explore="1">` is set by the /explore page on mount. The
 *  create-poll component reads it to (a) flag the create request as an
 *  explore poll (`req.explore = true`, server files it into the per-user
 *  explore group), and (b) source the "recent polls" suggestion rows from
 *  the explore cache instead of the home/group accessible cache — keeping
 *  explore polls and group polls out of each other's suggestions. */
export const EXPLORE_ATTR = 'data-explore';

/** Marker attribute on the fixed-position group header. Used by code
 *  that needs to scroll to a position just below the header (e.g.
 *  scrolling a newly-inserted draft card to the top of the visible area)
 *  without re-implementing the header-height measurement here. */
export const GROUP_HEADER_ATTR = 'data-group-header';

/** Portal target for the "+ Poll" FAB. Rendered by each GroupContent /
 *  EmptyPlaceholder instance (real route, slide overlay, swipe-back
 *  backdrop) as a body-level-style bottom-anchored fixed div that's a
 *  SIBLING of the swipe wrapper (NOT inside it — the wrapper's
 *  `will-change: transform` would make a fixed FAB resolve to the tall
 *  scrolling wrapper instead of the viewport, so it'd scroll away). The
 *  layout-level CreateQuestionContent portals the FAB into every instance
 *  of this target, so the button rides the page's slide/swipe/reveal
 *  transforms exactly like the fixed GroupHeader does — instead of being a
 *  static body-level element that can only pop in/out. */
export const GROUP_FAB_PORTAL_ID = 'group-fab-portal';
