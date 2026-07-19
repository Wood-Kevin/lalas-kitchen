import {
  resolveSpecialEffectDescriptor,
  radialDelaysForClears,
  crossOriginDelays,
  supercomboConvertedIds,
  buildPassAnimation,
} from './specialEffectAnimation';
import { ClearedPiece } from './boardDiff';
import { Board, Piece } from '../engine/matrix';

function normal(id: string, matchType: string): Piece {
  return { id, type: 'normal', matchType };
}
function striped(id: string, matchType: string, direction: 'row' | 'col'): Piece {
  return { id, type: 'striped', matchType, direction };
}
function bomb(id: string): Piece {
  return { id, type: 'color_bomb' };
}
function area(id: string): Piece {
  return { id, type: 'area_bomb' };
}
function cleared(piece: Piece, row: number, col: number): ClearedPiece {
  return { piece, from: { row, col } };
}

function boardOf(cells: Record<string, Piece>, rows = 3, cols = 3): Board {
  const board: Board = [];
  for (let r = 0; r < rows; r++) {
    const row: Piece[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(cells[`${r},${c}`] ?? normal(`filler-${r}-${c}`, 'Z'));
    }
    board.push(row);
  }
  return board;
}

describe('resolveSpecialEffectDescriptor', () => {
  test('striped + color bomb (either order) resolves to supercombo with the striped matchType as target', () => {
    const board = boardOf({ '1,1': striped('s1', 'tomato', 'row'), '1,2': bomb('b1') });
    expect(resolveSpecialEffectDescriptor(board, { row: 1, col: 1 }, { row: 1, col: 2 })).toEqual({
      kind: 'supercombo',
      bombPieceId: 'b1',
      targetMatchType: 'tomato',
    });
    // Order reversed: same result.
    expect(resolveSpecialEffectDescriptor(board, { row: 1, col: 2 }, { row: 1, col: 1 })).toEqual({
      kind: 'supercombo',
      bombPieceId: 'b1',
      targetMatchType: 'tomato',
    });
  });

  test('striped + striped resolves to a cross centered on posA', () => {
    const board = boardOf({ '1,1': striped('sA', 'tomato', 'row'), '1,2': striped('sB', 'lemon', 'col') });
    expect(resolveSpecialEffectDescriptor(board, { row: 1, col: 1 }, { row: 1, col: 2 })).toEqual({
      kind: 'striped_cross',
      origin: { row: 1, col: 1 },
    });
  });

  test('color bomb + ordinary resolves to a solo detonation centered on the bomb', () => {
    const board = boardOf({ '0,0': bomb('b1'), '0,1': normal('n1', 'tomato') });
    expect(resolveSpecialEffectDescriptor(board, { row: 0, col: 0 }, { row: 0, col: 1 })).toEqual({
      kind: 'color_bomb',
      origin: { row: 0, col: 0 },
    });
    // Swapped positions: origin follows the bomb, not posA specifically.
    expect(resolveSpecialEffectDescriptor(board, { row: 0, col: 1 }, { row: 0, col: 0 })).toEqual({
      kind: 'color_bomb',
      origin: { row: 0, col: 0 },
    });
  });

  test('an ordinary swap resolves to no special effect', () => {
    const board = boardOf({ '0,0': normal('n1', 'tomato'), '0,1': normal('n2', 'lemon') });
    expect(resolveSpecialEffectDescriptor(board, { row: 0, col: 0 }, { row: 0, col: 1 })).toBeUndefined();
  });

  test('any area-bomb swap resolves to no special effect here, mirroring applyMove checking area first', () => {
    const board = boardOf({ '0,0': area('a1'), '0,1': bomb('b1') });
    expect(resolveSpecialEffectDescriptor(board, { row: 0, col: 0 }, { row: 0, col: 1 })).toBeUndefined();
    const ordinary = boardOf({ '0,0': area('a1'), '0,1': normal('n1', 'tomato') });
    expect(resolveSpecialEffectDescriptor(ordinary, { row: 0, col: 0 }, { row: 0, col: 1 })).toBeUndefined();
  });
});

describe('radialDelaysForClears', () => {
  test('normalizes distance to a fixed total wave duration regardless of board size', () => {
    const origin = { row: 0, col: 0 };
    const pass = [
      cleared(normal('near', 'A'), 0, 0), // distance 0
      cleared(normal('mid', 'A'), 3, 0), // distance 3
      cleared(normal('far', 'A'), 6, 0), // distance 6 (the max this pass)
    ];
    const delays = radialDelaysForClears(pass, origin, 300);
    expect(delays.get('near')).toBe(0);
    expect(delays.get('mid')).toBe(150);
    expect(delays.get('far')).toBe(300);
  });

  test('a single cleared cell (max distance 0) never divides by zero', () => {
    const delays = radialDelaysForClears([cleared(normal('only', 'A'), 2, 2)], { row: 2, col: 2 }, 300);
    expect(delays.get('only')).toBe(0);
  });

  test('a blocker keeps its own beat, excluded like the linear sweep', () => {
    const pass = [cleared({ id: 'blk', type: 'blocker', matchType: 'A', hitsRemaining: 0 }, 5, 5)];
    const delays = radialDelaysForClears(pass, { row: 0, col: 0 }, 300);
    expect(delays.has('blk')).toBe(false);
  });
});

