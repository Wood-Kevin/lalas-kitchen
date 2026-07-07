# Real audio backend — live verification

This session replaced the correct-but-silent `silentSoundService` (the only
concrete `SoundService` until now, per `engine/DECISIONS.md`'s sound/haptics
stub-layer entry) with a real `expo-audio`-backed adapter, and populated
`skins/lalas-kitchen/soundRegistry.ts` with three real, synthesized WAV files
for match/cascade/win. See `engine/DECISIONS.md`'s real-audio-backend entry
for the full design writeup.

## What was actually driven, and how

Per the standing WSL2 screenshot-verification note, this was captured by
driving the **real running Expo-web app** over CDP (headless Windows Chrome
launched with `--remote-debugging-port=9222` and
`--autoplay-policy=no-user-gesture-required`, reached from WSL2 directly via
its mirrored-networking loopback) — not a mocked component tree, and not a
one-shot `--screenshot` capture (which uses virtual time and wouldn't exercise
real async audio loading).

Before interacting, a small `Runtime.evaluate` patch wrapped the real
`window.Audio` constructor and `HTMLMediaElement.prototype.play` to record
every real invocation (`{event, src, currentTime}`) into `window.__audioLog` —
this is the actual browser audio primitive `expo-audio`'s web backend uses
(`node_modules/expo-audio/src/AudioModule.web.ts`'s `AudioPlayerWeb` wraps a
plain `new Audio(source)`), so this is a genuine "did real playback get
invoked" signal, not an app-level log statement.

Steps against the real app:
1. Loaded Home, clicked the real Sound toggle on, clicked "Start cooking"
   into the real Level 5 ("Score Rush").
2. Dispatched a real CDP `Input.dispatchMouseEvent` drag (mousedown → several
   mousemoves with `buttons: 1` held → mouseup) swapping two adjacent tiles
   into a real 3-match.
3. Read back `window.__audioLog` and a fresh screenshot.
4. Repeated the identical swap on the identical (deterministic) board with
   the Sound toggle switched off, to confirm the negative case.

## What the screenshots and audio log show

**`match-sound-on-real-playback.png`** — after the real swap, `Target` moved
from `0/1000` to `30/1000` and `Moves` from `24` to `23`, confirming a real
match was applied by the real engine. `window.__audioLog` recorded:
```json
[
  {"event":"construct","src":"/assets/?unstable_path=.%2Fskins%2Flalas-kitchen%2Fsounds/match.wav"},
  {"event":"play","src":"http://localhost:8081/assets/.../match.wav","currentTime":0}
]
```
confirming Metro served the real synthesized `match.wav` asset from
`soundRegistry.ts`'s `require()`, and the real `HTMLAudioElement.play()` was
invoked on it — the full path from a real player gesture through
`Board.tsx` → `triggerPassEffects` → `expoAudioSoundService` → `expo-audio`'s
web backend → the browser's real audio API, with no mocks anywhere in the
chain.

**`identical-match-sound-off-silent.png`** — the identical swap on the
identical board (deterministic level, so byte-identical starting state) with
Sound toggled off produced the same score/move change (real match still
applied) but `window.__audioLog` stayed `[]` — confirming `soundEnabled:
false` correctly suppresses the real backend, not just the fake in
`soundEffects.test.ts`.

No console errors or error overlays appeared in any captured frame across the
whole session.

## What this does **not** cover — disclosed, not silently skipped

- **Only `match.wav` was exercised live.** `cascade.wav`/`win.wav` go through
  the identical `expoAudioSoundService.play(effectId)` code path (same
  registry lookup, same player-pool mechanism — only the effect id and
  registered source differ), and `components/soundEffects.test.ts`'s existing
  fake-service tests already cover the branch logic that picks which effect
  id fires when. But neither was independently confirmed to *actually play*
  through the real browser API the way match was — forcing a real cascade or
  a real level win live was out of scope for this pass's time budget.
- **No native (iOS/Android) device test.** This environment has no attached
  device or simulator. Web confirms the cross-platform `expo-audio` code path
  loads and invokes real playback with no errors, but the actual audible
  fidelity/latency/calmness of the tone, and the real native `AudioPlayer`
  backend (a different implementation from `AudioPlayerWeb`), are unconfirmed
  until run on a real device.
- **No human has listened to the three tones.** Nothing in this environment
  has audio output/input — verification here is limited to "real playback
  was invoked with no errors," never "it sounds calm and pleasant as
  intended." That subjective judgment call is still open until a real device
  or a local machine with speakers plays `skins/lalas-kitchen/sounds/*.wav`.

## Where the logic and tests live

- `services/expoAudioSoundService.ts` — the real adapter.
- `services/soundService.ts` — `selectSoundService` (now takes the real
  service as an injected param; see its comment for why the platform branch
  that existed for haptics doesn't apply here).
- `services/defaultSoundService.ts` — the real singleton construction.
- `scripts/generate-sound-assets.js` — how the three WAV files were
  synthesized, and why (no audio tool/licensed library access existed in the
  build environment).
- `skins/lalas-kitchen/soundRegistry.ts` — the three real `require()` entries.
- Tests: `services/soundService.test.ts` (`selectSoundService` now tested
  against an injected fake, since there's no platform branch left to assert
  on), `components/soundEffects.test.ts` (unchanged — already covered
  enabled/disabled and per-pass branch logic against a fake `SoundService`).
  All 503 tests pass (`npm test`).
