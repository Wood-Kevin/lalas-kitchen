import { diffBoards, relocateSwappedClears, resolveSwapMotionIds, MovedPiece } from './boardDiff';
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

describe('relocateSwappedClears', () => {
  const a = { row: 2, col: 3 };
  const b = { row: 2, col: 4 };
  const cleared = (id: string, row: number, col: number) => ({
    piece: piece(id, 'A'),
    from: { row, col },
  });

  test('a swapped-then-cleared tile exits from the cell the swap PUT it on', () => {
    // The dragged special (at posA before the move) came to rest on posB, which
    // is where the player's finger left it — so that's where its exit plays.
    const out = relocateSwappedClears([cleared('bomb', 2, 3)], a, b, true);
    expect(out[0].from).toEqual(b);
  });

  test('the partner cell is remapped the other way, not just the dragged one', () => {
    const out = relocateSwappedClears([cleared('partner', 2, 4)], a, b, true);
    expect(out[0].from).toEqual(a);
  });

  test('cells that were not part of the swap are untouched', () => {
    const others = [cleared('x', 0, 0), cleared('y', 5, 5)];
    expect(relocateSwappedClears(others, a, b, true)).toEqual(others);
  });

  test('no remap at all when the engine did not stage a swap', () => {
    // The position-independent detonations (solo color bomb, striped+bomb,
    // area+color) deliberately never move their pieces — see
    // ApplyMoveResult.swapCommitted. Remapping them would move an exit
    // animation off the cell the piece genuinely still occupies.
    const input = [cleared('bomb', 2, 3), cleared('partner', 2, 4)];
    expect(relocateSwappedClears(input, a, b, false)).toEqual(input);
  });

  test('returns a new array without mutating the input entries', () => {
    const input = [cleared('bomb', 2, 3)];
    const out = relocateSwappedClears(input, a, b, true);
    expect(out).not.toBe(input);
    expect(input[0].from).toEqual(a);
  });

  // The two ends of the slide. `from` is where the tile ENDS (and where its
  // effect is anchored); travelFrom is where it STARTS. Both are recorded here
  // because both are known here — without travelFrom the tile is simply
  // rendered at its destination, which is a full-cell jump in one frame rather
  // than the swap being animated at all.
  test('a swapped-then-cleared tile records BOTH ends, so it can slide instead of jump', () => {
    const out = relocateSwappedClears([cleared('bomb', 2, 3)], a, b, true);
    expect(out[0]).toMatchObject({ travelFrom: a, from: b });
  });

  test('the partner cell records its own two ends, mirrored', () => {
    const out = relocateSwappedClears([cleared('partner', 2, 4)], a, b, true);
    expect(out[0]).toMatchObject({ travelFrom: b, from: a });
  });

  test('a tile that was not swapped gets no travel — it clears where it stood', () => {
    const out = relocateSwappedClears([cleared('x', 0, 0)], a, b, true);
    expect(out[0].travelFrom).toBeUndefined();
  });

  test('a position-independent detonation grants no travel either', () => {
    // swapCommitted false means the engine never exchanged the cells, so both
    // pieces genuinely still occupy their own — there is nothing to travel.
    const out = relocateSwappedClears([cleared('bomb', 2, 3)], a, b, false);
    expect(out[0].travelFrom).toBeUndefined();
  });
});

describe('resolveSwapMotionIds (a tapped piece can fall further than its own swap)', () => {
  const tomato = piece('tomato-1', 'A');
  const garlic = piece('garlic-1', 'B');
  const moved = (p: Piece, from: [number, number], to: [number, number]): MovedPiece => ({
    piece: p,
    from: { row: from[0], col: from[1] },
    to: { row: to[0], col: to[1] },
  });

  test('a plain adjacent swap keeps both tapped pieces on the swap feel', () => {
    const tappedIds = new Set([tomato.id, garlic.id]);
    const movedList = [moved(tomato, [2, 3], [2, 4]), moved(garlic, [2, 4], [2, 3])];
    const result = resolveSwapMotionIds(tappedIds, movedList);
    expect(result).toEqual(new Set([tomato.id, garlic.id]));
  });

  test('a tapped piece that also fell from gravity in the same pass loses the swap feel', () => {
    // The match this swap formed cleared something above tomato-1's landing
    // column, so gravity dropped it three more rows within the SAME pass —
    // a real, common case (see engine/gameState.ts's resolveCascades), not
    // an edge case. It should render as a fall, not a bouncy 1-tile hop.
    const tappedIds = new Set([tomato.id, garlic.id]);
    const movedList = [moved(tomato, [2, 3], [5, 4]), moved(garlic, [2, 4], [2, 3])];
    const result = resolveSwapMotionIds(tappedIds, movedList);
    expect(result).toEqual(new Set([garlic.id]));
  });

  test('both tapped pieces can lose the swap feel if both fell further', () => {
    const tappedIds = new Set([tomato.id, garlic.id]);
    const movedList = [moved(tomato, [2, 3], [6, 3]), moved(garlic, [2, 4], [4, 4])];
    const result = resolveSwapMotionIds(tappedIds, movedList);
    expect(result).toEqual(new Set());
  });

  test('a tapped piece that cleared (absent from `moved`) defaults to the swap feel harmlessly', () => {
    // A cleared piece never reads swapDurationIds at all (it renders via
    // ExitingTile, driven by its own travelMs), so this default is inert —
    // it exists only so the function has a defined answer for every id.
    const tappedIds = new Set([tomato.id, garlic.id]);
    const movedList = [moved(garlic, [2, 4], [2, 3])];
    const result = resolveSwapMotionIds(tappedIds, movedList);
    expect(result.has(tomato.id)).toBe(true);
  });

  test('a diagonal-looking two-cell displacement is excluded, not just a straight fall', () => {
    // The distance test is Manhattan, not "did it only move vertically" —
    // it should correctly reject any total displacement over one cell.
    const tappedIds = new Set([tomato.id]);
    const movedList = [moved(tomato, [2, 3], [3, 4])];
    expect(resolveSwapMotionIds(tappedIds, movedList)).toEqual(new Set());
  });
});
