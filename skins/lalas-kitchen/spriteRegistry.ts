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
// special-piece sprite, the lives.icon sprite, all four blocker sprites
// (cling.webp, dish_stack.webp, pot_lid.webp, sealed_jar.webp), and all 52
// recipe card illustrations (the original 12, plus a 40-card extension pack
// — see engine/DECISIONS.md's 40-card-extension-wired entry) have landed;
// each gets exactly one line below.
//
// home-hero-500h-crop.webp and splash-full-1024h.webp aren't piece/blocker
// sprites from config.json — they're the Home screen's header banner and
// the native splash reference art (components/Home.tsx looks the header
// one up by this literal filename, not through getSpriteForMatchType) —
// but they go through the exact same static require() registry since
// Metro's literal-string requirement applies to any bundled asset, not
// just piece art.
// The bottom toolbar's exit/shuffle/hint buttons (components/Board.tsx, via
// resolveToolbarIconSprite) look these three up by these literal filenames
// and fall back to their old emoji glyph only if a lookup misses — now that
// real art exists, this registry entry is the entire fix. Nothing else in
// Board.tsx needed to change.
export const spriteRegistry: SpriteAssetMap = {
  'tomato.webp': require('./sprites/tomato.webp'),
  'lemon.webp': require('./sprites/lemon.webp'),
  'herb.webp': require('./sprites/herb.webp'),
  'garlic.webp': require('./sprites/garlic.webp'),
  'chili.webp': require('./sprites/chili.webp'),
  'spoon.webp': require('./sprites/spoon.webp'),
  'icon_exit.webp': require('./sprites/icon_exit.webp'),
  'icon_shuffle.webp': require('./sprites/icon_shuffle.webp'),
  'icon_hint.webp': require('./sprites/icon_hint.webp'),
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
  // Dropdown (escort) piece art. Like area_bomb, resolves by the real
  // filename 'dropdown.webp' (see components/spriteMap.ts's
  // getSpriteForPiece), one fixed sprite regardless of level or position —
  // not color_bomb's extensionless-key special case. Before this entry a
  // dropdown piece fell through to resolveSpriteAsset's "DR" text-label
  // placeholder, disclosed but un-arted since the escort mechanic first
  // shipped (see engine/DECISIONS.md's dropdown-ingredients entry and
  // docs/verification/dropdown-escort-mechanic/).
  'dropdown.webp': require('./sprites/dropdown.webp'),
  'flame.webp': require('./sprites/flame.webp'),
  'mascot.webp': require('./sprites/mascot.webp'),
  'cling.webp': require('./sprites/cling.webp'),
  'dish_stack.webp': require('./sprites/dish_stack.webp'),
  'pot_lid.webp': require('./sprites/pot_lid.webp'),
  // sealed_jar (the specialOnly blocker variant — see engine/DECISIONS.md's
  // blocker-depth entry) resolves like every other blocker, by its real
  // config.json filename. Declared there from the start but never actually
  // registered until now — disclosed at build/verification time (the "SE"
  // text-label placeholder is even named directly in
  // docs/verification/blocker-depth/), just never itemized in
  // DEFERRED_COMPLEXITY.md the way dropdown's equivalent gap was.
  'sealed_jar.webp': require('./sprites/sealed_jar.webp'),
  'home-hero-500h-crop.webp': require('./sprites/home-hero-500h-crop.webp'),
  'splash-full-1024h.webp': require('./sprites/splash-full-1024h.webp'),
  // Board.tsx's boardArea backdrop (a sage-tile kitchen counter scene,
  // 1024x1536, Kevin's own find) — rendered as the bottommost layer inside
  // boardArea, behind KitchenSceneDecor's corner cloth/herb and behind the
  // tile grid itself. Per CLAUDE.md's "board renders close to edge to edge"
  // constraint, the grid covers nearly all of this on an ordinary
  // rectangular level — it's mainly visible through void cells on shaped
  // boards and any margin on the board's non-constraining axis, not as a
  // full backdrop. See engine/DECISIONS.md's board-background entry.
  'board-background-sage.webp': require('./sprites/board-background-sage.webp'),
  // Level map decor — resized to a 600px longest edge (the largest on-screen
  // use, the start-gate landmark, renders at 150x184dp, i.e. 450x552px at
  // @3x) and converted to WebP, matching every other sprite in this skin.
  // The raw, full-resolution originals (~2.3-2.7MB PNGs each) are kept in
  // the untracked _assets/ staging folder, not bundled.
  'levelmap_garden_gate.webp': require('./sprites/levelmap_garden_gate.webp'),
  'levelmap_lemon_basket.webp': require('./sprites/levelmap_lemon_basket.webp'),
  'levelmap_herb_garden.webp': require('./sprites/levelmap_herb_garden.webp'),
  'levelmap_garlic_crate.webp': require('./sprites/levelmap_garlic_crate.webp'),
  'levelmap_simmering_pot.webp': require('./sprites/levelmap_simmering_pot.webp'),
  'levelmap_recipe_box.webp': require('./sprites/levelmap_recipe_box.webp'),
  // LevelMap.tsx's own scrollable-content backdrop (512x512, a seamless
  // sage/cream tile, Kevin's own find, explicitly built to repeat with no
  // visible seam) — rendered at Image resizeMode="repeat" behind the path/
  // landmarks/nodes inside the ScrollView content, sized to the full
  // (dynamically growing) contentHeight so it tiles down the whole map
  // rather than just the viewport, matching the tile's own "designed for
  // seamless scrolling" purpose. See engine/DECISIONS.md's
  // levelmap-background-tile entry.
  'levelmap-background-tile.webp': require('./sprites/levelmap-background-tile.webp'),
  // Recipe card illustrations — one per config.json recipeCards entry, keyed
  // by that entry's `sprite` field (see appPersistence.ts's
  // findRecipeCardForLevel). Real art landing here is the only change needed
  // to swap RecipeCardReveal/RecipeBook off the text-label fallback. Resized
  // to 300x300 (the largest on-screen use, RecipeCardReveal's illustration,
  // renders at 96dp, i.e. 288px at @3x) and converted to WebP — the source
  // art arrived as uncompressed 1254x1254 PNGs (~2.5-3.2MB each); the raw
  // originals are kept in the untracked _assets/ staging folder, not bundled.
  'recipe_tomato_stew.webp': require('./sprites/recipe_tomato_stew.webp'),
  'recipe_classic_tomato_soup.webp': require('./sprites/recipe_classic_tomato_soup.webp'),
  'recipe_herb_garden_salad.webp': require('./sprites/recipe_herb_garden_salad.webp'),
  'recipe_lemon_roast_chicken.webp': require('./sprites/recipe_lemon_roast_chicken.webp'),
  'recipe_herb_hearth_focaccia.webp': require('./sprites/recipe_herb_hearth_focaccia.webp'),
  'recipe_garlic_bread_basket.webp': require('./sprites/recipe_garlic_bread_basket.webp'),
  'recipe_hearty_chili_pot.webp': require('./sprites/recipe_hearty_chili_pot.webp'),
  'recipe_wooden_spoon_pancakes.webp': require('./sprites/recipe_wooden_spoon_pancakes.webp'),
  'recipe_chili_lemon_soup.webp': require('./sprites/recipe_chili_lemon_soup.webp'),
  'recipe_lemon_squeeze.webp': require('./sprites/recipe_lemon_squeeze.webp'),
  'recipe_garlic_herb_roast.webp': require('./sprites/recipe_garlic_herb_roast.webp'),
  'recipe_grandmas_recipe_box.webp': require('./sprites/recipe_grandmas_recipe_box.webp'),
  // 40-card extension pack (recipe-card-watercolor-pack-2026-07-29-expansion),
  // wired to the milestone curve engine/DECISIONS.md's 40-card-extension-curve
  // entry designed (levels 50-625, widening gap). Same 300x300/quality-85
  // WebP treatment as the original 12; a further 6 "alternate" cards from the
  // same pack were deliberately left unwired — see DEFERRED_COMPLEXITY.md.
  'recipe_basil_breakfast_eggs.webp': require('./sprites/recipe_basil_breakfast_eggs.webp'),
  'recipe_basil_butter_gnocchi.webp': require('./sprites/recipe_basil_butter_gnocchi.webp'),
  'recipe_basil_cream_pasta.webp': require('./sprites/recipe_basil_cream_pasta.webp'),
  'recipe_chili_bean_bake.webp': require('./sprites/recipe_chili_bean_bake.webp'),
  'recipe_chili_cheddar_bake.webp': require('./sprites/recipe_chili_cheddar_bake.webp'),
  'recipe_chili_cornbread_skillet.webp': require('./sprites/recipe_chili_cornbread_skillet.webp'),
  'recipe_chili_honey_carrots.webp': require('./sprites/recipe_chili_honey_carrots.webp'),
  'recipe_chili_roast_potatoes.webp': require('./sprites/recipe_chili_roast_potatoes.webp'),
  'recipe_garden_herb_omelet.webp': require('./sprites/recipe_garden_herb_omelet.webp'),
  'recipe_garlic_braised_greens.webp': require('./sprites/recipe_garlic_braised_greens.webp'),
  'recipe_garlic_herb_rice.webp': require('./sprites/recipe_garlic_herb_rice.webp'),
  'recipe_garlic_skillet_mushrooms.webp': require('./sprites/recipe_garlic_skillet_mushrooms.webp'),
  'recipe_garlic_tomato_bruschetta.webp': require('./sprites/recipe_garlic_tomato_bruschetta.webp'),
  'recipe_herb_crumb_chicken.webp': require('./sprites/recipe_herb_crumb_chicken.webp'),
  'recipe_herb_garden_flatbread.webp': require('./sprites/recipe_herb_garden_flatbread.webp'),
  'recipe_herb_market_soup.webp': require('./sprites/recipe_herb_market_soup.webp'),
  'recipe_herb_roasted_carrots.webp': require('./sprites/recipe_herb_roasted_carrots.webp'),
  'recipe_lemon_apron_cookies.webp': require('./sprites/recipe_lemon_apron_cookies.webp'),
  'recipe_lemon_cream_scones.webp': require('./sprites/recipe_lemon_cream_scones.webp'),
  'recipe_lemon_herb_couscous.webp': require('./sprites/recipe_lemon_herb_couscous.webp'),
  'recipe_lemon_poppy_loaf.webp': require('./sprites/recipe_lemon_poppy_loaf.webp'),
  'recipe_lemon_skillet_greens.webp': require('./sprites/recipe_lemon_skillet_greens.webp'),
  'recipe_lemon_thyme_biscuits.webp': require('./sprites/recipe_lemon_thyme_biscuits.webp'),
  'recipe_pantry_bean_stew.webp': require('./sprites/recipe_pantry_bean_stew.webp'),
  'recipe_roasted_garlic_mash.webp': require('./sprites/recipe_roasted_garlic_mash.webp'),
  'recipe_roasted_garlic_soup.webp': require('./sprites/recipe_roasted_garlic_soup.webp'),
  'recipe_roasted_pepper_stew.webp': require('./sprites/recipe_roasted_pepper_stew.webp'),
  'recipe_rosemary_garlic_rolls.webp': require('./sprites/recipe_rosemary_garlic_rolls.webp'),
  'recipe_skillet_lemon_potatoes.webp': require('./sprites/recipe_skillet_lemon_potatoes.webp'),
  'recipe_spoon_cake_pudding.webp': require('./sprites/recipe_spoon_cake_pudding.webp'),
  'recipe_spoon_stirred_polenta.webp': require('./sprites/recipe_spoon_stirred_polenta.webp'),
  'recipe_sunday_herb_stuffing.webp': require('./sprites/recipe_sunday_herb_stuffing.webp'),
  'recipe_tomato_basil_tart.webp': require('./sprites/recipe_tomato_basil_tart.webp'),
  'recipe_tomato_braised_beans.webp': require('./sprites/recipe_tomato_braised_beans.webp'),
  'recipe_tomato_harvest_pie.webp': require('./sprites/recipe_tomato_harvest_pie.webp'),
  'recipe_tomato_jam_toast.webp': require('./sprites/recipe_tomato_jam_toast.webp'),
  'recipe_tomato_rice_bake.webp': require('./sprites/recipe_tomato_rice_bake.webp'),
  'recipe_garden_tomato_galette.webp': require('./sprites/recipe_garden_tomato_galette.webp'),
  'recipe_basil_skillet_bread.webp': require('./sprites/recipe_basil_skillet_bread.webp'),
  'recipe_skillet_honey_squash.webp': require('./sprites/recipe_skillet_honey_squash.webp'),
};
