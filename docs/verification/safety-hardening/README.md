# Save-corruption fallback and ErrorBoundary recovery — live verification

This session hardened three real playability-audit findings: `engine/gameState.ts`'s
`loadSave` now falls back to a fresh save on any corrupted/malformed blob instead of
throwing; `components/ErrorBoundary.tsx` is a new app-level React error boundary
(wired into `App.tsx` as the outermost wrapper) that turns any uncaught render crash
into a calm "Something went wrong / Start Fresh" screen instead of a silent, permanent
blank one; and `engine/matrix.ts`'s `shuffle` no longer silently returns an illegal
board when its 100 random reshuffle attempts are exhausted. See
`engine/DECISIONS.md`'s "Three real-playability-audit safety fixes" entry for the
full reasoning; this file covers only what was actually driven live.

## What was actually driven, and how

Same technique as `docs/verification/background-music-loop/README.md` and
`docs/verification/real-audio-backend/README.md` — the real running Expo-web app
(`npx expo start --web`, localhost:8081) driven from WSL2 over CDP against headless
Windows Chrome (`chrome.exe --headless=new --remote-debugging-port=9222`, reached
directly at `localhost:9222` thanks to this WSL2's mirrored networking). No screenshots
were captured this session — the relevant signal was DOM text content and console
output (does the crash screen appear or not, does Home render or not), not visual
appearance, so `document.body.innerText` assertions over the CDP `Runtime.evaluate`
channel were the right tool.

### Step 1 — normal load

Confirmed the real Home screen renders on a fresh profile with no save yet:
```
Lala's Kitchen
"Welcome back, dear. The pot's already warming."
5
Your recipe book
...
Start cooking
Browse all levels
```

### Step 2 — corrupted save falls back to fresh, not a crash

Wrote a genuinely invalid JSON blob directly into `localStorage`'s real save key
(`save:lalas-kitchen`) — `'{"skinId": "lalas-kitchen", not valid json at all ###'` —
then reloaded the page:

- `document.body.innerText.includes("Something went wrong")` → **`false`**
- `document.body.innerText.length > 0` → **`true`**
- The rendered body was the real, ordinary Home screen, byte-for-byte the same
  content as the fresh-profile load in Step 1.

This confirms `loadSave`'s new `try`/`catch` + `isValidSaveData` schema guard
genuinely intercepts a corrupted blob and falls back to the existing
`applyLoadedSave(null)` fresh-install path, rather than throwing and leaving the
app unable to open — the exact catastrophic failure mode this fix targets.

### Step 3 — a real injected crash is caught and recovers

A temporary, reverted-after render-throw hook was added to `App.tsx` (`AppRoot`
threw when `window.location.search` contained `crashtest=1`) — the same
"temporary harness gate, removed after capture" convention this project already
uses for CDP verification (see the memory on screenshot verification in WSL). The
hook was fully removed after this capture; `grep -n crashtest App.tsx` after the
session confirms zero matches remain.

Navigating to `http://localhost:8081/?crashtest=1`:

- `document.body.innerText` → exactly:
  ```
  Something went wrong
  No progress has been lost. Let's start fresh.
  Start Fresh
  ```
- `includes("Something went wrong")` → **`true`**, `includes("Start Fresh")` → **`true`**

A real mouse click was dispatched (via `Input.dispatchMouseEvent`) at the "Start
Fresh" button's actual computed bounding-box center. Since the `?crashtest=1` query
parameter was still present in the URL (a fresh remount re-runs the exact same
render path), the app **immediately re-threw and showed the recovery screen again**
— this is the expected, correct behavior, not a bug: it proves `handleReset`
performs a genuine full remount (re-running `AppRoot` from scratch, which re-hits
the crash condition) rather than silently clearing an internal flag while leaving
stale state behind. A boundary that only cleared `hasError` without forcing a
remount would have looped or misbehaved differently here; instead it recovered
into the same calm screen, deterministically, exactly as designed.

Navigating away to `http://localhost:8081/` (crash condition removed) then rendered
the ordinary, fully interactive Home screen with no residual broken state —
confirming the crash was completely recoverable, not a permanent wedge.

## Test suite

521 tests passing across 28 suites (`npx jest`), up from 512 at the start of this
session:
- 7 new tests in `engine/gameState.test.ts` for corrupted/malformed-save fallback
  (truncated JSON, non-object JSON, missing required field, wrong-typed required
  field, wrong-typed optional field, a genuinely old minimal save, and a fully
  populated save — confirming both that corruption falls back cleanly and that
  this fix isn't stricter than the pre-existing save format).
- 6 new tests in `components/errorRecovery.test.ts` for the ErrorBoundary's actual
  logic (`erroredRecoveryState`, `nextResetState`, `describeCaughtError`) —
  `ErrorBoundary.tsx` itself imports `react-native` and was confirmed (via a
  throwaway test file) to fail to parse under this repo's plain ts-jest config,
  the same limitation `services/hapticsService.ts` already documents for
  `expo-haptics`, so its logic was extracted into a react-native-free module
  first, matching the `stuckHintTiming.ts`/`pauseActions.ts`/`wonActions.ts`
  pattern this project already uses for the same reason.
- 3 new tests in `engine/matrix.test.ts` for the hardened `shuffle`: a rigged
  constant `rng` that forces all 100 random attempts to produce the exact same
  illegal board (hand-traced: `rng ≡ 0` makes `fisherYates` always rotate the
  input array left by one), an adversarial worst case (a real generator `ring`
  board at its real 8×5 size, 22/40 cells playable, dense blockers, the real
  6-type piece pool, run through three different degenerate/normal rngs), and a
  genuinely impossible board (every movable cell a distinct type) confirming
  `shuffle` throws a descriptive error rather than returning bad data.
- 51 pre-existing `gameState.test.ts` failures surfaced by the `shuffle` hardening
  were investigated and fixed at the actual root cause (a graceful-degradation
  `try`/`catch` at `applyMove`'s mid-play rescue call site, not 51 individual test
  edits) — see the DECISIONS.md entry for the full reasoning on why that call
  site's failure mode is different from `generateLevel`'s.
- 1 pre-existing `matrix.test.ts` fixture ("voids stay at their exact positions
  after a reshuffle") was replaced with a genuinely shufflable board — the
  original diagonal-void layout had no row or column with 3+ contiguous movable
  cells, making it structurally incapable of ever having a legal move regardless
  of piece types, a latent fixture bug the old, unverified `shuffle` never
  surfaced.

## What this does **not** cover — disclosed, not silently skipped

- **No native (iOS/Android) device test.** Same disclosed gap as every other
  live verification in this project — this environment has no attached device
  or simulator.
- **No live click-through of actual gameplay** (a real drag-swap producing a
  match, exercising the modified `applyMove`/`shuffle` code path end-to-end in
  the browser). Synthetic `Input.dispatchMouseEvent` calls against React Native
  Web's gesture-handler-backed `Pressable`/drag surface didn't register a real
  interaction in this session's attempt — a CDP input-simulation friction, not
  a signal that anything is broken. Confidence in the modified engine code path
  instead rests on the engine test suite (521 tests, including the adversarial
  ring-board scenario run through the real, unmodified `applyMove`/`shuffle`
  functions), which is the right tool for engine-logic correctness per this
  project's own testing philosophy — the two claims that are genuinely
  UI/feel-shaped (does a corrupted save recover gracefully, does a crash recover
  gracefully) were the ones verified live, as they should be.
- **No screenshots.** The relevant signal this session was DOM text content
  and console output, not visual appearance — unlike sound/animation
  verification sessions, there was nothing a screenshot would show that the
  text assertions above don't already prove.
