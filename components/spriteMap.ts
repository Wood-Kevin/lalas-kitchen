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
