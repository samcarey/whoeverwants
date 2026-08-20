/**
 * The three glyphs in the home page's title row: the settings gear (upper
 * left), the groups button (upper right), and the experimental explore globe
 * (left of groups, flag-gated).
 *
 * They live here because each is rendered TWICE — once as a real button in
 * app/template.tsx, and once as an inert mirror in HomeBackdropHost (the
 * snapshot revealed during a swipe-back to home). The mirror has to be
 * pixel-identical or the handoff on commit shows a visible swap, so the two
 * copies share one source rather than being kept in sync by hand.
 *
 * Only the SVG is shared — the surrounding button/span chrome differs
 * (interactive vs decorative) and stays at each call site.
 */

const ICON_CLASS = "w-6 h-6 text-gray-400 dark:text-gray-500";

export function GearIcon() {
  return (
    <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/** Opens /groups — the mirror of the settings gear at the other end of the
 *  title row. A "people" glyph, matching the gear's stroke weight. */
export function GroupsIcon() {
  return (
    <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

export function GlobeIcon() {
  return (
    <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"
      />
    </svg>
  );
}

/** Shared slot chrome for the title row's corner buttons — the real ones add
 *  hover/active classes on top. */
export const HOME_CHROME_SLOT_CLASS =
  "absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full";

/** Right-edge offset for the groups button, and (when the explore flag is on)
 *  the globe sitting one slot further left. */
export const GROUPS_BUTTON_RIGHT = "max(0.25rem, env(safe-area-inset-right, 0px))";
export const EXPLORE_BUTTON_RIGHT = "calc(max(0.25rem, env(safe-area-inset-right, 0px)) + 2.5rem)";
