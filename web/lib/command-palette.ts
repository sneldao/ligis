export const OPEN_PALETTE_EVENT = "ligis:open-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}
