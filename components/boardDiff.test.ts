import { diffBoards } from './boardDiff';
import { Board, Piece } from '../engine/matrix';

function piece(id: string, matchType: string): Piece {
  return { id, type: 'normal', matchType };
}

function boardOf(rows: Piece[][]): Board {
  return rows;
}

describe('diffBoards', () => {
  test('identifies a cleared piece (present before, absent after)', () => {
    const before = boardOf([[piece('a', 'A'), piece('b', 'B'), piece('c', 'A')]]);
    const after = boardOf([[piece('d', 'A'), piece('b', 'B'), piece('c', 'A')]]);

    const diff = diffBoards(before, after);

    expect(diff.cleared).toEqual([{ piece: piece('a', 'A'), from: { row: 0, col: 0 } }]);
    expect(diff.spawned).toEqual([{ piece: piece('d', 'A'), to: { row: 0, col: 0 } }]);
    expect(diff.moved).toEqual([]);
  });

  test('identifies a piece that fell to a new position', () => {
    const before = boardOf([
      [piece('top', 'A')],
      [piece('mid', 'B')],
      [piece('bottom', 'C')],
    ]);
    const after = boardOf([
      [piece('new', 'D')],
      [piece('top', 'A')],
      [piece('mid', 'B')],
    ]);
    // 'bottom' cleared, 'top' and 'mid' each dropped one row, 'new' spawned at row 0.

    const diff = diffBoards(before, after);

    expect(diff.cleared).toEqual([{ piece: piece('bottom', 'C'), from: { row: 2, col: 0 } }]);
    expect(diff.spawned).toEqual([{ piece: piece('new', 'D'), to: { row: 0, col: 0 } }]);
    expect(diff.moved).toEqual([
      { piece: piece('top', 'A'), from: { row: 0, col: 0 }, to: { row: 1, col: 0 } },
      { piece: piece('mid', 'B'), from: { row: 1, col: 0 }, to: { row: 2, col: 0 } },
    ]);
  });

  test('an unchanged board produces no diff entries', () => {
    const board = boardOf([[piece('a', 'A'), piece('b', 'B')]]);
    const diff = diffBoards(board, board);

    expect(diff).toEqual({ cleared: [], moved: [], spawned: [] });
  });
});
