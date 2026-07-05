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
// All six pieceTypes sprites, all six striped_ variants, the color_bomb
// special-piece sprite, the lives.icon sprite, all three blocker sprites
// (cling.webp, dish_stack.webp, pot_lid.webp), and all nine recipe card
// illustrations have landed; each gets exactly one line below.
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
  // Striped special-piece art. A striped piece resolves to `striped_<its
  // base sprite>` (see components/spriteMap.ts's getSpriteForPiece). All six
  // ingredient types now have real striped art, one line per asset, exactly
  // like the piece sprites above; the resolveSpriteAsset text-label fallback
  // for a missing striped_* entry is no longer exercised in this skin.
  'striped_tomato.webp': require('./sprites/striped_tomato.webp'),
  'striped_lemon.webp': require('./sprites/striped_lemon.webp'),
  'striped_herb.webp': require('./sprites/striped_herb.webp'),
  'striped_garlic.webp': require('./sprites/striped_garlic.webp'),
  'striped_chili.webp': require('./sprites/striped_chili.webp'),
  'striped_spoon.webp': require('./sprites/striped_spoon.webp'),
  // Color-bomb special-piece art. A color bomb is colorless (no matchType), so
  // components/spriteMap.ts's getSpriteForPiece resolves every color bomb to
  // the one fixed key 'color_bomb' (no extension — it's an engine piece-type,
  // not a config.json filename like every other key here). The KEY must equal
  // that lookup string exactly; the require path is the real asset file. With
  // this entry present a bomb renders the real glowing art; before it, the
  // lookup missed and fell through to resolveSpriteAsset's "CO" placeholder.
  'color_bomb': require('./sprites/color_bomb.webp'),
  // Area-bomb special-piece art. Unlike color_bomb's extensionless key, an area
  // bomb resolves to the real filename 'area_bomb.webp' (see
  // components/spriteMap.ts's getSpriteForPiece) — one fixed sprite for every
  // area bomb regardless of the ingredient it wraps, so this is one line, not
  // six per-type lines like striped_. Before this entry an area bomb fell
  // through to resolveSpriteAsset's "AR" text-label placeholder.
  'area_bomb.webp': require('./sprites/area_bomb.webp'),
  'flame.webp': require('./sprites/flame.webp'),
  'cling.webp': require('./sprites/cling.webp'),
  'dish_stack.webp': require('./sprites/dish_stack.webp'),
  'pot_lid.webp': require('./sprites/pot_lid.webp'),
  'home-hero-500h-crop.webp': require('./sprites/home-hero-500h-crop.webp'),
  'splash-full-1024h.webp': require('./sprites/splash-full-1024h.webp'),
  // Recipe card illustrations — one per config.json recipeCards entry, keyed
  // by that entry's `sprite` field (see appPersistence.ts's
  // findRecipeCardForLevel). Real art landing here is the only change needed
  // to swap RecipeCardReveal/RecipeBook off the text-label fallback.
  'recipe_tomato_stew.webp': require('./sprites/recipe_tomato_stew.webp'),
  'recipe_herb_garden_salad.webp': require('./sprites/recipe_herb_garden_salad.webp'),
  'recipe_lemon_roast_chicken.webp': require('./sprites/recipe_lemon_roast_chicken.webp'),
  'recipe_garlic_bread_basket.webp': require('./sprites/recipe_garlic_bread_basket.webp'),
  'recipe_hearty_chili_pot.webp': require('./sprites/recipe_hearty_chili_pot.webp'),
  'recipe_wooden_spoon_pancakes.webp': require('./sprites/recipe_wooden_spoon_pancakes.webp'),
  'recipe_chili_lemon_soup.webp': require('./sprites/recipe_chili_lemon_soup.webp'),
  'recipe_garlic_herb_roast.webp': require('./sprites/recipe_garlic_herb_roast.webp'),
  'recipe_grandmas_recipe_box.webp': require('./sprites/recipe_grandmas_recipe_box.webp'),
};
