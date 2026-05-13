// Helpers for treating Enter on a single-line field like Tab.
//
// Native browser behavior: pressing Enter in a single-line <input> inside a
// <form> submits the form. The create-poll form's two <form> elements
// preventDefault() on submit, so Enter is effectively a no-op there. Users
// (especially on hardware keyboards) expect Enter to advance to the next
// field instead — same as Tab. These helpers implement that.

const FOCUSABLE_SELECTOR = [
  'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
].join(', ');

/**
 * Move focus to the next focusable form control after `current` in document
 * order. Returns true when focus moved. Skips elements not currently visible
 * (display:none / hidden), so collapsed sections don't trap focus.
 */
export function advanceFormFocus(current: HTMLElement): boolean {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  const visible = all.filter((el) => el === current || el.offsetParent !== null);
  const idx = visible.indexOf(current);
  if (idx === -1 || idx >= visible.length - 1) return false;
  visible[idx + 1].focus();
  return true;
}

/**
 * Convenience onKeyDown handler. Intercepts Enter, prevents the default form
 * submission, and advances to the next focusable field. Use directly as
 * `onKeyDown={enterAdvancesFocus}`.
 */
export function enterAdvancesFocus(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  advanceFormFocus(e.currentTarget);
}
