import { buildExitingEntry, exitingTileSprite, resolveEffectColor } from './exitingTile';
import { getSpriteForMatchType } from './spriteMap';
import { resolveSpriteAsset } from './spriteAsset';
import { SkinConfig } from './skinConfig';
import { Piece } from '../engine/matrix';
import { Position } from '../engine/gameState';

// Same minimal shape spriteMap.test.ts uses. tomato must map to a base sprite
// so a striped tomato can resolve to its striped_ variant.
const config: SkinConfig = {
  skinId: 'test-skin',
  pieceTypes: [
    { id: 'tomato', sprite: 'tomato.webp' },
    { id: 'lemon', sprite: 'lemon.webp' },
  ],
  blockers: [{ id: 'cling', sprite: 'cling.webp', hitsToClear: 1 }],
  lives: { max: 5, regenMinutes: 30, icon: 'flame.webp' },
  animationProfile: { matchStyle: 'popAndShrink', matchDurationMs: 220, cascadeFallSpeed: 'medium', swapDurationMs: 140 },
  palette: {
    background: ['#fff', '#eee'], panel: '#fff', accent: '#000',
    secondaryAccent: '#0a0', secondaryAccentText: '#070', mutedText: '#333', border: '#ccc', text: '#111',
    effectColors: { blocker: '#eb0', sweep: '#0be', areaBomb: '#036', colorBomb: '#80e', supercombo: '#b06' },
    tray: { background: '#a87', border: '#751', chipBorder: '#db7' },
  },
  recipeCards: [],
};

const from: Position = { row: 2, col: 3 };

// The exact piece shapes these two special types have when they land in
// diffBoards' `cleared` list: a color bomb is colorless (no matchType); a swept
// striped piece keeps its base matchType and carries a direction.
const colorBomb: Piece = { id: 'b1', type: 'color_bomb' };
const stripedTomato: Piece = { id: 's1', type: 'striped', matchType: 'tomato', direction: 'row' };

describe('buildExitingEntry threads the full piece type through', () => {
  test('a color bomb carries pieceType, not just its (absent) matchType', () => {
    const entry = buildExitingEntry(colorBomb, from, 7, undefined);
    expect(entry.pieceType).toBe('color_bomb');
    expect(entry.matchType).toBeUndefined();
    // The rest of the entry is carried faithfully from the piece / call args.
    expect(entry).toMatchObject({ key: 'b1-7', pieceId: 'b1', row: 2, col: 3, isBlockerClear: false });
  });

  test('a striped piece carries its striped type alongside its base matchType', () => {
    const entry = buildExitingEntry(stripedTomato, from, 7, 40);
    expect(entry.pieceType).toBe('striped');
    expect(entry.matchType).toBe('tomato');
    expect(entry.sweepDelayMs).toBe(40);
  });
});

describe('exitingTileSprite resolves through getSpriteForPiece using the full type', () => {
  test('a detonating color bomb resolves to its fixed sprite, not the "?" placeholder', () => {
    const entry = buildExitingEntry(colorBomb, from, 7, undefined);
    // The fix: full-type resolution gives the real color_bomb sprite key.
    expect(exitingTileSprite(entry, config)).toBe('color_bomb');
    // Contrast — the old matchType-only lookup this replaced: a bomb has no
    // matchType, so it resolved to undefined, which resolveSpriteAsset turns
    // into the spriteLabel("?") fallback. That regression is what a revert
    // would reintroduce.
    expect(getSpriteForMatchType(entry.matchType, config)).toBeUndefined();
    expect(resolveSpriteAsset(getSpriteForMatchType(entry.matchType, config), {})).toEqual({ kind: 'label', label: '?' });
  });

  test('a swept striped piece resolves to its striped_ art, not the plain base sprite', () => {
    const entry = buildExitingEntry(stripedTomato, from, 7, 40);
    // The fix: full-type resolution keeps the stripe.
    expect(exitingTileSprite(entry, config)).toBe('striped_tomato.webp');
    // Contrast — the old matchType-only lookup dropped the stripe and degraded
    // the tile to the plain base sprite mid-sweep.
    expect(getSpriteForMatchType(entry.matchType, config)).toBe('tomato.webp');
  });

  test('an ordinary piece still resolves to its plain sprite (no regression for the common case)', () => {
    const entry = buildExitingEntry({ id: 'n1', type: 'normal', matchType: 'tomato' }, from, 7, undefined);
    expect(exitingTileSprite(entry, config)).toBe('tomato.webp');
  });
});

