import { getSpriteForMatchType, getSpriteForPiece } from './spriteMap';
import { resolveSpriteAsset } from './spriteAsset';
import { SkinConfig } from './skinConfig';

const sampleConfig: SkinConfig = {
  skinId: 'test-skin',
  pieceTypes: [
    { id: 'tomato', sprite: 'tomato.svg' },
    { id: 'lemon', sprite: 'lemon.svg' },
  ],
  blockers: [{ id: 'cling', sprite: 'cling.svg', hitsToClear: 1 }],
  lives: { max: 5, regenMinutes: 30, icon: 'flame.svg' },
  animationProfile: {
    matchStyle: 'popAndShrink',
    matchDurationMs: 220,
    cascadeFallSpeed: 'medium',
    swapDurationMs: 140,
  },
  palette: {
    background: ['#fff', '#eee'],
    panel: '#fff',
    accent: '#000',
    secondaryAccent: '#0a0',
    mutedText: '#333',
    border: '#ccc',
    text: '#111',
  },
  recipeCards: [],
};

describe('getSpriteForMatchType', () => {
  test('resolves a normal piece type sprite by id', () => {
    expect(getSpriteForMatchType('tomato', sampleConfig)).toBe('tomato.svg');
  });

  test('resolves a blocker sprite by id', () => {
    expect(getSpriteForMatchType('cling', sampleConfig)).toBe('cling.svg');
  });

  test('returns undefined for an id not present in the config', () => {
    expect(getSpriteForMatchType('nonexistent', sampleConfig)).toBeUndefined();
  });

  test('returns undefined when matchType itself is undefined', () => {
    expect(getSpriteForMatchType(undefined, sampleConfig)).toBeUndefined();
  });
});

describe('getSpriteForPiece', () => {
  test('a normal piece resolves to its plain base sprite', () => {
    expect(getSpriteForPiece({ type: 'normal', matchType: 'tomato' }, sampleConfig)).toBe('tomato.svg');
  });

  test('a striped piece resolves to the striped_ variant of its base sprite', () => {
    expect(getSpriteForPiece({ type: 'striped', matchType: 'tomato' }, sampleConfig)).toBe('striped_tomato.svg');
    expect(getSpriteForPiece({ type: 'striped', matchType: 'lemon' }, sampleConfig)).toBe('striped_lemon.svg');
  });

  test('a striped piece of a type with no base sprite stays undefined (no "striped_undefined")', () => {
    expect(getSpriteForPiece({ type: 'striped', matchType: 'nonexistent' }, sampleConfig)).toBeUndefined();
  });

  // The graceful fallback the whole feature relies on: a striped piece whose
  // striped_ art isn't in the registry yet resolves to the same text-label
  // placeholder any un-arted sprite uses — never a crash or a blank tile.
  test('a striped piece with dedicated art resolves to the image; one without falls back to a label', () => {
    // A synthetic registry where only striped_tomato has real art. The real
    // skin now has striped art for all six ingredient types, so this no
    // longer mirrors it — it's a deliberately partial map that exercises the
    // fallback mechanism (registered -> image, unregistered -> label), which
    // must keep working for any future un-arted striped_ filename.
    const assets = { 'striped_tomato.webp': 7 } as unknown as Parameters<typeof resolveSpriteAsset>[1];
    const registryConfig: SkinConfig = {
      ...sampleConfig,
      pieceTypes: [
        { id: 'tomato', sprite: 'tomato.webp' },
        { id: 'herb', sprite: 'herb.webp' },
      ],
    };

    const tomatoSprite = getSpriteForPiece({ type: 'striped', matchType: 'tomato' }, registryConfig);
    expect(resolveSpriteAsset(tomatoSprite, assets)).toEqual({ kind: 'image', source: 7 });

    const herbSprite = getSpriteForPiece({ type: 'striped', matchType: 'herb' }, registryConfig);
    expect(herbSprite).toBe('striped_herb.webp');
    expect(resolveSpriteAsset(herbSprite, assets)).toEqual({ kind: 'label', label: 'ST' });
  });

  test('a color bomb resolves to the fixed color_bomb sprite regardless of matchType', () => {
    // Colorless: it has no matchType to derive a sprite from, so it maps to a
    // single fixed engine-type filename, not a per-flavor one (the leak test
    // holds — no skin piece name appears). An undefined matchType (its real
    // shape) resolves the same as any stray value would.
    expect(getSpriteForPiece({ type: 'color_bomb' }, sampleConfig)).toBe('color_bomb');
    expect(getSpriteForPiece({ type: 'color_bomb', matchType: 'tomato' }, sampleConfig)).toBe('color_bomb');
  });

  test('a color bomb with no registered art falls back to the text-label placeholder', () => {
    // The same graceful fallback every un-arted piece gets — never a crash or
    // blank tile. Real art is one spriteRegistry.ts line ('color_bomb.webp'),
    // zero code changes.
    const emptyAssets = {} as unknown as Parameters<typeof resolveSpriteAsset>[1];
    const bombSprite = getSpriteForPiece({ type: 'color_bomb' }, sampleConfig);
    expect(resolveSpriteAsset(bombSprite, emptyAssets)).toEqual({ kind: 'label', label: 'CO' });
  });

  test('an area bomb resolves to the single fixed area_bomb.webp regardless of matchType', () => {
    // One fixed sprite (the skin ships one area_bomb.webp), like the color bomb —
    // not a per-type variant like striped. The engine still keeps the piece's
    // matchType for its passive trigger and credit; only the sprite is uniform.
    expect(getSpriteForPiece({ type: 'area_bomb', matchType: 'tomato' }, sampleConfig)).toBe('area_bomb.webp');
    expect(getSpriteForPiece({ type: 'area_bomb', matchType: 'lemon' }, sampleConfig)).toBe('area_bomb.webp');
    // Even a matchType absent from the config resolves the same — the sprite
    // doesn't derive from the ingredient at all.
    expect(getSpriteForPiece({ type: 'area_bomb', matchType: 'nonexistent' }, sampleConfig)).toBe('area_bomb.webp');
  });

  test('an area bomb with no registered art falls back to the text-label placeholder', () => {
    // The same graceful fallback every un-arted piece gets — never a crash or
    // blank tile. Real art is one spriteRegistry.ts line ('area_bomb.webp').
    const emptyAssets = {} as unknown as Parameters<typeof resolveSpriteAsset>[1];
    const areaSprite = getSpriteForPiece({ type: 'area_bomb', matchType: 'tomato' }, sampleConfig);
    expect(resolveSpriteAsset(areaSprite, emptyAssets)).toEqual({ kind: 'label', label: 'AR' });
  });
});
