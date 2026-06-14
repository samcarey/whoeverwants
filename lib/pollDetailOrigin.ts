/**
 * Tracks which poll-detail pages were opened FROM /explore (vs the group
 * page), so their back button + swipe-back return to /explore — with the
 * explore feed as the swipe backdrop — instead of the explore group's root
 * page. Set by the explore feed card before sliding to the detail page; read
 * by PollDetailView.
 *
 * Module-level (mirrors lib/scrollMemory + questionBackTarget): the slide is a
 * client-side navigation, so the marker survives until the next page load.
 * Bounded LRU so a long session can't grow it unbounded.
 */

const EXPLORE_ORIGINS = new Set<string>();
const MAX_ORIGINS = 50;

export function markPollDetailFromExplore(pollShortId: string): void {
  if (!pollShortId) return;
  // Re-insert to refresh LRU recency.
  EXPLORE_ORIGINS.delete(pollShortId);
  EXPLORE_ORIGINS.add(pollShortId);
  while (EXPLORE_ORIGINS.size > MAX_ORIGINS) {
    const oldest = EXPLORE_ORIGINS.values().next().value;
    if (oldest === undefined) break;
    EXPLORE_ORIGINS.delete(oldest);
  }
}

export function isPollDetailFromExplore(pollShortId: string): boolean {
  return EXPLORE_ORIGINS.has(pollShortId);
}
