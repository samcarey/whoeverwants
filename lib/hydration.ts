/**
 * "Has the app finished its initial hydration?" — a module-level flag set by
 * the template's mount effect (which runs after the hydration commit on the
 * very first page, long before any client-side navigation can mount another
 * page).
 *
 * Why it exists: pages whose settled content lives in localStorage (e.g.
 * /settings — name, theme, cached session) want to SEED that state in their
 * `useState` lazy initializers so a client-side navigation paints the settled
 * UI on the first commit (no effect-pass flicker — critical for swipe-back
 * handoffs, where the destination mounts over an already-settled backdrop).
 * But eager seeding breaks HYDRATION on a direct load: the server HTML was
 * rendered with the empty defaults, and a client initializer that reads
 * localStorage diverges from it. This flag splits the two cases: false during
 * the initial hydration render (seed with SSR-parity defaults, let effects
 * populate), true for every later mount (seed eagerly).
 */

let hydrated = false;

/** Called once from the template's mount effect. Idempotent. */
export function markAppHydrated(): void {
  hydrated = true;
}

/** True on any render that happens after the app's initial hydration —
 *  i.e. it's safe to seed `useState` initializers from localStorage
 *  without diverging from server-rendered HTML. */
export function isAppHydrated(): boolean {
  return hydrated;
}
