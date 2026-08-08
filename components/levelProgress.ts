import { LevelConfig } from '../engine/gameState';

// Pure derived-state helpers behind the Home and All Levels screens — split
// out the same way wonActions.ts/pauseActions.ts sit beside their overlays,
// so "what's next", "is this level locked", and "what does this level get
// called" are each testable directly instead of only through a mounted
// Home.tsx/LevelMap.tsx tree, which this project has no test harness for.

// The smallest level number not yet in completedLevels. Assumes normal play
// completes levels roughly in order (the only way to reach one today), but
// falls back correctly even if a gap exists (e.g. level 2 was somehow
// skipped) — the first gap is always what's actually "next", not just
// max(completedLevels) + 1.
export function resolveNextUnplayedLevel(completedLevels: number[]): number {
  let candidate = 1;
  while (completedLevels.includes(candidate)) {
    candidate += 1;
  }
  return candidate;
}

export type LevelStatus = 'completed' | 'current' | 'locked';

// The level map's three-state model (see components/LevelMap.tsx): a level
// is completed (checkmark + stars, tappable to replay), current — the one
// real next-unplayed level, exactly resolveNextUnplayedLevel's own answer —
// glowing and tappable via its PLAY button, or locked — every other
// not-yet-reached level, dimmed and inert. This replaced the old All Levels
// screen's two-state model (completed/locked only, with the next-unplayed
// level itself rendered as an inert locked row — there was never a way to
// start a fresh level from that screen, only Home's "Start cooking" could).
// Still no fourth "in progress" state: this project has no partial-
// completion concept, only won-at-least-once or not.
export function resolveLevelStatus(
  levelIndex: number,
  completedLevels: number[],
  nextLevelIndex: number
): LevelStatus {
  if (completedLevels.includes(levelIndex)) return 'completed';
  return levelIndex === nextLevelIndex ? 'current' : 'locked';
}

// A curated, deterministic name for any level with no real authored
// displayName — every generator-driven level past LEVEL_QUEUE, since
// generated content has no per-level identity to draw from. A real
// playtest report flagged the plain "Level N" fallback (the level number
// is ALREADY shown separately everywhere this renders — Home's "Up next ·
// Level N" eyebrow, LevelMap's "LEVEL N" caption and medallion number —
// see Home.tsx/LevelMap.tsx) as weakening the fantasy once curated names
// ran out, since it repeated information rather than adding any.
//
// A single 14-entry rotated list was tried first and rejected — the real
// player's save is already past level 330 (~319 generated levels), so a
// 14-name cycle would repeat roughly 23 times over, more noticeable than
// the "Level N" it replaced, not less. Combining two small, independently-
// stepping word pools instead gives far more mileage from the same modest
// amount of authored content: with pool sizes chosen COPRIME (13 and 17,
// both prime), the combined (timeWord, noun) pair has period exactly
// 13 x 17 = 221 by the Chinese Remainder Theorem — every one of the 221
// possible combinations occurs exactly once per cycle, not some smaller
// sub-cycle a shared-factor pool size would waste. 221 levels between
// exact repeats is a large, deliberate improvement over 14, not a claim of
// literal infinity. See engine/DECISIONS.md's generated-level-naming entry
// (and its later revision after this exact repeat-frequency concern).
const STATION_TIME_WORDS: string[] = [
  'Morning',
  'Midday',
  'Afternoon',
  'Evening',
  'Sunday',
  'Quiet',
  'Golden',
  'Slow',
  'Early',
  'Warm',
  'Late',
  'Busy',
  'Gentle',
];

const STATION_NOUNS: string[] = [
  'Simmer',
  'Prep',
  'Pantry Shelf',
  'Spice Rack',
  'Bread Board',
  'Corner Nook',
  'Stir',
  'Windowsill',
  'Cutting Table',
  'Ladle',
  'Countertop',
  'Burner',
  'Stovetop',
  'Teapot',
  'Mixing Bowl',
  'Cupboard',
  'Breadbasket',
];

export function resolveLevelDisplayName(displayName: string | undefined, levelIndex: number): string {
  if (displayName) return displayName;
  const n = levelIndex - 1;
  const timeWord = STATION_TIME_WORDS[n % STATION_TIME_WORDS.length];
  const noun = STATION_NOUNS[n % STATION_NOUNS.length];
  return `${timeWord} ${noun}`;
}

// The hand-built queue's levels are always part of the "recipe book" —
// completed or not, they're known, finite content — but generator-driven
// levels past it are unbounded, so only the ones actually completed have
// any real identity to show. Mirrors the exact enumeration the original
// Dashboard.tsx used, just extracted so it's shared (and tested) rather
// than duplicated between Home's progress total and All Levels' row list.
export function resolveVisibleLevelIndices(handBuiltLevelCount: number, completedLevels: number[]): number[] {
  const handBuilt = Array.from({ length: handBuiltLevelCount }, (_, i) => i + 1);
  const completedGenerated = completedLevels.filter((level) => level > handBuiltLevelCount);
  return [...handBuilt, ...completedGenerated];
}