describe('crossOriginDelays', () => {
  test('staggers both the row and column through one origin, regardless of each piece\'s own direction', () => {
    const origin = { row: 2, col: 2 };
    const pass = [
      cleared(striped('sA', 'tomato', 'col'), 2, 2), // origin itself, direction irrelevant here
      cleared(striped('sB', 'lemon', 'col'), 2, 4), // on the ROW half, despite carrying 'col'
      cleared(normal('r1', 'A'), 0, 2), // on the column half
    ];
    const delays = crossOriginDelays(pass, origin, 50);
    expect(delays.get('sA')).toBe(0);
    expect(delays.get('sB')).toBe(2 * 50); // row distance, not ignored the way a 'col'-only sweep origin would
    expect(delays.get('r1')).toBe(2 * 50); // column distance
  });

  test('a cell off both axes gets no delay', () => {
    const delays = crossOriginDelays([cleared(normal('off', 'A'), 5, 5)], { row: 2, col: 2 }, 50);
    expect(delays.has('off')).toBe(false);
  });
});

describe('supercomboConvertedIds', () => {
  test('every cleared cell matching the target color counts, except the bomb cell', () => {
    const pass = [
      cleared(bomb('b1'), 1, 1),
      cleared(normal('n1', 'tomato'), 0, 1),
      cleared(normal('n2', 'tomato'), 2, 1),
      cleared(normal('n3', 'lemon'), 1, 0),
    ];
    const ids = supercomboConvertedIds(pass, 'tomato', 'b1');
    expect(ids).toEqual(new Set(['n1', 'n2']));
  });

  test('an undefined target (degenerate) converts nothing', () => {
    const pass = [cleared(normal('n1', 'tomato'), 0, 0)];
    expect(supercomboConvertedIds(pass, undefined, 'b1').size).toBe(0);
  });
});

