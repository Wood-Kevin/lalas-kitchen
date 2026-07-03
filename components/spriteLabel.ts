// Turns a sprite filename into a short placeholder label — a generic
// string transform, not a per-piece-name mapping (e.g. no "tomato" -> 🍅
// table). No real sprite art exists yet (skins/lalas-kitchen/sprites/ is
// still empty), so this is what actually renders on a tile today. See
// components/NOTES.md for the plan once real art lands, and why a
// hardcoded name->emoji table would fail the leak test the same way a
// literal "tomato" string in Board.tsx would.
export function spriteLabel(spritePath: string | undefined): string {
  if (!spritePath) return '?';
  const base = spritePath.replace(/\.[^/.]+$/, '');
  return base.slice(0, 2).toUpperCase();
}
