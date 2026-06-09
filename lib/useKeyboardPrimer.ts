import { useCallback, useRef } from 'react';

/**
 * iOS soft-keyboard primer for inputs that mount ASYNCHRONOUSLY in response to
 * a tap (e.g. an input inside a modal/overlay that React commits a tick later).
 *
 * iOS WebKit only raises the soft keyboard when `focus()` runs synchronously
 * inside the tap's user-activation window. An input that mounts on a later
 * commit gets the caret but the keyboard stays down. The fix: synchronously
 * focus a throwaway off-screen `<input>` DURING the tap (`prime()`), claiming
 * the keyboard; once the real input mounts, the `focusOnMount` callback ref
 * transfers focus to it and iOS keeps the keyboard up across the move.
 *
 * Usage:
 *   const { prime, focusOnMount, cancel } = useKeyboardPrimer();
 *   // in the tap handler, synchronously:
 *   prime(); setOverlayOpen(true);
 *   // on the real input:
 *   <input ref={focusOnMount} ... />
 *
 * Mirrors the inline title-input primer in `app/create-poll/page.tsx`.
 */
export function useKeyboardPrimer(options?: { selectOnFocus?: boolean }) {
  const selectOnFocus = options?.selectOnFocus ?? false;
  const primerRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusRef = useRef(false);

  const removePrimer = useCallback(() => {
    const el = primerRef.current;
    if (el) {
      primerRef.current = null;
      el.remove();
    }
  }, []);

  // Must be called within the tap handler's synchronous call stack.
  const prime = useCallback(() => {
    if (typeof document === 'undefined') return;
    removePrimer();
    shouldFocusRef.current = true;
    const tmp = document.createElement('input');
    tmp.type = 'text';
    tmp.setAttribute('aria-hidden', 'true');
    tmp.tabIndex = -1;
    // 16px font-size avoids iOS focus-zoom; opacity 0 + 1px keeps it invisible.
    tmp.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;margin:0;background:transparent;';
    document.body.appendChild(tmp);
    tmp.focus({ preventScroll: true });
    primerRef.current = tmp;
    // Safety net in case the real input never claims focus.
    window.setTimeout(removePrimer, 1500);
  }, [removePrimer]);

  // Callback ref for the real input: transfers focus + tears down the primer
  // exactly when the node attaches (whenever that commit lands).
  const focusOnMount = useCallback(
    (node: HTMLInputElement | null) => {
      if (node && shouldFocusRef.current) {
        shouldFocusRef.current = false;
        node.focus({ preventScroll: true });
        if (selectOnFocus) node.select();
        removePrimer();
      }
    },
    [removePrimer, selectOnFocus],
  );

  // Abort a primed-but-not-yet-consumed transfer (e.g. the overlay closed
  // before the real input mounted).
  const cancel = useCallback(() => {
    shouldFocusRef.current = false;
    removePrimer();
  }, [removePrimer]);

  return { prime, focusOnMount, cancel };
}
