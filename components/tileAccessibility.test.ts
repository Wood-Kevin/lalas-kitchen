import { describeTileForAccessibility } from './tileAccessibility';
import { Piece } from '../engine/matrix';

describe('describeTileForAccessibility', () => {
  test('an ordinary piece reads its ingredient and 1-indexed position', () => {
    const piece: Piece = { id: 'a', type: 'normal', matchType: 'tomato' };
    expect(describeTileForAccessibility(piece, 0, 0)).toBe('Tomato, row 1, column 1');
    expect(describeTileForAccessibility(piece, 2, 3)).toBe('Tomato, row 3, column 4');
  });

  test('capitalizes and de-underscores a multi-word matchType', () => {
    const piece: Piece = { id: 'a', type: 'normal', matchType: 'dish_stack' };
    expect(describeTileForAccessibility(piece, 0, 0)).toBe('Dish stack, row 1, column 1');
  });

  test('a plain blocker reads as a covered dish with its real hit count', () => {
    const blocker: Piece = { id: 'a', type: 'blocker', matchType: 'cling', hitsRemaining: 1 };
    expect(describeTileForAccessibility(blocker, 0, 0)).toBe('Covered dish, 1 hit to clear, row 1, column 1');

    const twoHit: Piece = { id: 'b', type: 'blocker', matchType: 'pot_lid', hitsRemaining: 2 };
    expect(describeTileForAccessibility(twoHit, 0, 0)).toBe('Covered dish, 2 hits to clear, row 1, column 1');
  });

  test('a specialOnly blocker reads as a sealed jar, matching its own tutorial copy', () => {
    const jar: Piece = { id: 'a', type: 'blocker', matchType: 'sealed_jar', hitsRemaining: 1, specialOnly: true };
    expect(describeTileForAccessibility(jar, 0, 0)).toBe('Sealed jar, 1 hit to clear, row 1, column 1');
  });

  test('a striped piece names its base ingredient and sweep direction', () => {
    const rowStripe: Piece = { id: 'a', type: 'striped', matchType: 'lemon', direction: 'row' };
    expect(describeTileForAccessibility(rowStripe, 0, 0)).toBe('Striped lemon, sweeps its row, row 1, column 1');

    const colStripe: Piece = { id: 'b', type: 'striped', matchType: 'lemon', direction: 'col' };
    expect(describeTileForAccessibility(colStripe, 0, 0)).toBe('Striped lemon, sweeps its column, row 1, column 1');
  });

  test('colorless specials read by their player-facing name, not their internal type string', () => {
    const bomb: Piece = { id: 'a', type: 'color_bomb' };
    expect(describeTileForAccessibility(bomb, 0, 0)).toBe('Color bomb, row 1, column 1');

    const area: Piece = { id: 'b', type: 'area_bomb' };
    expect(describeTileForAccessibility(area, 0, 0)).toBe('Area blast, row 1, column 1');

    const dropdown: Piece = { id: 'c', type: 'dropdown' };
    expect(describeTileForAccessibility(dropdown, 0, 0)).toBe('Delivery basket, row 1, column 1');
  });

  test('falls back to a generic label if an ordinary piece somehow has no matchType', () => {
    const piece: Piece = { id: 'a', type: 'normal' };
    expect(describeTileForAccessibility(piece, 0, 0)).toBe('Ingredient, row 1, column 1');
  });
});
