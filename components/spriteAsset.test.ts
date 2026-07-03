import { resolveSpriteAsset, SpriteAssetMap } from './spriteAsset';

describe('resolveSpriteAsset', () => {
  test('resolves to the registered image asset when the filename is present', () => {
    const assets: SpriteAssetMap = { 'tomato.webp': 42 };
    expect(resolveSpriteAsset('tomato.webp', assets)).toEqual({ kind: 'image', source: 42 });
  });

  // The important behavior this phase adds: a config pointing at a sprite
  // file that doesn't exist yet (the real case today — skins/lalas-kitchen/
  // sprites/ is empty) falls back to the text label instead of erroring or
  // rendering a broken image.
  test('falls back to the text label when the filename is not in the registry', () => {
    const assets: SpriteAssetMap = {};
    expect(resolveSpriteAsset('tomato.webp', assets)).toEqual({ kind: 'label', label: 'TO' });
  });

  test('falls back to the placeholder label when spritePath itself is undefined', () => {
    expect(resolveSpriteAsset(undefined, {})).toEqual({ kind: 'label', label: '?' });
  });
});
