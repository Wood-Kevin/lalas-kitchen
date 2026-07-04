import {
  buildLevelSummary,
  buildProgressCopy,
  buildProgressDots,
  resolveLevelDisplayName,
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
    expect(resolveLevelStatus(2, [1, 2, 3])).toBe('completed');
  });

  test('a level not in completedLevels reports locked', () => {
    expect(resolveLevelStatus(5, [1, 2, 3])).toBe('locked');
  });

  test('an empty completedLevels locks every level', () => {
    expect(resolveLevelStatus(1, [])).toBe('locked');
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

describe('buildLevelSummary', () => {
  test('carries the real displayName and objective target through', () => {
    const config = { displayName: 'Tomato Toss', objective: { targetMatchType: 'tomato', targetCount: 15 } };
    expect(buildLevelSummary(config, 1)).toEqual({
      levelIndex: 1,
      displayName: 'Tomato Toss',
      targetMatchType: 'tomato',
    });
  });

  test('falls back to "Level N" for a generated level with no displayName', () => {
    const config = { displayName: undefined, objective: { targetMatchType: 'lemon', targetCount: 21 } };
    expect(buildLevelSummary(config, 5)).toEqual({
      levelIndex: 5,
      displayName: 'Level 5',
      targetMatchType: 'lemon',
    });
  });
});

describe('buildProgressCopy', () => {
  test('a fresh recipe book with nothing cooked yet', () => {
    expect(buildProgressCopy(0, 24)).toBe('A fresh recipe book, ready when you are.');
  });

  test('mid-progress uses the real counts, singular recipe wording at 1', () => {
    expect(buildProgressCopy(1, 24)).toBe('1 recipe cooked, 23 still waiting on the shelf. No hurry.');
    expect(buildProgressCopy(11, 24)).toBe('11 recipes cooked, 13 still waiting on the shelf. No hurry.');
  });

  test('every real level completed reads as fully caught up', () => {
    expect(buildProgressCopy(24, 24)).toBe('Every recipe cooked. The kitchen smells wonderful.');
  });

  test('a zero total (no hand-built levels at all) does not divide or go negative', () => {
    expect(buildProgressCopy(0, 0)).toBe('A fresh recipe book, ready when you are.');
  });
});

describe('buildProgressDots', () => {
  test('marks exactly the completed count as filled, in order', () => {
    expect(buildProgressDots(2, 5)).toEqual([true, true, false, false, false]);
  });

  test('all empty when nothing is completed', () => {
    expect(buildProgressDots(0, 3)).toEqual([false, false, false]);
  });

  test('all filled when completedCount meets totalCount', () => {
    expect(buildProgressDots(4, 4)).toEqual([true, true, true, true]);
  });
});
