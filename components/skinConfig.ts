// Mirrors the schema in skins/<skinId>/config.json (see lalas-kitchen-build-spec.md
// Phase 4). Defined here rather than in skins/ since this is "what shape does a
// skin config have to be for components/ to render it" — a presentation-layer
// contract, not skin data itself.
export interface SkinPieceType {
  id: string;
  sprite: string;
}

export interface SkinBlocker {
  id: string;
  sprite: string;
  hitsToClear: number;
  // "Blocker depth" (see engine/DECISIONS.md's blocker-depth entry) — when
  // true, this blocker only takes adjacent damage from a special effect
  // (a sweep/blast/detonation/chain), never a plain ordinary match. Omitted
  // means an ordinary blocker, identical to every blocker before this
  // variant existed.
  specialOnly?: boolean;
}

// The actual cookable recipe behind a card — plain ingredient/step lists,
// not markup or structured quantities, matching how flavorText is already
// just a plain string rather than a richer data shape. Optional on
// RecipeCard: a card can exist (real art, a real milestone) before its
// recipe content is written, the same "art can land before/after config"
// gap the sprite-fallback convention already tolerates elsewhere.
export interface Recipe {
  ingredients: string[];
  steps: string[];
}

// A fixed, curated collectible tied to one specific level number — not one
// per level forever (levels generate indefinitely; a collection needs a
// completable set). `milestoneLevel` is the absolute level index (matching
// LEVEL_QUEUE/buildGeneratedLevelConfig's own numbering in App.tsx) that
// unlocks this card the first time it's won. See
// appPersistence.ts's findRecipeCardForLevel for the lookup and
// engine/DECISIONS.md for why the mapping is a fixed array rather than a
// formula.
export interface RecipeCard {
  id: string;
  title: string;
  flavorText: string;
  milestoneLevel: number;
  sprite: string;
  recipe?: Recipe;
}

export type CascadeFallSpeed = 'slow' | 'medium' | 'fast';

export interface SkinAnimationProfile {
  matchStyle: string;
  matchDurationMs: number;
  cascadeFallSpeed: CascadeFallSpeed;
  swapDurationMs: number;
}

export interface SkinPalette {
  // Exactly two stops, always — a real top-to-bottom LinearGradient wash on
  // every screen that reads its own background (Board.tsx's game screen,
  // Home.tsx's hero fade), not an arbitrary-length ramp. Narrowed from a
  // plain string[] so LinearGradient's own tuple-typed `colors` prop
  // type-checks without a cast at every call site.
  background: [string, string];
  panel: string;
  accent: string;
  // Added for the Home/level map screens (components/Home.tsx,
  // components/LevelMap.tsx) — the HUD/Board/overlays only ever needed
  // accent-vs-default-text, but the dashboard design calls for a richer
  // three-tier text/border scheme (sage green, warm brown, muted tan) on
  // top of that, so these are real palette data rather than hardcoded in
  // the new screens themselves.
  secondaryAccent: string;
  // A darker variant of secondaryAccent, same hue, reserved for when that
  // color is used as text color against `panel` — `secondaryAccent` itself
  // only computes to 3.16:1 contrast there (WCAG AA needs 4.5:1 for normal
  // text), confirmed by direct computation, not eyeballed. secondaryAccent
  // is left unchanged for its many non-text uses (borders, icon tints,
  // sparkle colors) where contrast rules don't apply the same way, so
  // fixing this doesn't ripple into those.
  secondaryAccentText: string;
  mutedText: string;
  border: string;
  text: string;
  // NOTE: this skin used to carry a `effectColors` field here — one fixed
  // wash color per clear MECHANISM (blocker/sweep/radial/supercombo),
  // introduced by SPEC.md's "visual reward language" spec after real
  // feedback that every clear effect shared one color and only varied by
  // shape/duration. Two follow-up passes then chased "the colors feel
  // lame, doesn't match genre" by retuning those hues (see
  // engine/DECISIONS.md's effect-color-resaturation entry and its
  // correction). Removed entirely on unity-migration-exploration after
  // Kevin rejected the whole premise, not the tuning: "I want the colors
  // gone... We don't want a color line! Just an animation." Real match-3
  // games never tint a clearing tile by a mechanism color code — effect
  // identity now comes entirely from motion/shape/timing of the piece's
  // own real sprite art (see Tile.tsx's ExitingTile and
  // engine/DECISIONS.md's colors-removed rework entry). The
  // colorblind-simulation work itself wasn't wasted — it's the reason
  // this rework could confidently drop color as an identity channel
  // rather than leaning on it harder.
  // The HUD's "Kitchen Tray" character redesign (see SPEC.md's HUD
  // reward-texture-and-character spec, superseding the old flat-panel
  // `Hud.tsx` — real playtest signal: "just not bland"). Only the OUTER
  // tray surface gets its own dedicated warm-wood color; the chips and
  // score plaque inside it deliberately keep reusing `panel`/`border`
  // above, so the redesign reads as a new material housing the same
  // familiar cream/cookbook surfaces, not a second palette competing
  // with the first. `chipBorder` is the one exception — a warmer gold
  // than the plain `border` above, giving the chips inside the tray
  // their own small accent without a whole new hue family.
  tray: {
    background: string;
    border: string;
    chipBorder: string;
  };
}

export interface SkinConfig {
  skinId: string;
  pieceTypes: SkinPieceType[];
  blockers: SkinBlocker[];
  lives: { max: number; regenMinutes: number; icon: string };
  animationProfile: SkinAnimationProfile;
  palette: SkinPalette;
  recipeCards: RecipeCard[];
}
