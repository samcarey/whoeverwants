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
 * Focus a form control. For text inputs/textareas, works around an iOS quirk:
 * when focus moves programmatically (not via a tap), the soft keyboard keeps
 * the previous field's auto-capitalization shift state instead of recomputing
 * it for the newly-focused (empty) field. Changing the `autocapitalize`
 * attribute while the field is focused forces WebKit to recompute, so the
 * first character of the next option/suggestion capitalizes like a tap does.
 */
function focusFormControl(el: HTMLElement): void {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    el.focus();
    return;
  }
  const desired = el.getAttribute('autocapitalize') ?? 'sentences';
  if (desired === 'off' || desired === 'none') {
    el.focus();
    return;
  }
  el.setAttribute('autocapitalize', 'none');
  el.focus();
  el.setAttribute('autocapitalize', desired);
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
