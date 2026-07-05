# Sound/haptics stub layer — live verification

Verified against the real running app (Metro web bundle at `localhost:8081`,
driven by a real headless Chrome over CDP — this project's established
WSL2 approach, per `screenshot-verification-in-wsl` — not a mocked
component render).

## Before: fresh save, both toggles off by default

`home-toggle-default-off.png` — Home's new Sound/Haptics card renders
directly after the "Your recipe book" card, before "Up next," matching
CLAUDE.md's "not buried in a settings menu" instruction. Both switches show
off (SOUND_ENABLED_DEFAULT / HAPTICS_ENABLED_DEFAULT are both `false`).

## After: tapping Sound persists immediately, independent of Haptics

Dispatched a real `Input.dispatchMouseEvent` click on the Sound switch (no
synthetic React event, no mocked handler) and re-read `localStorage` before
and after:

**Before:**
```json
{"skinId":"cooking-lalas-kitchen","currentLevel":1,"lives":5,"livesLastRegenAt":1783286599555,"itemsCollected":{},"powerUpCounts":{},"completedLevels":[],"seenTutorials":[],"unlockedRecipeCards":[]}
```
No `soundEnabled`/`hapticsEnabled` keys at all — this real save predates the
feature, confirming the backward-compatibility path works in practice, not
just in `appPersistence.test.ts`.

**After the tap:**
```json
{"skinId":"cooking-lalas-kitchen","currentLevel":1,"lives":5,"livesLastRegenAt":1783289008910,"itemsCollected":{},"powerUpCounts":{},"completedLevels":[],"seenTutorials":[],"unlockedRecipeCards":[],"soundEnabled":true,"hapticsEnabled":false}
```

`home-toggle-sound-on.png` — the Sound switch visually flips to its
accent-colored "on" state; Haptics stays visually off. Confirms:
- The toggle round-trips through App.tsx's real state → `buildSaveData` →
  `saveProgress` → the real AsyncStorage-on-web (`localStorage`) backing,
  not just an in-memory React state flip.
- `soundEnabled`/`hapticsEnabled` are genuinely independent — toggling one
  never touches the other, in the real persisted blob, not just in a unit
  test with fake services.

## Test suite

All 329 tests (22 suites) pass, including the new `services/soundService.test.ts`,
`services/hapticsService.test.ts`, `components/soundEffects.test.ts`, and
`appPersistence.test.ts`'s new sound/haptics flag + backward-compatibility
tests.
