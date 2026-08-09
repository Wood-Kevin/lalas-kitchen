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
  // Per-mechanism colors for the momentary clear-time wash overlays
  // (blocker highlight, striped sweep, radial detonation, supercombo
  // convert flash) — see SPEC.md's "visual reward language" spec and
  // engine/DECISIONS.md's matching entry. Every one of these used to
  // share the single `accent` color above, differentiated only by shape
  // and duration; real playtest feedback ("mechanics don't really
  // vary") traced directly to that. An ordinary match deliberately has
  // no entry here — it keeps using `accent` unchanged, the reward-budget
  // decision that ordinary matches stay the most subdued mechanism.
  // Chosen and verified against a real protanopia/deuteranopia
  // simulation (SPEC.md section 3a) — a pure hue-wheel spread failed
  // that check, so these vary in lightness too, not hue alone.
  effectColors: {
    blocker: string;
    sweep: string;
    areaBomb: string;
    colorBomb: string;
    supercombo: string;
  };
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
