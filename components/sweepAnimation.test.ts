import { sweepDelaysForClears } from './sweepAnimation';
import { ClearedPiece } from './boardDiff';
import { Piece, StripeDirection } from '../engine/matrix';

function normal(id: string, matchType: string): Piece {
  return { id, type: 'normal', matchType };
}

function striped(id: string, matchType: string, direction: StripeDirection): Piece {
  return { id, type: 'striped', matchType, direction };
}

function cleared(piece: Piece, row: number, col: number): ClearedPiece {
  return { piece, from: { row, col } };
}

const STAGGER = 50;

describe('sweepDelaysForClears', () => {
  test('no striped piece in the pass yields no delays (ordinary clear)', () => {
    const delays = sweepDelaysForClears(
      [cleared(normal('a', 'A'), 0, 0), cleared(normal('b', 'A'), 0, 1)],
      STAGGER
    );
    expect(delays.size).toBe(0);
  });

  test('a row sweep staggers by horizontal distance from the striped piece, and every tile gets the row axis', () => {
    // Striped piece at (2,1) sweeps its row; the whole row cleared this pass.
    const row = [
      cleared(striped('s', 'A', 'row'), 2, 1),
      cleared(normal('c0', 'A'), 2, 0),
      cleared(normal('c2', 'B'), 2, 2),
      cleared(normal('c3', 'C'), 2, 3),
      cleared(normal('c4', 'D'), 2, 4),
    ];

    const delays = sweepDelaysForClears(row, STAGGER);

    expect(delays.get('s')).toEqual({ delayMs: 0, axis: 'row' }); // the origin pops first
    expect(delays.get('c0')).toEqual({ delayMs: 1 * STAGGER, axis: 'row' }); // one tile left
    expect(delays.get('c2')).toEqual({ delayMs: 1 * STAGGER, axis: 'row' }); // one tile right
    expect(delays.get('c3')).toEqual({ delayMs: 2 * STAGGER, axis: 'row' });
    expect(delays.get('c4')).toEqual({ delayMs: 3 * STAGGER, axis: 'row' }); // furthest, last
  });

  test('a column sweep staggers by vertical distance, and every tile gets the col axis', () => {
    const col = [
      cleared(striped('s', 'A', 'col'), 0, 3),
      cleared(normal('r1', 'A'), 1, 3),
      cleared(normal('r3', 'B'), 3, 3),
    ];

    const delays = sweepDelaysForClears(col, STAGGER);

    expect(delays.get('s')).toEqual({ delayMs: 0, axis: 'col' });
    expect(delays.get('r1')).toEqual({ delayMs: 1 * STAGGER, axis: 'col' });
    expect(delays.get('r3')).toEqual({ delayMs: 3 * STAGGER, axis: 'col' });
  });

  test('the off-axis cells of the triggering match get no delay (clear immediately)', () => {
    // A vertical striped piece triggered by a horizontal 3-run: the two run
    // cells beside it are off the swept column, so they are not part of the beam.
    const pass = [
      cleared(striped('s', 'A', 'col'), 2, 2), // sweeps column 2
      cleared(normal('rowmate-l', 'A'), 2, 1), // triggering run, off-column
      cleared(normal('rowmate-r', 'A'), 2, 3), // triggering run, off-column
      cleared(normal('colmate', 'B'), 4, 2), // on the swept column
    ];

    const delays = sweepDelaysForClears(pass, STAGGER);

    expect(delays.has('rowmate-l')).toBe(false);
    expect(delays.has('rowmate-r')).toBe(false);
    expect(delays.get('s')).toEqual({ delayMs: 0, axis: 'col' });
    expect(delays.get('colmate')).toEqual({ delayMs: 2 * STAGGER, axis: 'col' });
  });

  test('a tile on two crossing beams takes the nearest origin, axis included', () => {
    // A row-sweeper at (3,0) and a column-sweeper at (0,3) both cross (3,3).
    const pass = [
      cleared(striped('sr', 'A', 'row'), 3, 0),
      cleared(striped('sc', 'B', 'col'), 0, 3),
      cleared(normal('x', 'C'), 3, 3),
    ];

    const delays = sweepDelaysForClears(pass, STAGGER);

    // From the row origin: |3-0| = 3 tiles. From the column origin: |3-0| = 3
    // tiles. Equal here, so 3 either way — assert the min is taken, and that
    // the winning axis is whichever origin actually won (the row scan runs
    // first in nearestSweepOrigin's loop, so ties resolve to the row axis —
    // pinning this down so a future refactor can't silently flip it).
    expect(delays.get('x')).toEqual({ delayMs: 3 * STAGGER, axis: 'row' });
  });

  test('a blocker on the swept line keeps its own beat (no sweep delay)', () => {
    const pass = [
      cleared(striped('s', 'A', 'row'), 1, 1),
      cleared({ id: 'blk', type: 'blocker', matchType: 'A', hitsRemaining: 0 }, 1, 3),
    ];

    const delays = sweepDelaysForClears(pass, STAGGER);

    expect(delays.get('s')).toEqual({ delayMs: 0, axis: 'row' });
    expect(delays.has('blk')).toBe(false);
  });
});
