import { triggerPassEffects, SoundEffectsOptions } from './soundEffects';

function fakeOptions(overrides: Partial<SoundEffectsOptions> = {}): {
  played: string[];
  fired: string[];
  options: SoundEffectsOptions;
} {
  const played: string[] = [];
  const fired: string[] = [];
  return {
    played,
    fired,
    options: {
      soundEnabled: true,
      hapticsEnabled: true,
      soundService: { play: (effect) => played.push(effect), playMusic: () => {}, stopMusic: () => {} },
      hapticsService: { fire: (effect) => fired.push(effect) },
      ...overrides,
    },
  };
}

describe('triggerPassEffects', () => {
  test('first pass (i === 0) plays the match sound and fires a light haptic', () => {
    const { played, fired, options } = fakeOptions();
    triggerPassEffects(0, false, undefined, options);
    expect(played).toEqual(['match']);
    expect(fired).toEqual(['light']);
  });

  test('a later cascade pass plays the cascade sound but never fires a haptic', () => {
    const { played, fired, options } = fakeOptions();
    triggerPassEffects(1, false, undefined, options);
    expect(played).toEqual(['cascade']);
    expect(fired).toEqual([]);
  });

  test('the final pass with a won outcome also plays the win sound', () => {
    const { played, options } = fakeOptions();
    triggerPassEffects(2, true, 'won', options);
    expect(played).toEqual(['cascade', 'win']);
  });

  test('a final pass that paused (ran out of moves) does not play a win sound', () => {
    const { played, options } = fakeOptions();
    triggerPassEffects(0, true, 'paused_awaiting_input', options);
    expect(played).toEqual(['match']);
  });

  test('a non-final pass never plays the win sound even if finalOutcome is somehow set', () => {
    const { played, options } = fakeOptions();
    triggerPassEffects(1, false, 'won', options);
    expect(played).toEqual(['cascade']);
  });

  test('soundEnabled: false suppresses every sound call, independent of hapticsEnabled', () => {
    const { played, fired, options } = fakeOptions({ soundEnabled: false });
    triggerPassEffects(0, true, 'won', options);
    expect(played).toEqual([]);
    expect(fired).toEqual(['light']);
  });

  test('hapticsEnabled: false suppresses the haptic, independent of soundEnabled', () => {
    const { played, fired, options } = fakeOptions({ hapticsEnabled: false });
    triggerPassEffects(0, false, undefined, options);
    expect(played).toEqual(['match']);
    expect(fired).toEqual([]);
  });
});
