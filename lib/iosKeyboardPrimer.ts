/**
 * Module-level iOS soft-keyboard primer for the cross-navigation case.
 *
 * iOS WebKit only raises the soft keyboard when `focus()` runs synchronously
 * inside the tap's user-activation window. When a tap opens a surface whose input
 * mounts much later (e.g. the floating "Poll" button → the create-poll composer
 * sheet's search box, which mounts inside ModalPortal's deferred commit and
 * auto-focuses via a callback ref), the tap-handler component and the focus-target
 * component are different React trees, so the hook-based `useKeyboardPrimer` can't
 * bridge them.
 *
 * This module keeps a single off-screen `<input>` at module scope: the tap
 * handler calls `primeIosKeyboard()` synchronously (claiming the keyboard), and
 * whoever later focuses the real input calls `releaseIosKeyboardPrimer()` to tear
 * the throwaway down — iOS keeps the keyboard up across the transfer.
 *
 * Best-effort + device-only-verifiable: if the transfer window is too long for a
 * given iOS version the keyboard simply stays down (the box is still
 * caret-focused), which degrades gracefully to "tap to type".
 *
 * Mirrors `lib/useKeyboardPrimer.ts` (the in-tree, same-component variant).
 */

let primer: HTMLInputElement | null = null;
let safetyTimer = 0;

/** Synchronously focus a throwaway off-screen input. Call inside the tap. */
export function primeIosKeyboard(): void {
  if (typeof document === "undefined") return;
  releaseIosKeyboardPrimer();
  const el = document.createElement("input");
  el.type = "text";
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  // 16px font-size avoids iOS focus-zoom; opacity 0 + 1px keeps it invisible.
  el.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;margin:0;background:transparent;";
  document.body.appendChild(el);
  el.focus({ preventScroll: true });
  primer = el;
  // Safety net in case the real input never claims focus (1.5s outlasts the
  // slide + auto-focus delay; tuned to match useKeyboardPrimer).
  safetyTimer = window.setTimeout(releaseIosKeyboardPrimer, 1500);
}

/** Remove the throwaway input. Call right after focusing the real input. */
export function releaseIosKeyboardPrimer(): void {
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = 0;
  }
  if (primer) {
    const el = primer;
    primer = null;
    el.remove();
  }
}
