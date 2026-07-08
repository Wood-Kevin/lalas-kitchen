# Stuck-player hint: automatic timer → player-initiated button — verification

Verifies the conversion described in `engine/DECISIONS.md`'s stuck-player-hint
entry (conversion addendum) and `CLAUDE.md`: the automatic idle-timer hint
(`HINT_IDLE_MS`, last tuned to 18000ms — see `docs/verification/stuck-player-hint/`)
was removed entirely and replaced with an always-visible "💡 Hint" button in
`components/Board.tsx`'s top bar, capped at `HINT_USES_PER_ATTEMPT` (2) uses
per level attempt.

## How this was captured

Same rig as every other live capture in this project: the Expo web dev server
on `localhost:8081`, driven from WSL2 over raw CDP against headless Windows
Chrome, using this repo's own `node_modules/ws`.

Steps actually performed, in order, with zero manual/simulated shortcuts:

1. Loaded `localhost:8081`, clicked "Start cooking" (real text search +
   `scrollIntoView`, since the button sits below the fold at this viewport
   size), landing on level 1 "Tomato Toss."
2. A fresh save shows the `how_to_play` onboarding tutorial; dismissed it with
   a real click on "Got it."
3. **Confirmed the hint button is present and no hint is showing**:
   `document.body.innerText.includes('Hint')` → true,
   `document.querySelectorAll('[data-testid="hint-glow"]').length` → 0.
   Captured `button-present-no-glow.png`.
4. **Confirmed nothing fires automatically, regardless of idle time**: waited
   22008ms of real wall-clock time — comfortably past the old 18000ms
   automatic threshold — with **zero input** of any kind, then re-checked the
   glow count: still 0. This is the core claim of the conversion (no timer
   left to fire) and it was checked against the real running app, not assumed
   from reading the code.
5. **Tapped the "💡 Hint" button once** (a real `Input.dispatchMouseEvent`
   press+release at the button's actual on-screen coordinates). The glow
   count immediately became 2. Captured `hint-revealed-tap1.png`.
6. **Tapped the button a second time** (still visible — 1 of 2 uses spent).
   Glow count stayed 2 (a fresh `findAnyLegalMove` call against the real
   board, which on this static board returns the same pair again — expected,
   since no move was actually made between taps).
7. **Confirmed the button disappears once the cap is reached**: immediately
   after the second tap, `document.body.innerText.includes('Hint')` → false.
   Captured `button-gone-after-cap.png` — the exit "✕" button is still in
   exactly the same top-right position it always occupies, confirming the
   `topBar`'s `flex-end` layout doesn't shift when the hint button drops out.
8. **Confirmed a third tap is a genuine no-op**: searched for a "Hint" text
   node to click and found none (the button-finder returned `false`) — there
   is nothing left on screen to tap, not a disabled-but-present element that
   silently ignores a press.

## What the screenshots show

- **`button-present-no-glow.png`** — Level 1 "Tomato Toss," fresh board, the
  "💡 Hint" button visible at the top-right beside the exit "✕" button, no
  glow anywhere.
- **`hint-revealed-tap1.png`** — Same board, same seed, immediately after one
  tap on the Hint button. Two tiles carry the same soft rosy-pink breathing
  glow the old automatic version used: `tile-0-1` (tomato) and `tile-1-1`
  (garlic) — verifiably a real legal move straight off the board (row 0 reads
  garlic, tomato, garlic; swapping the glowing tomato into (1,1)'s garlic
  position completes garlic/garlic/garlic). The Hint button is still present
  (1 of 2 uses spent).
- **`button-gone-after-cap.png`** — Same board. The Hint button has vanished
  entirely; only the exit "✕" button remains, in its original position.

## Where the logic and tests live

- `engine/matrix.ts` — `findAnyLegalMove`, unchanged by this session. Already
  covered by its own existing test suite (`engine/matrix.test.ts`).
- `components/pauseActions.ts` — `canUseHint`/`HINT_USES_PER_ATTEMPT` and the
  generalized `nextAttemptUseCount`/`AttemptUseEvent` (renamed from
  `nextBonusGrantsUsed`/`GrantEvent`, since the logic was already
  resource-agnostic and now genuinely serves two independent per-attempt
  counters). Covered by `pauseActions.test.ts`'s new `canUseHint` describe
  block, mirroring `canGrantBonusMoves`'s own tests exactly (cap-is-2, first
  two allowed, third blocked, full-attempt walk with a restart reset).
- `components/Board.tsx` — `hintPair`/`hintUsesUsed` state, `handleRequestHint`
  (the button's tap handler), and the "💡 Hint" `Pressable` in the top bar.
  This project has no React component-rendering test harness (see CLAUDE.md's
  Testing Philosophy), so this wiring — like every other Board-level
  interactive element — is verified live here rather than via a mounted
  component test.
- `components/Tile.tsx` — `HintGlowOverlay`, completely unchanged by this
  session (same breathing-opacity glow, same lack of dim wash/crack).
- Deleted: `components/stuckHintTiming.ts` and its test file — the
  schedule/cancel timer-reset helper the automatic version needed, with
  nothing left to call it once the timer itself was removed.
- All 521 tests pass (`npm test`), across 27 suites (down from 28 — the
  deleted `stuckHintTiming.test.ts`'s 4 tests are replaced 1-for-1 by the new
  `canUseHint` block's 4 tests).

## Cleanup

The headless Chrome instance driven for this capture was left running (it was
already up from an earlier verification pass in this same environment, not
started fresh by this session) — no new process was spawned or needs
stopping. The pre-existing Expo web dev server on port 8081 was left
untouched, same as prior sessions.
