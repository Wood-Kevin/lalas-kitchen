# Background music loop — live verification

This session wired the already-optimized `skins/lalas-kitchen/sounds/background.wav`
into a real, looping ambient track — gameplay-scoped only (starts when a level's
`Board` mounts, stops when it's left), gated by the same `soundEnabled` toggle
that already controls match/cascade/win. See `components/backgroundMusic.ts`'s
`syncBackgroundMusic` (the pure start/stop decision, unit-tested), the new
mount/unmount `useEffect` in `components/Board.tsx`, `playMusic`/`stopMusic`
added to `services/soundService.ts`'s `SoundService` interface, their
implementation in `services/expoAudioSoundService.ts` (a separate
`musicPlayers` pool with `player.loop = true`), and the new `musicRegistry` in
`skins/lalas-kitchen/soundRegistry.ts`.

## What was actually driven, and how

Same technique as `docs/verification/real-audio-backend/README.md` — the real
running Expo-web app (`npm run web`, localhost:8081) driven from WSL2 over CDP
against headless Windows Chrome (`chrome.exe --headless=new
--remote-debugging-port=9222 --autoplay-policy=no-user-gesture-required`,
reached directly at `localhost:9222` thanks to this WSL2's mirrored
networking), not a mocked component tree and not a one-shot `--screenshot`
capture (virtual time wouldn't advance real audio).

Before interacting, `window.Audio` and every constructed element's
`play`/`pause` were wrapped to record `{event, src, loop, currentTime}` into
`window.__audioLog` — the same real browser primitive `expo-audio`'s web
backend (`AudioPlayerWeb`) wraps internally (confirmed by reading
`node_modules/expo-audio/src/AudioModule.web.ts` directly: `loop` is a real
passthrough getter/setter onto the underlying `HTMLAudioElement.loop`, and
`play()`/`pause()` call straight through to it) — so this is a genuine
"real playback was invoked" signal, not an app-level log statement.

Driven against a **fresh Chrome profile** (`C:\Users\Public\lalas-verify`,
never used before), so this also incidentally exercised the real first-load
`how_to_play` onboarding tutorial, dismissed live via a real click on its
"Got it" button before any tile swap — not stubbed out.

Steps against the real app:
1. Loaded Home, clicked the real Sound toggle **on** (`aria-checked` read
   back as `true`), clicked "Start cooking" into the real Level 1 ("Tomato
   Toss").
2. Dismissed the real onboarding tutorial overlay that appeared (fresh
   profile → `completedLevels.length === 0` → `how_to_play` gate fires, per
   `appPersistence.ts`'s `shouldShowOnboardingTutorial`).
3. Read `window.__audioLog` immediately after the level settled.
4. Swept real adjacent-tile drag swaps (`Input.dispatchMouseEvent`
   mousedown → mousemoves with `buttons:1` held → mouseup, computed from the
   real `[data-testid^="tile-"]` element rects) until one produced a genuine
   match — took 4 attempts on this deterministic level-1 board — then read
   the log and the live `HTMLAudioElement` status for both tracks.
5. Clicked the real exit (✕) button back to Home, read the log/status again.
6. Clicked Sound **off**, clicked "Start cooking" again (re-entering Level 1
   fresh), read the log for any new `background.wav` activity.

## What the log and screenshots show

**Loop starts on mount, sound on** (`02-level-just-entered.png`,
`03-level-tutorials-dismissed.png`) — right after entry:
```json
[
  {"event":"construct","src":"background.wav"},
  {"event":"play","src":"background.wav","loop":true,"currentTime":0}
]
```
confirming Metro served the real `background.wav` asset via
`musicRegistry`'s `require()`, a real `HTMLAudioElement` was constructed with
`loop === true` (i.e. `expoAudioSoundService`'s `player.loop = true` really
reached the underlying element, not just the `AudioPlayer` wrapper), and
`.play()` was really invoked — the full path from `Board.tsx`'s mount effect
→ `syncBackgroundMusic` → `expoAudioSoundService.playMusic` → `expo-audio`'s
web backend → the browser's real audio API.

**Match sound overlaps the still-playing loop, doesn't replace it**
(`04-mid-match-sound-on.png`) — a real drag-swap on attempt 4 produced a real
committed move (`Moves` HUD ticked `20 → 19` in the screenshot; `Target`
stayed `0/15` because the matched piece type wasn't this level's tomato
objective — a real, disclosed detail, not a failure) and the log recorded:
```json
[
  {"event":"construct","src":"match.wav"},
  {"event":"play","src":"match.wav","loop":false,"currentTime":0}
]
```
Read immediately after: `window.__audioStatus()` showed **both** elements
live —
```json
[
  {"src":"background.wav","paused":false,"loop":true,"currentTime":8.634322},
  {"src":"match.wav","paused":true,"loop":false,"currentTime":0.52}
]
```
(`match.wav` already `paused: true` by read time — its own short one-shot clip
had already finished playing out; the earlier log entry is the proof it
really played) — `background.wav`'s `currentTime` had advanced from `2.83s`
(at entry) to
`8.63s` (at the match) with `paused: false` throughout, confirming the loop
genuinely kept running underneath the one-shot match cue rather than being
stopped or restarted by it.

**Loop stops on exit, and rewinds** (`05-home-after-exit.png`) — clicking
the real ✕ exit button produced:
```json
{"event":"pause","src":"background.wav","loop":true,"currentTime":8.693118}
```
and the follow-up status read `{"paused":true,"currentTime":0}` — confirming
`Board.tsx`'s unmount cleanup really called `stopMusic('background')`, which
really called the live element's `.pause()` and then rewound it via
`seekTo(0)`, matching `expoAudioSoundService.ts`'s documented "next
`playMusic` restarts from the top" contract.

**Silent when sound is off** (`06-level-sound-off.png`) — toggling Sound off
(`aria-checked` read back `false`) and re-entering Level 1 produced exactly
one new log entry for `background.wav`:
```json
{"event":"pause","src":"background.wav","loop":true,"currentTime":0}
```
— a harmless, idempotent `stopMusic` call from the mount effect's
`soundEnabled: false` branch (the element was already paused/rewound from the
prior exit) — critically, **no new `construct` or `play` entry**, confirming
the loop never actually starts when sound is off. `match.wav` also never
fired again in this pass (no swap was attempted with sound off, since the
toggle behavior — not another match — was the thing being confirmed here).

No error overlay and no unhandled-exception text appeared in the DOM at any
point in the run (checked directly via a `document.querySelector` probe for
webpack's dev-overlay element and a body-text scan, after the full sequence
completed).

## Test suite

All 505 tests pass across 27 suites (`npm test`), including the new
`components/backgroundMusic.test.ts` (`syncBackgroundMusic`'s
enabled→`playMusic`/disabled→`stopMusic` branch logic against a fake
`SoundService`) and the widened fakes in `services/soundService.test.ts` /
`components/soundEffects.test.ts` now satisfying the `SoundService`
interface's new `playMusic`/`stopMusic` members.

## What this does **not** cover — disclosed, not silently skipped

- **No native (iOS/Android) device test.** This environment has no attached
  device or simulator, same disclosed gap as the original real-audio-backend
  verification. Web confirms the cross-platform `expo-audio` code path loads
  and loops with no errors; the real native `AudioPlayer` backend (a
  different implementation from `AudioPlayerWeb`) is unconfirmed.
- **No human has listened to the loop**, or confirmed it actually reads as
  calm/ambient rather than distracting underneath the event cues — the same
  standard `engine/DECISIONS.md`'s sound-redesign entries hold themselves to.
  Nothing in this environment has audio output.
- **Pause overlay and Won overlay were not independently exercised while the
  loop was running.** Both overlays render *inside* `Board` (it doesn't
  unmount for either), so per this session's design the loop is expected to
  keep playing underneath them — that follows directly from the mount/unmount
  scoping, not from a separate live check of those two specific overlay
  states. Worth a quick confirming glance in a future pass, not assumed
  broken.
- **Only one match was driven live**, not a cascade/chain or a level win
  while music played — `cascade.wav`/`win.wav` already share the exact same
  `expoAudioSoundService.play(effectId)` path match.wav just proved live, and
  this session's scope was the loop's own start/stop/overlap behavior, not
  re-proving those two cues again.
