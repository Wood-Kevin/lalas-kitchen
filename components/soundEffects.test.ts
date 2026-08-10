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

describe('triggerPassEffects never selects the _juice/special_trigger register', () => {
  // Regression guard for a real bug: SoundEffectsOptions used to carry an
  // experimentalJuice flag that swapped match/cascade for brighter
  // `_juice` variants. Wiring that flag to soundEnabled (so real gameplay
  // could reach it at all) meant every player who enabled Sound could ONLY
  // ever hear the juice register, never the calm one — confirmed on a real
  // on-device listen as reading like "a slot machine," exactly the
  // character the calm set was redesigned three times to get away from.
  // The fix removed experimentalJuice/specialEffectFired from
  // SoundEffectsOptions entirely, so there's no longer a flag capable of
  // reintroducing this — these tests exist so a future reintroduction of a
  // similar flag has to consciously break an explicit assertion, not just
  // slip past unnoticed the way this one did.
  test('an options object with no such fields still only ever plays match/cascade/win', () => {
    const { played, options } = fakeOptions();
    triggerPassEffects(0, false, undefined, options);
    triggerPassEffects(1, false, undefined, options);
    triggerPassEffects(2, true, 'won', options);
    expect(played).toEqual(['match', 'cascade', 'cascade', 'win']);
    expect(played.some((id) => id.includes('juice') || id === 'special_trigger')).toBe(false);
  });

  test('SoundEffectsOptions has no experimentalJuice or specialEffectFired field at all', () => {
    // A type-level guard, not just a runtime one: if either field is ever
    // added back to the interface, this line stops compiling.
    const options: SoundEffectsOptions = {
      soundEnabled: true,
      hapticsEnabled: true,
      soundService: { play: () => {} },
      hapticsService: { fire: () => {} },
      // @ts-expect-error — experimentalJuice must not exist on this type.
      experimentalJuice: true,
    };
    expect(options.soundEnabled).toBe(true);
  });
});
