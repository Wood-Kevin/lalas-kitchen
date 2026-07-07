# Play Again wrongly routing to OutOfLives — real playtest bug, verification

A real playtest report: the "refill your lives" `OutOfLives` screen appeared
right after tapping "Play Again", while the player still had 4 lives (not 0).
Investigated per CLAUDE.md's Playtest Feedback Protocol.

## Root cause

`components/PausedOverlay.tsx` and `components/WonOverlay.tsx` both wired
their "Play Again" button as `onPress={onPlayAgain}` — passed through
unwrapped. `Board.tsx` wired that same prop directly to the real
`handlePlayAgain(livesOverride?: number)` function at both call sites.

`Pressable`'s `onPress` always calls its handler with the click event as the
first argument (confirmed against `react-native-web`'s own
`PressResponder.js`, which calls `onPress(event)` unconditionally — true on
native RN too). So every tap of "Play Again" from these two screens called
`handlePlayAgain(clickEvent)`, and the event object landed in
`livesOverride`.

`const currentLives = livesOverride ?? lives` then picked the event object
over the real lives count — `??` only falls back on `null`/`undefined`, and
the event is neither. `canStartLevel(eventObject)` evaluates
`eventObject > 0`, which is always `false` for any object. So
`onOutOfLives()` fired unconditionally, regardless of the real lives count.

This was a pre-existing gap in the mid-level-continue session's own
verification, not something that session introduced: its own live capture
(`docs/verification/mid-level-continue/05-decline-continue-offer.png` /
`06-after-decline-lives-4.png`) tested `ContinueOffer`'s *decline* "Play
Again" link, which routes through the parameterless
`handleContinueDeclinePlayAgain` wrapper and was never affected. The plain
"Play Again" on `PausedOverlay`/`WonOverlay` was never actually exercised by
that capture, despite `engine/DECISIONS.md`'s prose describing "restarting
from that terminal screen" as verified.

## How it was captured

Real Expo-web app (`expo start --web`), driven over CDP against headless
Windows Chrome from WSL (the same rig this repo's other `docs/verification/`
entries use) — real tap gestures dispatched via `Input.dispatchMouseEvent`
against real tile DOM nodes, not simulated. A temporary `movesLimit: 1` tweak
to Level 1 (`App.tsx`'s `LEVEL_QUEUE`, reverted immediately after each
capture) forced a genuine moves-exhausted loss quickly. A temporary
`console.log` in `handlePlayAgain` (reverted after capture) printed the real
`typeof livesOverride` / value received.

- **`01-bug-outoflives-at-4-lives.png`** — **before the fix**: real account
  lives were 4 (correctly auto-decremented from 5 by one genuine loss, with
  both bonus-move rescues exhausted first). Tapping "Play Again" on the real
  terminal `PausedOverlay` navigated straight to `OutOfLives` ("The Kitchen's
  Resting" / "Refill your lives"), whose flame row shows exactly **4 filled**
  — matching the reported symptom precisely. The captured console log at this
  exact moment: `typeof livesOverride= object livesOverride= SyntheticBaseEvent
  prop lives= 4`.
- **`02-before-fix-terminal-pausedoverlay-lives4.png`** — the real terminal
  `PausedOverlay` ("The Pot's Still Warming") immediately before that tap, on
  a fresh save, confirming the same setup independently.
- **`03-after-fix-correct-restart-lives4.png`** — **after the fix**: the same
  repro (fresh save, one real loss, both rescues exhausted, terminal
  `PausedOverlay`), tapping "Play Again" now correctly restarts Level 1 — a
  fresh board, Moves reset, and the Hud showing the real, correctly
  decremented **Lives: 4** — not `OutOfLives`.

## The fix

Two changes, `components/Board.tsx`:

1. Both call sites wrapped: `onPlayAgain={() => handlePlayAgain()}` in place
   of `onPlayAgain={handlePlayAgain}`, for both `PausedOverlay` and
   `WonOverlay` — matching the pattern `handleContinueDeclinePlayAgain`/
   `handleContinueDeclineExit` already established for `ContinueOffer`.
2. `handlePlayAgain` itself hardened: `typeof livesOverride === 'number' ?
   livesOverride : lives` in place of `livesOverride ?? lives` — a durable
   guard so a future caller wired the same unwrapped way falls back to the
   real `lives` prop instead of silently misreading an event object as a
   lives count.

All 474 existing tests still pass (no test coverage previously existed for
this exact interaction, since it requires a real `Pressable`/DOM event round
trip — this repo has no React component-test infra, per CLAUDE.md's own
note — so live verification was the only way to catch or confirm this).
