/**
 * Copy text to the clipboard with a layered fallback. Returns true on
 * success, false if every path failed.
 *
 * Layers:
 *   1. `navigator.clipboard.writeText` — modern, requires secure context.
 *   2. `document.execCommand('copy')` via a hidden textarea — works on
 *      older browsers and non-secure contexts (HTTP dev pages, ngrok
 *      tunnels, localhost-without-HTTPS-on-mobile).
 *
 * Callers handle the failure case themselves (e.g. `prompt()` for manual
 * copy, or surfacing an error toast). We don't `alert()` from here so the
 * helper stays UI-neutral.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof window !== "undefined" && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback.
    }
  }
  if (typeof document === "undefined") return false;
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  try {
    textArea.focus();
    textArea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

/**
 * Best-effort clipboard write fed by a promise. MUST be called synchronously
 * inside a tap/click handler: iOS Safari rejects async clipboard writes
 * outside the user-activation window, but `ClipboardItem` accepts
 * promise-valued entries for exactly this async-data-in-gesture case — the
 * write is REGISTERED in the gesture and the browser fills in the text when
 * the promise resolves. Falls back to awaiting the text and running it
 * through `copyTextToClipboard`'s layered fallback (fine on engines that
 * don't gate on activation). Resolves true when the text landed on the
 * clipboard; never rejects (a rejected `textPromise` resolves false).
 */
export function copyTextFromPromise(
  textPromise: Promise<string>,
): Promise<boolean> {
  const fallback = async (): Promise<boolean> => {
    try {
      return await copyTextToClipboard(await textPromise);
    } catch {
      return false;
    }
  };
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        "text/plain": textPromise.then(
          (text) => new Blob([text], { type: "text/plain" }),
        ),
      });
      // A rejected write (no permission, or the text promise itself failed)
      // falls through to the awaited fallback, which either succeeds or
      // resolves false.
      return navigator.clipboard.write([item]).then(() => true, fallback);
    }
  } catch {
    // ClipboardItem constructor rejected the promise-valued entry shape
    // (older engines) — fall through.
  }
  return fallback();
}
