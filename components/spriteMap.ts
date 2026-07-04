import { SkinConfig } from './skinConfig';

// Looks up a piece's display sprite from config data — never a hardcoded
// switch/if-else over literal piece names. matchType is the engine's
// abstract id (e.g. "tomato"); this is the one place that's allowed to
// treat it as meaningful, and even then only as a lookup key, never a
// literal compared by name.
export function getSpriteForMatchType(
  matchType: string | undefined,
  config: SkinConfig
): string | undefined {
  if (matchType === undefined) return undefined;
  const pieceType = config.pieceTypes.find((p) => p.id === matchType);
  if (pieceType) return pieceType.sprite;
  const blocker = config.blockers.find((b) => b.id === matchType);
  return blocker?.sprite;
}

// The sprite filename for a whole piece, accounting for its type. A striped
// piece (engine type 'striped') resolves to `striped_<its base sprite>` —
// e.g. tomato's "tomato.webp" becomes "striped_tomato.webp" — so dedicated
// striped art is just another registry entry keyed by that derived filename
// (see skins/lalas-kitchen/spriteRegistry.ts). A type without striped art
// yet produces a filename that isn't in the registry, so resolveSpriteAsset
// falls back to the same text-label placeholder any un-arted sprite uses —
// no crash, no blank, no special casing. Derives the prefix from the base
// filename config already provides rather than the raw matchType id, so no
// literal piece name ("tomato") ever appears here (the leak test). Every
// non-tile sprite lookup (HUD objective icons, etc.) still uses
// getSpriteForMatchType directly — only the board's live tiles are striped.
export function getSpriteForPiece(
  piece: { type: string; matchType?: string },
  config: SkinConfig
): string | undefined {
  const base = getSpriteForMatchType(piece.matchType, config);
  if (piece.type === 'striped' && base !== undefined) return `striped_${base}`;
  return base;
}
