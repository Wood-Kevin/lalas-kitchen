import type { ImageSourcePropType } from 'react-native';
import { spriteLabel } from './spriteLabel';

// Maps a sprite filename exactly as it appears in a skin's config.json
// (e.g. "tomato.webp") to its bundled image module. Built per-skin via
// static require() calls — see skins/lalas-kitchen/spriteRegistry.ts for
// why this has to be a hand-maintained map rather than a runtime path
// lookup: Metro only resolves require() calls whose argument is a literal
// string, never one built from a config-driven variable.
export type SpriteAssetMap = Record<string, ImageSourcePropType>;

export type ResolvedSprite =
  | { kind: 'image'; source: ImageSourcePropType }
  | { kind: 'label'; label: string };

// The single place a sprite lookup is allowed to fail softly: a filename
// listed in config.json with no matching registry entry (real art not
// dropped in yet, or a typo) falls back to the same text-label placeholder
// Tile.tsx has always rendered, instead of trying to display a missing
// image. Never inspects which piece it's resolving — only whether the
// generic filename key exists in the map — so it works unchanged for any
// skin's config.
export function resolveSpriteAsset(
  spritePath: string | undefined,
  assets: SpriteAssetMap
): ResolvedSprite {
  const source = spritePath ? assets[spritePath] : undefined;
  if (source) return { kind: 'image', source };
  return { kind: 'label', label: spriteLabel(spritePath) };
}
