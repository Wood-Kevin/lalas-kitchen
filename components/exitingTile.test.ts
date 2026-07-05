import { buildExitingEntry, exitingTileSprite } from './exitingTile';
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
    secondaryAccent: '#0a0', mutedText: '#333', border: '#ccc', text: '#111',
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
