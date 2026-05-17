/**
 * TEMPORARY diagnostic harness for the iOS Firefox "top bar mid-way down,
 * jumps to top" bug on group-page slide-in / refresh.
 *
 * REMOVE this file and its callers once the bug is diagnosed.
 *
 * Samples layout / scroll / header state every rAF + every 50ms + on every
 * window.scroll and visualViewport.scroll event for the first 1500ms after
 * mount. Each sample is emitted via console.warn so it forwards from canary
 * AND dev tiers (see CLAUDE.md "Client Log Forwarding"). Grep the buffer
 * with `?search=IOS-TOPBAR-JUMP`.
 *
 * Records BOTH headers when two are in the DOM simultaneously (during
 * slide handoff the overlay's `<GroupHeader>` and the real route's
 * `<GroupHeader>` coexist for ~30ms before the overlay unmounts). Tags each
 * header by whether it sits inside the overlay portal so we can separate
 * the two coordinate spaces.
 */

const TAG = "IOS-TOPBAR-JUMP";

export function instrumentTopbarJump(label: string): void {
  if (typeof window === "undefined") return;

  const startTime = performance.now();
  let cancelled = false;
  let rafId: number | null = null;
  let intervalId: number | null = null;

  const sample = (kind: string): void => {
    if (cancelled) return;
    const t = Math.round(performance.now() - startTime);
    const headers = Array.from(
      document.querySelectorAll<HTMLElement>("[data-group-header]"),
    );
    const headerData = headers.map((h) => {
      // Slide overlay div has aria-hidden="true" + position:fixed inline
      // style — `closest` matches it for overlay-mounted headers.
      const overlayAncestor = h.closest<HTMLElement>(
        'div[aria-hidden="true"]',
      );
      const inOverlay =
        !!overlayAncestor &&
        overlayAncestor.style.position === "fixed" &&
        overlayAncestor !== h;
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      return {
        overlay: inOverlay,
        top: Math.round(r.top * 100) / 100,
        h: Math.round(r.height * 100) / 100,
        st: h.style.transform || "(none)",
        ct: cs.transform === "none" ? "(none)" : cs.transform,
        pos: cs.position,
      };
    });
    const overlayEl = document.querySelector<HTMLElement>(
      'div[aria-hidden="true"][style*="contain"]',
    );
    const vv = window.visualViewport;
    const rec = {
      t,
      label,
      kind,
      sy: window.scrollY,
      ih: window.innerHeight,
      dsh: document.documentElement.scrollHeight,
      vvTop: vv?.offsetTop ?? null,
      vvH: vv?.height ?? null,
      oSt: overlayEl?.scrollTop ?? null,
      oSh: overlayEl?.scrollHeight ?? null,
      oCh: overlayEl?.clientHeight ?? null,
      headers: headerData,
    };
    // console.warn so it forwards from canary AND dev (CLAUDE.md
    // "Client Log Forwarding" — warn/error always forward).
    console.warn(`[${TAG}]`, JSON.stringify(rec));
  };

  sample("mount");

  const tick = (): void => {
    if (cancelled) return;
    sample("raf");
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  intervalId = window.setInterval(() => sample("50ms"), 50);

  const onVvScroll = (): void => sample("vv-scroll");
  const onWinScroll = (): void => sample("win-scroll");
  window.visualViewport?.addEventListener("scroll", onVvScroll);
  window.addEventListener("scroll", onWinScroll, { passive: true });

  window.setTimeout(() => {
    cancelled = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (intervalId !== null) clearInterval(intervalId);
    window.visualViewport?.removeEventListener("scroll", onVvScroll);
    window.removeEventListener("scroll", onWinScroll);
    sample("stop");
  }, 1500);
}
