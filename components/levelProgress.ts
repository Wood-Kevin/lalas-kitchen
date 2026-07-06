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

// Falls back to a plain "Level N" label for any level with no displayName
// (every generator-driven level past LEVEL_QUEUE, and any hand-built level
// that hasn't been given a real name) — never fabricates a themed name.
export function resolveLevelDisplayName(displayName: string | undefined, levelIndex: number): string {
  return displayName ?? `Level ${levelIndex}`;
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
  targetMatchType: string;
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
  return {
    levelIndex,
    displayName: resolveLevelDisplayName(config.displayName, levelIndex),
    // Row/"Up Next" icon space was never asked to grow with objective count —
    // the first objective is always the one shown, same single-icon layout
    // regardless of how many targets the level actually has.
    targetMatchType: config.objectives[0].targetMatchType,
  };
}

// The recipe book collection's progress copy — unlike level-completion
// progress (which has no ceiling, see this file's git history for the
// now-removed buildProgressCopy), the recipe card collection genuinely is
// a fixed, curated set (skinConfig.recipeCards, currently 9 — see
// appPersistence.ts's findRecipeCardForLevel), so "X of Y" is a real ratio
// here, not a fake denominator smuggled back in. Still just a plain count,
// no percentage, no progress bar, no urgency language, per this feature's
// explicit "not a competitive achievement system" design brief.
export function buildRecipeBookSubtitle(unlockedCount: number, totalCount: number): string {
  if (unlockedCount <= 0) {
    return 'A fresh recipe book, ready when you are.';
  }
  if (unlockedCount >= totalCount) {
    return 'Every recipe collected — the book is complete.';
  }
  // "recipes" stays plural even at a count of 1 — the ratio's denominator
  // ("of 9") already frames this as a pool, so "1 of 9 recipe collected"
  // reads wrong the way a bare "1 recipe" never would.
  return `${unlockedCount} of ${totalCount} recipes collected.`;
}
