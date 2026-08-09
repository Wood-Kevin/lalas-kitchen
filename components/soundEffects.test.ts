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
      soundService: { play: (effect) => played.push(effect) },
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

describe('triggerPassEffects experimentalJuice (dev-only game-feel-comparison harness)', () => {
  test('plays match_juice instead of match on the first pass', () => {
    const { played, options } = fakeOptions({ experimentalJuice: true });
    triggerPassEffects(0, false, undefined, options);
    expect(played).toEqual(['match_juice']);
  });

  test('plays cascade_juice instead of cascade on a later pass', () => {
    const { played, options } = fakeOptions({ experimentalJuice: true });
    triggerPassEffects(1, false, undefined, options);
    expect(played).toEqual(['cascade_juice']);
  });

  test('layers special_trigger on top of match_juice when this pass fires a special effect', () => {
    const { played, options } = fakeOptions({ experimentalJuice: true, specialEffectFired: true });
    triggerPassEffects(0, false, undefined, options);
    expect(played).toEqual(['match_juice', 'special_trigger']);
  });

  test('an in-cascade special trigger on a later pass still layers special_trigger', () => {
    // The fixed comparison scenario's own striped sweep fires on a cascade
    // pass, not the swap pass — this must not assume i === 0.
    const { played, options } = fakeOptions({ experimentalJuice: true, specialEffectFired: true });
    triggerPassEffects(1, false, undefined, options);
    expect(played).toEqual(['cascade_juice', 'special_trigger']);
  });

  test('specialEffectFired alone, without experimentalJuice, never plays special_trigger', () => {
    // Real gameplay's own special-piece triggers must stay silent beyond the
    // calm production match/cascade/win set.
    const { played, options } = fakeOptions({ specialEffectFired: true });
    triggerPassEffects(0, false, undefined, options);
    expect(played).toEqual(['match']);
  });

  test('every existing real-gameplay call (experimentalJuice omitted) is unaffected', () => {
    const { played, options } = fakeOptions();
    triggerPassEffects(0, true, 'won', options);
    expect(played).toEqual(['match', 'win']);
  });
});
