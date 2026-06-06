"use client";

/**
 * Single, persistent home for the create-poll bubble bar.
 *
 * Previously the bar lived inside `GroupContent` (and `EmptyPlaceholder`),
 * which caused two problems on the poll→group back slide:
 *   1. It was rendered in BOTH the slide overlay's GroupContent and the real
 *      route's, so the two copies met at the slide seam with mismatched
 *      horizontal content — a jumbled / doubled bar (confirmed on prod: 14
 *      bar buttons visible mid-slide instead of 7).
 *   2. When rendered only in the real route (to kill the doubling), the bar
 *      had to wait for the heavy GroupContent to commit — ~1–3.5s on the
 *      slow dev server — before it appeared.
 *
 * Mounting the bar ONCE at the layout level fixes both: a single instance
 * (no doubling) that is NOT gated on the heavy group-page render, so it
 * appears the instant a group-kind slide starts (the host is lightweight).
 *
 * Visibility: shown whenever the current route is a group-root view OR a
 * group-kind slide overlay is mounted (so it's already on-screen the moment
 * a back-to-group / home-to-group slide begins). Elevated above the slide
 * overlay (z-70) during a group-kind slide so it reads as stable bottom
 * chrome the sliding group content passes behind. Hidden while the
 * group→home swipe-back backdrop is active so a bubble bar never floats over
 * the revealed home page.
 *
 * The bar's BUTTONS are still owned + portaled in by `CreateQuestionContent`
 * (`PersistentCreatePollHost`); this host only provides the chrome + the
 * `#draft-poll-portal` target + the scroll-hide behavior. Both are
 * layout-level and persistent, so there is no portal-target swap and no
 * unmount blink.
 */

import { usePathname } from "next/navigation";
import BubbleBarPanel from "./BubbleBarPanel";
import { useIsSlideOverlayGroupActive } from "@/lib/slideOverlay";
import { isGroupRootView } from "@/lib/questionId";
import { useHomeBackdropActive } from "@/lib/useHomeBackdropActive";
import { useGroupAccessGranted } from "@/lib/groupAccessState";

export default function BubbleBarHost(): React.ReactElement | null {
  const pathname = usePathname();
  const slideActive = useIsSlideOverlayGroupActive();
  // While the group→home swipe-back backdrop is showing, the group route is
  // still the current path (until the gesture commits), so isGroupRootView
  // would keep the bar on — floating it over the revealed home page. Track
  // the backdrop and hide the bar for the duration of that gesture.
  const homeBackdrop = useHomeBackdropActive();

  // A specific group page is `/g/<routeId>`; the empty-group placeholder is
  // bare `/g` or `/g/` (no id). Extract the id so we can gate a real group's
  // bar on the viewer actually having access (a non-member must not be shown
  // the create-poll bar over the "Private Group / no access" wall). The
  // placeholder (no id) is always allowed — that's where you start a new group.
  const idMatch = (pathname || "").match(/^\/g\/([^/]+)\/?$/);
  const pathRouteId = idMatch ? decodeURIComponent(idMatch[1]) : null;
  const accessGranted = useGroupAccessGranted(pathRouteId);

  // Withhold the bar entirely while a group-arrival slide is in flight, then
  // mount it once the slide overlay has unmounted (slideActive flips false on
  // the settled group route). BubbleBarPanel starts hidden and slides up on
  // mount, so the sequence the user sees is: page transition plays with NO
  // bar, then — once we're settled on the group page — the bar slides up from
  // the bottom. This sidesteps the slide-seam doubling/flicker entirely
  // (the bar is simply never present during the transition).
  //
  // On a direct group-page load (no slide) slideActive is already false, so
  // the bar mounts and slides up immediately — matching "every time we load
  // the group page, animate the bar sliding up".
  const onGroupRoute = isGroupRootView(pathname || "");
  // For a specific group (`/g/<id>`) require confirmed access; the bare
  // placeholder (pathRouteId === null) is always allowed.
  const accessOk = pathRouteId === null || accessGranted;
  const show = onGroupRoute && accessOk && !slideActive && !homeBackdrop;
  if (!show) return null;
  return <BubbleBarPanel />;
}
