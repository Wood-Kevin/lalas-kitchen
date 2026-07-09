# Background music loop removal — verification

Verifies `engine/DECISIONS.md`'s background-music-loop-removal entry: the
looping ambient track is gone from active gameplay entirely, while the three
event sounds (match/cascade/win) are byte-for-byte unaffected.

## How this was captured

Same technique as `docs/verification/background-music-loop/` (the original
build verification) and `docs/verification/real-audio-backend/`: the real
running Expo-web app, driven from WSL2 over CDP against headless Windows
Chrome, with `window.Audio` wrapped to log every real `construct`/`play`/
`pause` call (the same primitive `expo-audio`'s web backend calls straight
through to) into `window.__audioLog`. Unlike the original capture, the
wrapper was injected via `Page.addScriptToEvaluateOnNewDocument` rather than
a plain `Runtime.evaluate` before navigation, since a full page load — the
real app's actual boot path — wipes a plain injected wrapper along with
everything else in the JS realm.

Steps against the real app, sound on from a fresh save:

1. Loaded Home, clicked "Start cooking" into real Level 1 ("Tomato Toss").
2. Read `window.__audioLog` immediately after the level settled — **`[]`,
   completely empty**. Before this removal, the original verification
   capture showed the loop's `construct`/`play` events firing at this exact
   point ("Loop starts on mount, sound on"). Nothing attempts to play now.
3. Swept real adjacent-tile drag gestures (`Input.dispatchMouseEvent`
   mousedown → several intermediate mousemoves with `buttons:1` held →
   mouseup, computed from real `[data-testid^="tile-"]` element rects) until
   one produced a genuine match — `Moves` dropped from 20 to 19, a real
   committed move.
4. Read the full audio log: **exactly two events, both `match.wav`**
   (`construct` then `play`, `currentTime: 0`) — `background.wav` events:
   **zero**, anywhere in the log, at any point in the run.

`level-in-progress-no-loop.png` — the real board mid-level after the match,
Moves at 19, nothing amiss visually.

## What was confirmed

- No background-music construction or playback attempt happens at any point
  in a real level's lifecycle — not on mount, not during play.
- The event-sound pipeline (`match.wav` here; `cascade.wav`/`win.wav` share
  the identical `triggerPassEffects` call path and player-pool mechanism,
  both completely untouched by this change) fires exactly as before —
  `construct` once (players are cached and reused), `play` on each trigger.
- Full engine test suite: 614/614 passing (down from 617 — exactly the 3
  tests that covered the removed `syncBackgroundMusic`/`playMusic`/
  `stopMusic` behavior, no other test needed changes). 26 suites (down from
  27 — `components/backgroundMusic.test.ts` deleted alongside the module it
  tested).
- A repo-wide grep for `playMusic`, `stopMusic`, `MusicId`, `musicRegistry`,
  `musicPlayer`, `syncBackgroundMusic`, and `backgroundMusic` across all
  `.ts`/`.tsx` files returns zero hits — no dead code, no orphaned
  references, anywhere.
- `skins/lalas-kitchen/sounds/background.wav` was deliberately left on disk,
  unreferenced — real, reusable work if this decision changes, not deleted.
