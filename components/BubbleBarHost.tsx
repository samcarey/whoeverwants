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
import { useEffect, useState } from "react";
import BubbleBarPanel from "./BubbleBarPanel";
import { useIsSlideOverlayGroupActive } from "@/lib/slideOverlay";
import { isGroupRootView } from "@/lib/questionId";
import {
  HIDE_HOME_BACKDROP_EVENT,
  SHOW_HOME_BACKDROP_EVENT,
} from "@/lib/eventChannels";

export default function BubbleBarHost(): React.ReactElement | null {
  const pathname = usePathname();
  const slideActive = useIsSlideOverlayGroupActive();
  // While the group→home swipe-back backdrop is showing, the group route is
  // still the current path (until the gesture commits), so isGroupRootView
  // would keep the bar on — floating it over the revealed home page. Track
  // the backdrop and hide the bar for the duration of that gesture.
  const [homeBackdrop, setHomeBackdrop] = useState(false);
  useEffect(() => {
    const on = () => setHomeBackdrop(true);
    const off = () => setHomeBackdrop(false);
    window.addEventListener(SHOW_HOME_BACKDROP_EVENT, on);
    window.addEventListener(HIDE_HOME_BACKDROP_EVENT, off);
    return () => {
      window.removeEventListener(SHOW_HOME_BACKDROP_EVENT, on);
      window.removeEventListener(HIDE_HOME_BACKDROP_EVENT, off);
    };
  }, []);

  const onGroupRoute = isGroupRootView(pathname || "");
  const show = (onGroupRoute || slideActive) && !homeBackdrop;
  if (!show) return null;
  return <BubbleBarPanel elevated={slideActive} />;
}