// How many locked nodes the level map shows past the current level, so the
// winding path always has somewhere to visibly climb toward — a fixed
// implementation constant (matching the approved map design's own preview
// depth), not a difficulty or content lever.
const MAP_LOCKED_LOOKAHEAD = 4;

// resolveVisibleLevelIndices' own rule (never show an unplayed generated
// level) was correct for the old All Levels list, which had no concept of
// "current" at all — every non-completed row was an inert dead end, so
// showing an unplayed generated level would have been a locked row nobody
// could ever reach except by finishing every level before it for real. The
// level map breaks that assumption: nextLevelIndex is always genuinely
// reachable (it's exactly what Home's "Start cooking" already targets), and
// past it the design calls for a few visibly locked nodes so the path has
// somewhere to lead. So this is a distinct, wider index set for the map —
// resolveVisibleLevelIndices' hand-built + completed-generated coverage
// (real history, however far back it goes), unioned with nextLevelIndex and
// MAP_LOCKED_LOOKAHEAD levels past it (a real, always-reachable preview).
export function resolveLevelMapIndices(
  handBuiltLevelCount: number,
  completedLevels: number[],
  nextLevelIndex: number
): number[] {
  const historical = resolveVisibleLevelIndices(handBuiltLevelCount, completedLevels);
  const ahead = Array.from({ length: MAP_LOCKED_LOOKAHEAD }, (_, i) => nextLevelIndex + i);
  return Array.from(new Set([...historical, ...ahead])).sort((a, b) => a - b);
}

export interface LevelSummary {
  levelIndex: number;
  displayName: string;
  // Only set when the first objective is 'collect' — undefined for a
  // 'score'/'clearance'/'escort' objective, none of which has a single
  // matchType to show an icon for. Home.tsx checks objectiveType before
  // reading this, rather than assuming it's always defined.
  targetMatchType?: string;
  objectiveType: 'collect' | 'score' | 'clearance' | 'escort';
}

// Reduces a full LevelConfig down to just what a list row or the "Up Next"
// card needs to render — callers (App.tsx) build this from whatever
// buildLevelConfig() returns, without Home.tsx/LevelMap.tsx needing to know
// how a LevelConfig is actually constructed for a hand-built vs. generated
// level.
export function buildLevelSummary(
  config: Pick<LevelConfig, 'displayName' | 'objectives'>,
  levelIndex: number
): LevelSummary {
  // Row/"Up Next" icon space was never asked to grow with objective count —
  // the first objective is always the one shown, same single-icon layout
  // regardless of how many targets the level actually has.
  const firstObjective = config.objectives[0];
  return {
    levelIndex,
    displayName: resolveLevelDisplayName(config.displayName, levelIndex),
    targetMatchType:
      firstObjective.type === 'score' || firstObjective.type === 'clearance' || firstObjective.type === 'escort'
        ? undefined
        : firstObjective.targetMatchType,
    objectiveType:
      firstObjective.type === 'score' || firstObjective.type === 'clearance' || firstObjective.type === 'escort'
        ? firstObjective.type
        : 'collect',
  };
}

// The recipe book collection's progress copy — unlike level-completion
// progress (which has no ceiling, see this file's git history for the
// now-removed buildProgressCopy), the recipe card collection genuinely is
// a fixed, curated set (skinConfig.recipeCards in the active skin — see
// appPersistence.ts's findRecipeCardForLevel), so "X of Y" is a real ratio
// here, not a fake denominator smuggled back in. Still just a plain count,
// no percentage, no progress bar, no urgency language, per this feature's
// explicit "not a competitive achievement system" design brief.
// The forward-looking companion line to the subtitle above (see
// appPersistence.ts's findNextRecipeCard for where the distance comes from
// and why it only ever looks ahead). Deliberately does NOT name the recipe:
// the collection screen renders locked cards as anonymous empty cells, so
// naming one here would leak the surprise that reveal moment exists for —
// the hint promises *that* something is coming, never *what*. Same calm
// register as everything else on this card: no countdown framing, no
// exclamation, no urgency.
export function buildNextRecipeHint(levelsAway: number): string {
  // "your next level" rather than "this level": both surfaces that show
  // this (Home's recipe book card, the win overlay) anchor the distance on
  // the level the player is ABOUT to play, so distance 0 always means "the
  // very next one you start" — phrasing that reads correctly from either.
  if (levelsAway <= 0) return 'A new recipe waits in your next level.';
  if (levelsAway === 1) return 'A new recipe waits one level ahead.';
  return `A new recipe waits ${levelsAway} levels ahead.`;
}

export function buildRecipeBookSubtitle(unlockedCount: number, totalCount: number): string {
  if (unlockedCount <= 0) {
    return 'A fresh recipe book, ready when you are.';
  }
  if (unlockedCount >= totalCount) {
    return 'Every recipe collected — the book is complete.';
  }
  // "recipes" stays plural even at a count of 1 — the ratio's denominator
  // ("of Y") already frames this as a pool, so "1 of Y recipe collected"
  // reads wrong the way a bare "1 recipe" never would.
  return `${unlockedCount} of ${totalCount} recipes collected.`;
}
