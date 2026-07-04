import { LevelConfig } from '../engine/gameState';

// Pure derived-state helpers behind the Home and All Levels screens — split
// out the same way wonActions.ts/pauseActions.ts sit beside their overlays,
// so "what's next", "is this level locked", and "what does this level get
// called" are each testable directly instead of only through a mounted
// Home.tsx/AllLevels.tsx tree, which this project has no test harness for.

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

export type LevelStatus = 'completed' | 'locked';

// All Levels' two-state model per the design: a level is either completed
// (checkmark, tappable to replay) or locked (dimmed, not tappable) — there's
// no third "in progress" state since this project has no partial-completion
// concept, only won-at-least-once or not.
export function resolveLevelStatus(levelIndex: number, completedLevels: number[]): LevelStatus {
  return completedLevels.includes(levelIndex) ? 'completed' : 'locked';
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

export interface LevelSummary {
  levelIndex: number;
  displayName: string;
  targetMatchType: string;
}

// Reduces a full LevelConfig down to just what a list row or the "Up Next"
// card needs to render — callers (App.tsx) build this from whatever
// buildLevelConfig() returns, without Home.tsx/AllLevels.tsx needing to know
// how a LevelConfig is actually constructed for a hand-built vs. generated
// level.
export function buildLevelSummary(
  config: Pick<LevelConfig, 'displayName' | 'objective'>,
  levelIndex: number
): LevelSummary {
  return {
    levelIndex,
    displayName: resolveLevelDisplayName(config.displayName, levelIndex),
    targetMatchType: config.objective.targetMatchType,
  };
}

// The recipe book's progress copy — three distinct registers (nothing
// cooked yet, mid-progress, fully caught up) rather than one templated
// string, so each reads like something a calm narrator would actually say
// per CLAUDE.md's "calm and satisfying, not frantic" constraint. No
// percentage, no urgency language, matching the Home screen's explicit
// design requirement.
export function buildProgressCopy(completedCount: number, totalCount: number): string {
  if (totalCount <= 0 || completedCount <= 0) {
    return 'A fresh recipe book, ready when you are.';
  }
  if (completedCount >= totalCount) {
    return 'Every recipe cooked. The kitchen smells wonderful.';
  }
  const remaining = totalCount - completedCount;
  const recipeWord = completedCount === 1 ? 'recipe' : 'recipes';
  return `${completedCount} ${recipeWord} cooked, ${remaining} still waiting on the shelf. No hurry.`;
}

// One boolean per dot in the progress row (true = filled/completed) — kept
// separate from the copy above since the dot row and the sentence are two
// different renderings of the same two numbers.
export function buildProgressDots(completedCount: number, totalCount: number): boolean[] {
  return Array.from({ length: totalCount }, (_, i) => i < completedCount);
}