describe('buildPassAnimation', () => {
  const options = { perTileStaggerMs: 50, radialWaveMs: 300, supercomboConvertMs: 170, chainLinkStaggerMs: 260 };

  test('later passes always fall back to the plain generic sweep, no effect applied', () => {
    const pass = [cleared(striped('s', 'A', 'row'), 1, 1), cleared(normal('c', 'A'), 1, 2)];
    const result = buildPassAnimation(pass, 1, { kind: 'color_bomb', origin: { row: 0, col: 0 } }, options);
    expect(result.radialDelays.size).toBe(0);
    expect(result.convertedFlashIds.size).toBe(0);
    expect(result.sweepDelays.get('c')).toBe(50); // the ordinary sweep still applies
  });

  test('color bomb pass populates radialDelays and leaves sweepDelays generic', () => {
    const pass = [cleared(normal('n', 'A'), 0, 3)];
    const result = buildPassAnimation(pass, 0, { kind: 'color_bomb', origin: { row: 0, col: 0 } }, options);
    expect(result.radialDelays.get('n')).toBe(300);
    expect(result.sweepDelays.size).toBe(0);
  });

  test('striped_cross pass merges cross geometry with any chained real sweep', () => {
    const pass = [
      cleared(normal('cross-cell', 'A'), 0, 2), // on the cross's column, no real striped origin nearby
      cleared(striped('chained', 'B', 'row'), 5, 5), // an unrelated chained special elsewhere
      cleared(normal('chained-mate', 'B'), 5, 7),
    ];
    const result = buildPassAnimation(pass, 0, { kind: 'striped_cross', origin: { row: 0, col: 0 } }, options);
    expect(result.sweepDelays.get('cross-cell')).toBe(2 * 50);
    expect(result.sweepDelays.get('chained-mate')).toBe(2 * 50); // its own real chained sweep, untouched
  });

  test('supercombo pass pulls converted cells + bomb out of the generic sweep into one synchronized delay', () => {
    const pass = [
      cleared(bomb('b1'), 1, 1),
      cleared(normal('n1', 'tomato'), 0, 1),
      cleared(normal('n2', 'tomato'), 2, 1),
      cleared(striped('other', 'lemon', 'col'), 5, 5), // a different-color chained special
      cleared(normal('other-mate', 'lemon'), 6, 5),
    ];
    const result = buildPassAnimation(
      pass,
      0,
      { kind: 'supercombo', bombPieceId: 'b1', targetMatchType: 'tomato' },
      options
    );
    expect(result.convertedFlashIds).toEqual(new Set(['n1', 'n2']));
    expect(result.sweepDelays.get('n1')).toBe(170);
    expect(result.sweepDelays.get('n2')).toBe(170);
    expect(result.sweepDelays.get('b1')).toBe(170);
    // The unrelated chained striped piece keeps its own authentic sweep delay.
    expect(result.sweepDelays.get('other-mate')).toBe(1 * 50);
  });

  // Per-link chain staging (see applyChainStaging and engine/gameState.ts's
  // ApplyMoveResult.chainWaveByPieceId): each chain wave's cells start one
  // calm beat after the wave that caught them.
  describe('chain staging', () => {
    test('a chainless pass (no wave map) is byte-identical to before and holds nothing', () => {
      const pass = [cleared(striped('s', 'A', 'row'), 1, 1), cleared(normal('c', 'A'), 1, 3)];
      const result = buildPassAnimation(pass, 1, undefined, options);
      expect(result.sweepDelays.get('c')).toBe(2 * 50);
      expect(result.chainHoldMs).toBe(0);
    });

    test('wave offsets add to the existing sweep delay, preserving the link\'s own travel identity', () => {
      // A chained striped piece (wave 1) whose swept cell also carries its own
      // distance stagger: total delay = wave offset + within-link travel.
      const pass = [
        cleared(striped('caught', 'B', 'row'), 2, 2), // wave 1: the caught special itself
        cleared(normal('swept', 'C'), 2, 5), // wave 2: a cell its sweep cleared, 3 tiles out
      ];
      const waves = { caught: 1, swept: 2 };
      const result = buildPassAnimation(pass, 1, undefined, options, waves);
      expect(result.sweepDelays.get('caught')).toBe(1 * 260); // the special pops when its wave arrives
      expect(result.sweepDelays.get('swept')).toBe(2 * 260 + 3 * 50); // wave offset + its own beam travel
      expect(result.chainHoldMs).toBe(2 * 260);
    });

    test('a color-bomb pass adds the wave offset to the radial channel for cells already riding the ripple', () => {
      const pass = [
        cleared(normal('seed', 'A'), 0, 3), // the detonation's own cell — wave 0, no entry
        cleared(normal('link', 'D'), 0, 1), // cleared by a caught special at wave 1
      ];
      const result = buildPassAnimation(
        pass,
        0,
        { kind: 'color_bomb', origin: { row: 0, col: 0 } },
        options,
        { link: 1 }
      );
      // seed keeps its pure radial delay (furthest cell = full wave = 300).
      expect(result.radialDelays.get('seed')).toBe(300);
      // link's radial delay (1/3 of max distance = 100) gains the wave offset.
      expect(result.radialDelays.get('link')).toBe(100 + 260);
      expect(result.chainHoldMs).toBe(260);
    });

    test('a dual-channel cell (both sweep and radial) stages the SWEEP entry — the channel ExitingTile actually plays', () => {
      // The exact case the live capture caught: a color-bomb detonation whose
      // chain catches a striped piece. The striped's swept cells carry BOTH a
      // generic sweep delay (from the caught striped origin) and a radial
      // delay (the ripple covers every cleared cell) — Tile.tsx's ExitingTile
      // plays sweep first, so the wave offset must land there or the staging
      // silently doesn't play.
      const pass = [
        cleared(striped('caught', 'A', 'col'), 4, 2), // wave 1, on the detonation
        cleared(normal('swept', 'B'), 2, 2), // its swept cell, 2 tiles up: sweep 2*50, plus a radial entry
      ];
      const result = buildPassAnimation(
        pass,
        0,
        { kind: 'color_bomb', origin: { row: 0, col: 0 } },
        options,
        { caught: 1, swept: 2 }
      );
      // Both cells have radial entries (the ripple covers all cleared cells)…
      expect(result.radialDelays.has('caught')).toBe(true);
      expect(result.radialDelays.has('swept')).toBe(true);
      // …but the offsets landed on the sweep channel ExitingTile plays:
      // 'swept' keeps its own beam travel (2 tiles × 50) plus its wave offset.
      expect(result.sweepDelays.get('swept')).toBe(2 * 50 + 2 * 260);
      // 'caught' (the striped origin itself, distance 0 on its own beam) gets
      // its wave offset on the sweep channel too.
      expect(result.sweepDelays.get('caught')).toBe(0 + 1 * 260);
      expect(result.chainHoldMs).toBe(2 * 260);
    });

    test('waves belonging to a different pass\'s cells are ignored by this pass', () => {
      const pass = [cleared(normal('mine', 'A'), 0, 0)];
      const result = buildPassAnimation(pass, 1, undefined, options, { theirs: 3 });
      expect(result.sweepDelays.has('theirs')).toBe(false);
      expect(result.chainHoldMs).toBe(0);
    });
  });
});