describe('buildExitingEntry travel (a swapped-and-cleared tile slides before it pops)', () => {
  const swapped = { row: 4, col: 2 };

  test('carries both ends and the slide duration when the piece was swapped', () => {
    const entry = buildExitingEntry({ id: 'n1', type: 'normal', matchType: 'tomato' }, from, 7, undefined, undefined, undefined, {
      from: swapped,
      durationMs: 220,
    });
    // row/col stay the RESTING cell (where the effect is anchored); fromRow/
    // fromCol are where the slide starts.
    expect(entry).toMatchObject({
      row: from.row,
      col: from.col,
      fromRow: swapped.row,
      fromCol: swapped.col,
      travelMs: 220,
    });
  });

  test('every clear that did not come from a swap has no travel at all', () => {
    // This is the overwhelmingly common case — a cascade refill, a swept tile,
    // a blast victim. Leaving these undefined is what makes ExitingTile's
    // timing byte-identical to before for them.
    const entry = buildExitingEntry({ id: 'n1', type: 'normal', matchType: 'tomato' }, from, 7, undefined);
    expect(entry.fromRow).toBeUndefined();
    expect(entry.fromCol).toBeUndefined();
    expect(entry.travelMs).toBeUndefined();
  });

  test('travel composes with a sweep delay rather than replacing it', () => {
    // A swapped striped piece both travels AND is the origin of its own sweep.
    const entry = buildExitingEntry(stripedTomato, from, 7, 0, undefined, undefined, {
      from: swapped,
      durationMs: 220,
    });
    expect(entry.travelMs).toBe(220);
    expect(entry.sweepDelayMs).toBe(0);
  });
});

describe('buildExitingEntry drag-release offset (a dragged tile that clears must not lose its finger-follow position)', () => {
  const swapped = { row: 4, col: 2 };

  test('carries the drag release offset when the dragged piece itself cleared', () => {
    const entry = buildExitingEntry(
      { id: 'n1', type: 'normal', matchType: 'tomato' },
      from,
      7,
      undefined,
      undefined,
      undefined,
      { from: swapped, durationMs: 220 },
      { dx: -82, dy: 3 }
    );
    expect(entry.startOffsetPx).toEqual({ dx: -82, dy: 3 });
  });

  test('every other clear — a tap, a fall, the swap partner — has no offset at all', () => {
    // This is the overwhelmingly common case. Leaving it undefined is what
    // keeps ExitingTile's starting position byte-identical to before this
    // fix for every clear that isn't the exact dragged-and-cleared piece.
    const entry = buildExitingEntry({ id: 'n1', type: 'normal', matchType: 'tomato' }, from, 7, undefined);
    expect(entry.startOffsetPx).toBeUndefined();
  });

  test('a swap-committed clear with no drag (a tap) still gets no offset', () => {
    const entry = buildExitingEntry(
      { id: 'n1', type: 'normal', matchType: 'tomato' },
      from,
      7,
      undefined,
      undefined,
      undefined,
      { from: swapped, durationMs: 220 }
      // dragReleasePx omitted, exactly as Board.tsx's tap path calls this.
    );
    expect(entry.startOffsetPx).toBeUndefined();
  });
});

describe('resolveEffectColor (the visual-reward-language spec: one color per mechanism)', () => {
  const palette = {
    accent: '#red',
    effectColors: {
      blocker: '#gold',
      sweep: '#teal',
      areaBomb: '#navy',
      colorBomb: '#violet',
      supercombo: '#wine',
    },
  } as never;

  test('an ordinary match (no flags set) keeps the plain skin accent, unchanged', () => {
    expect(resolveEffectColor({ isBlockerClear: false, convertedFlash: undefined, radialDelayMs: undefined, radialKind: undefined, sweepDelayMs: undefined }, palette)).toBe('#red');
  });

  test('a blocker clear gets its own color even if it also carries a sweep delay', () => {
    expect(resolveEffectColor({ isBlockerClear: true, convertedFlash: undefined, radialDelayMs: undefined, radialKind: undefined, sweepDelayMs: 40 }, palette)).toBe('#gold');
  });

  test('a striped sweep gets the sweep color', () => {
    expect(resolveEffectColor({ isBlockerClear: false, convertedFlash: undefined, radialDelayMs: undefined, radialKind: undefined, sweepDelayMs: 40 }, palette)).toBe('#teal');
  });

  test('a color bomb wave (radialKind color_bomb, or undefined - the historical default) gets the color-bomb color', () => {
    expect(resolveEffectColor({ isBlockerClear: false, convertedFlash: undefined, radialDelayMs: 20, radialKind: 'color_bomb', sweepDelayMs: undefined }, palette)).toBe('#violet');
    expect(resolveEffectColor({ isBlockerClear: false, convertedFlash: undefined, radialDelayMs: 20, radialKind: undefined, sweepDelayMs: undefined }, palette)).toBe('#violet');
  });

  test('an area bomb blast (radialKind area_bomb) gets its own distinct color, not the color-bomb one', () => {
    expect(resolveEffectColor({ isBlockerClear: false, convertedFlash: undefined, radialDelayMs: 20, radialKind: 'area_bomb', sweepDelayMs: undefined }, palette)).toBe('#navy');
  });

  test('a supercombo converted piece gets its own color even though it also carries a sweep delay', () => {
    expect(resolveEffectColor({ isBlockerClear: false, convertedFlash: true, radialDelayMs: undefined, radialKind: undefined, sweepDelayMs: 170 }, palette)).toBe('#wine');
  });
});
