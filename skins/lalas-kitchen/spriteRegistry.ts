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
// All six pieceTypes sprites, the lives.icon sprite, and the one blocker
// sprite (cling.webp) have landed; each gets exactly one line below.
//
// home-hero-500h-crop.webp and splash-full-1024h.webp aren't piece/blocker
// sprites from config.json — they're the Home screen's header banner and
// the native splash reference art (components/Home.tsx looks the header
// one up by this literal filename, not through getSpriteForMatchType) —
// but they go through the exact same static require() registry since
// Metro's literal-string requirement applies to any bundled asset, not
// just piece art.
export const spriteRegistry: SpriteAssetMap = {
  'tomato.webp': require('./sprites/tomato.webp'),
  'lemon.webp': require('./sprites/lemon.webp'),
  'herb.webp': require('./sprites/herb.webp'),
  'garlic.webp': require('./sprites/garlic.webp'),
  'chili.webp': require('./sprites/chili.webp'),
  'spoon.webp': require('./sprites/spoon.webp'),
  'flame.webp': require('./sprites/flame.webp'),
  'cling.webp': require('./sprites/cling.webp'),
  'home-hero-500h-crop.webp': require('./sprites/home-hero-500h-crop.webp'),
  'splash-full-1024h.webp': require('./sprites/splash-full-1024h.webp'),
};
