import { getSpriteForMatchType } from './spriteMap';
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
