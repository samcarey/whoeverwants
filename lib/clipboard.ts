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
