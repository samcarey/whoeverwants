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
 * Focus a form control. For empty text inputs/textareas, leaves a one-shot
 * marker so the consumer can apply first-character auto-capitalization.
 *
 * iOS only re-evaluates the soft keyboard's auto-capitalization shift state
 * when a field is focused by a tap — not when focus moves programmatically
 * (Enter-to-advance). So the keyboard carries the prior field's lowercase
 * state and the first character of the next option/suggestion arrives
 * lowercase. We can't force iOS to recompute it, so consumers capitalize the
 * first character themselves when this marker is present.
 */
function focusFormControl(el: HTMLElement): void {
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    el.value === ''
  ) {
    el.dataset.autocapOnAdvance = '1';
  }
  el.focus();
}

/**
 * One-shot check: returns true (and clears the marker) when `el` was just
 * programmatically advanced into via {@link advanceFormFocus} and should
 * auto-capitalize its first character. Returns false otherwise.
 */
export function consumeAdvanceAutocap(
  el: HTMLInputElement | HTMLTextAreaElement | null | undefined,
): boolean {
  if (!el || el.dataset.autocapOnAdvance !== '1') return false;
  delete el.dataset.autocapOnAdvance;
  return true;
}

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
  focusFormControl(visible[idx + 1]);
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
