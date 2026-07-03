/**
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
// This file runs under jsdom, not the project's default Node test
// environment (see jest.config.js) — the real
// @react-native-async-storage/async-storage package's non-native fallback
// (what Expo's web target resolves to) is backed by `window.localStorage`,
// which only exists under jsdom. Every other test file in this project
// stays on the Node environment; this is the one exception, isolated to
// exactly the code path that needs it. See appPersistence.test.ts for the
// same round trip exercised against `createInMemoryStorage` instead, which
// needs no environment other than plain Node.
import { loadSave, saveProgress, SaveData } from './gameState';

describe('save/load against the real default storage (no explicit storage arg)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('saveProgress writes through to window.localStorage under the expected key', async () => {
    const data: SaveData = {
      skinId: 'lalas-kitchen',
      currentLevel: 1,
      lives: 4,
      livesLastRegenAt: 1700000000000,
      itemsCollected: {},
      powerUpCounts: {},
    };

    await saveProgress('lalas-kitchen', data);

    // Reading straight from localStorage, bypassing loadSave entirely,
    // proves this landed in real persisted browser storage — not just that
    // some Promise resolved.
    const raw = window.localStorage.getItem('lalas-kitchen:save:lalas-kitchen');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(data);
  });

  test('loadSave reads back what saveProgress wrote, through the real default storage', async () => {
    const data: SaveData = {
      skinId: 'lalas-kitchen',
      currentLevel: 1,
      lives: 2,
      livesLastRegenAt: 1700000001111,
      itemsCollected: {},
      powerUpCounts: {},
    };

    await saveProgress('lalas-kitchen', data);
    const loaded = await loadSave('lalas-kitchen');

    expect(loaded).toEqual(data);
  });

  test('loadSave returns null when nothing has been saved for that skin yet', async () => {
    const loaded = await loadSave('a-skin-nobody-has-played');
    expect(loaded).toBeNull();
  });

  test('data survives a fresh loadSave call after the module-level state has had time to be touched elsewhere', async () => {
    // Not a true process restart (Jest doesn't tear down and respawn one
    // per test) — but a second, independent read call with no shared
    // variable between it and the write proves the value is coming from
    // localStorage itself, not a JS reference held open by the test.
    const data: SaveData = {
      skinId: 'lalas-kitchen',
      currentLevel: 1,
      lives: 1,
      livesLastRegenAt: 1700000002222,
      itemsCollected: {},
      powerUpCounts: {},
    };
    await saveProgress('lalas-kitchen', data);

    async function reReadAsIfReopened(): Promise<SaveData | null> {
      return loadSave('lalas-kitchen');
    }

    expect(await reReadAsIfReopened()).toEqual(data);
  });
});
