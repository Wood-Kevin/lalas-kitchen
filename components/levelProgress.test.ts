import {
  buildLevelSummary,
  buildRecipeBookSubtitle,
  resolveLevelDisplayName,
  resolveLevelMapIndices,
  resolveLevelStatus,
  resolveNextUnplayedLevel,
  resolveVisibleLevelIndices,
} from './levelProgress';

describe('resolveNextUnplayedLevel', () => {
  test('a fresh save with nothing completed points at level 1', () => {
    expect(resolveNextUnplayedLevel([])).toBe(1);
  });

  test('points at the level right after the highest completed one', () => {
    expect(resolveNextUnplayedLevel([1, 2])).toBe(3);
  });

  test('finds a gap instead of assuming strictly linear completion', () => {
    // Level 2 was somehow never completed even though 1 and 3 were —
    // "next" should still surface the real gap, not max(completed) + 1.
    expect(resolveNextUnplayedLevel([1, 3])).toBe(2);
  });

  test('is unaffected by completedLevels order', () => {
    expect(resolveNextUnplayedLevel([3, 1, 2])).toBe(4);
  });
});

describe('resolveLevelStatus', () => {
  test('a completed level reports completed', () => {
    expect(resolveLevelStatus(2, [1, 2, 3], 4)).toBe('completed');
  });

  test('the real next-unplayed level reports current', () => {
    expect(resolveLevelStatus(4, [1, 2, 3], 4)).toBe('current');
  });

  test('a level not in completedLevels and not the next-unplayed one reports locked', () => {
    expect(resolveLevelStatus(5, [1, 2, 3], 4)).toBe('locked');
  });

  test('an empty completedLevels reports level 1 as current, not locked', () => {
    expect(resolveLevelStatus(1, [], 1)).toBe('current');
  });

  test('an empty completedLevels locks every level past the next-unplayed one', () => {
    expect(resolveLevelStatus(2, [], 1)).toBe('locked');
  });

  test('a completed level takes priority even if it somehow equals nextLevelIndex', () => {
    // Not reachable via resolveNextUnplayedLevel in practice, but completed
    // status should still win if it were ever passed in this shape.
    expect(resolveLevelStatus(2, [1, 2], 2)).toBe('completed');
  });
});

describe('resolveLevelDisplayName', () => {
  test('uses the real displayName when one exists', () => {
    expect(resolveLevelDisplayName('Tomato Toss', 1)).toBe('Tomato Toss');
  });

  test('falls back to a plain "Level N" label when displayName is undefined', () => {
    expect(resolveLevelDisplayName(undefined, 7)).toBe('Level 7');
  });
});

describe('resolveVisibleLevelIndices', () => {
  test('always includes every hand-built level regardless of completion', () => {
    expect(resolveVisibleLevelIndices(3, [])).toEqual([1, 2, 3]);
  });

  test('adds completed generated levels past the hand-built count', () => {
    expect(resolveVisibleLevelIndices(3, [1, 2, 3, 4, 6])).toEqual([1, 2, 3, 4, 6]);
  });

  test('does not add a generated level that has not been completed', () => {
    expect(resolveVisibleLevelIndices(3, [1, 2])).toEqual([1, 2, 3]);
  });
});

describe('resolveLevelMapIndices', () => {
  test('includes the current level even though it is not completed — the old visible-indices rule would have hidden it', () => {
    // All 4 hand-built levels done; level 5 is the first generated level and
    // is genuinely reachable right now, unlike resolveVisibleLevelIndices'
    // old "only show completed generated levels" rule.
    expect(resolveLevelMapIndices(4, [1, 2, 3, 4], 5)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('shows a fresh save\'s current level 1 plus its locked preview, with no completed history yet', () => {
    expect(resolveLevelMapIndices(4, [], 1)).toEqual([1, 2, 3, 4]);
  });

  test('still includes real completed generated-level history alongside the current preview', () => {
    expect(resolveLevelMapIndices(3, [1, 2, 3, 4, 6], 7)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10]);
  });

  test('never duplicates an index that is both real history and part of the lookahead window', () => {
    // Level 4 is both a hand-built level and would otherwise appear again in
    // the lookahead if it weren't deduplicated.
    expect(resolveLevelMapIndices(4, [1, 2, 3], 4)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('buildLevelSummary', () => {
  test('carries the real displayName and first objective target through', () => {
    const config = { displayName: 'Tomato Toss', objectives: [{ targetMatchType: 'tomato', targetCount: 15 }] };
    expect(buildLevelSummary(config, 1)).toEqual({
      levelIndex: 1,
      displayName: 'Tomato Toss',
      targetMatchType: 'tomato',
    });
  });

  test('falls back to "Level N" for a generated level with no displayName', () => {
    const config = { displayName: undefined, objectives: [{ targetMatchType: 'lemon', targetCount: 21 }] };
    expect(buildLevelSummary(config, 5)).toEqual({
      levelIndex: 5,
      displayName: 'Level 5',
      targetMatchType: 'lemon',
    });
  });

  test('uses only the first objective for a multi-objective level — row icon stays single', () => {
    const config = {
      displayName: 'Double Duty',
      objectives: [
        { targetMatchType: 'chili', targetCount: 26 },
        { targetMatchType: 'garlic', targetCount: 26 },
      ],
    };
    expect(buildLevelSummary(config, 10).targetMatchType).toBe('chili');
  });
});

describe('buildRecipeBookSubtitle', () => {
  test('a fresh recipe book with nothing collected yet', () => {
    expect(buildRecipeBookSubtitle(0, 9)).toBe('A fresh recipe book, ready when you are.');
  });

  test('stays plural even at a count of 1 — the "of 9" ratio already frames it as a pool', () => {
    expect(buildRecipeBookSubtitle(1, 9)).toBe('1 of 9 recipes collected.');
  });

  test('plural wording at 2', () => {
    expect(buildRecipeBookSubtitle(2, 9)).toBe('2 of 9 recipes collected.');
  });

  test('a completed collection gets its own line instead of "9 of 9"', () => {
    expect(buildRecipeBookSubtitle(9, 9)).toBe('Every recipe collected — the book is complete.');
  });

  test('no stars, numbers-as-badges, or urgency language beyond the plain count', () => {
    for (const count of [0, 1, 5, 9]) {
      const copy = buildRecipeBookSubtitle(count, 9);
      expect(copy).not.toMatch(/star|badge|tier|rank|hurry|limited/i);
    }
  });
});
