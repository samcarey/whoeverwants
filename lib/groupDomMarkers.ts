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

/** `<body data-explore="1">` is set by the /explore page on mount. The
 *  create-poll component reads it to (a) flag the create request as an
 *  explore poll (`req.explore = true`, server files it into the per-user
 *  explore group), and (b) source the "recent polls" suggestion rows from
 *  the explore cache instead of the home/group accessible cache — keeping
 *  explore polls and group polls out of each other's suggestions. */
export const EXPLORE_ATTR = 'data-explore';

/** Portal target rendered by the group page (and the empty `/g/`
 *  placeholder) where CreateQuestionContent portals the always-on
 *  create-poll search bar. Rendered INSIDE the page content (GroupContent /
 *  EmptyPlaceholder) — not at the layout level — so the fixed bar inherits
 *  the page's transform during a slide overlay (it's inside the overlay's
 *  `contain: strict` box) and the swipe-back backdrop's containing block,
 *  making it slide / be-revealed WITH the page exactly like the fixed
 *  GroupHeader. */
export const DRAFT_POLL_PORTAL_ID = 'draft-poll-portal';

/** Marker attribute on the fixed-position group header. Used by code
 *  that needs to scroll to a position just below the header (e.g.
 *  scrolling a newly-inserted draft card to the top of the visible area)
 *  without re-implementing the header-height measurement here. */
export const GROUP_HEADER_ATTR = 'data-group-header';

/** Marker attribute on each host's scrollable page-content wrapper (the
 *  group swipe wrapper, the explore feed wrapper, and the empty `/g/`
 *  placeholder's portal div). When the create-poll search box is focused,
 *  its focus effect translates every `[POLL_PAGE_SCROLL_ATTR]` element up
 *  together with the fixed top-bar chrome, so the whole page slides up
 *  rigidly to bring the box to the top. Reader: create-poll's focus effect. */
export const POLL_PAGE_SCROLL_ATTR = 'data-poll-page-scroll';
