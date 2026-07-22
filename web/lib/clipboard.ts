/**
 * Clipboard write with fallback for older browsers / non-secure contexts.
 * navigator.clipboard requires a secure context (HTTPS or localhost).
 * Falls back to execCommand("copy") on a temporary textarea.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern API — secure contexts only
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy
    }
  }

  // Legacy fallback — works in non-secure contexts
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }

  return false;
}
