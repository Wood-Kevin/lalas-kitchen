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
  // A color bomb is colorless (no matchType), so it can't derive a sprite from
  // one like every other piece. It resolves to a single fixed 'color_bomb'
  // filename instead — an engine piece-type, not a skin flavor name, so the
  // leak test holds exactly as it does for the 'striped' branch below. With no
  // registry entry yet it falls through to resolveSpriteAsset's text-label
  // placeholder ("CO"), same graceful fallback every un-arted piece gets;
  // dropping in real art is one spriteRegistry.ts line, zero code changes.
  if (piece.type === 'color_bomb') return 'color_bomb';
  // An area bomb, like a color bomb, renders as a SINGLE fixed sprite rather than
  // a per-type variant: the skin ships one `area_bomb.webp` (the bomb wrap looks
  // the same whatever it wraps), so this resolves to that one filename. The area
  // bomb is now colorless (it dropped its matchType in the passive->active
  // reversal — see matrix.ts's Piece comment and engine/DECISIONS.md), so, just
  // like the color bomb, there's no matchType to derive a per-type sprite from
  // anyway; the fixed sprite is exactly what a colorless piece needs. This is
  // precisely why the reversal needed zero rendering changes. Unlike
  // color_bomb's extensionless key, this keys by the real filename like every
  // other entry. With no registry entry it falls through to resolveSpriteAsset's
  // text-label placeholder ("AR"), the same graceful fallback every un-arted
  // piece gets.
  if (piece.type === 'area_bomb') return 'area_bomb.webp';
  // A dropdown (escort) piece is colorless too (see matrix.ts's Piece
  // comment) — same single-fixed-sprite shape as area_bomb, since there's
  // no matchType to derive a per-type variant from. With no registry entry
  // it falls through to resolveSpriteAsset's text-label placeholder ("DR"),
  // the same graceful fallback every un-arted piece gets.
  if (piece.type === 'dropdown') return 'dropdown.webp';
  const base = getSpriteForMatchType(piece.matchType, config);
  if (piece.type === 'striped' && base !== undefined) return `striped_${base}`;
  return base;
}
