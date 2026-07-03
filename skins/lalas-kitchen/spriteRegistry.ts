import { SpriteAssetMap } from '../../components/spriteAsset';

// Static require() registry for this skin's bundled sprite art. Metro
// (Expo's bundler, on both native and the web target) only follows
// require() calls whose argument is a literal string — it cannot resolve a
// path built from config.json's `sprite` field at runtime, so every real
// asset needs exactly one line added here, keyed by the same filename
// config.json already points at.
//
// Nothing in components/ needs to change when a line is added: Tile.tsx,
// Board.tsx, and Hud.tsx only ever go through resolveSpriteAsset() and
// never know this file exists.
//
// The six pieceTypes sprites and the lives.icon sprite have landed; each
// gets exactly one line below. `cling.webp` (the one blocker sprite) hasn't
// landed yet, so it's deliberately absent — requiring a file that doesn't
// exist would fail Metro's bundle step, not just fall back at runtime. Its
// absence here is exactly what makes a cling piece keep rendering its
// placeholder label until that file shows up too.
export const spriteRegistry: SpriteAssetMap = {
  'tomato.webp': require('./sprites/tomato.webp'),
  'lemon.webp': require('./sprites/lemon.webp'),
  'herb.webp': require('./sprites/herb.webp'),
  'garlic.webp': require('./sprites/garlic.webp'),
  'chili.webp': require('./sprites/chili.webp'),
  'spoon.webp': require('./sprites/spoon.webp'),
  'flame.webp': require('./sprites/flame.webp'),
};
