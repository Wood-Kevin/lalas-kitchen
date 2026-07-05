# Won overlay timing — gated on animation completion, not data availability

`filmstrip.png` verifies the fix for the "Won overlay appears before the
cascade finishes" bug: the terminal (Won / Paused) overlay now waits until every
animated cascade pass has genuinely finished playing, instead of popping the
instant the winning move's data resolves.

## What the bug was

Two features built at different times, never reconciled:

- **`applyMove`** (`engine/gameState.ts`) commits `status: 'won'` as *data* the
  moment the objective count reaches target — but also returns *every* cascade
  pass in `steps: Board[]`. A winning move whose threshold is crossed on pass 1
  can still have passes 2, 3… to animate.
- **`animateCascade`** (`components/Board.tsx`) committed `gameState` (and thus
  `status`) at the *start* of the final pass's animation, and the overlay
  rendered purely off `gameState.status === 'won'`. So it appeared at the start
  of the final pass — cutting off the chain reaction the player most wants to
  watch. The cascade-steps work had deferred the commit to the *final pass* so
  overlays wouldn't appear *mid*-chain, but never past that final pass's own
  animation.

## The fix

`Board.tsx` gates the terminal overlays behind a `terminalOverlayReady` flag set
`true` only one full between-pass beat *after* the final pass commits — the same
play time every earlier pass already gets. The reveal timing is a pure function,
`planCascadeAnimation` / `terminalOverlayHoldMs` in `components/cascadeTiming.ts`
(unit-tested in `cascadeTiming.test.ts`). `gameState.status` — and therefore
App-level persistence, recipe unlocks, and input lockout — still commits with the
data on the final pass; only the visual reveal waits.

## How the image was produced

A throwaway harness (deleted after capture, per the WSL
screenshot-verification note) drove the **real `applyMove`** on a hand-built
3-pass winning cascade — a vertical A-run (pass 1, meets the objective) whose
column-1 refill keeps cascading into a B-run (pass 2) and a C-run (pass 3) before
settling — and the **real `planCascadeAnimation(3, 480)`** schedule
(step starts `[0, 480, 960]`, overlay reveal `1440ms`). Each panel is a
deterministic snapshot at a fixed time *t*, mirroring `Board.tsx`'s timeline.
Rendered with Windows Chrome headless (`--screenshot`); the panels are static
DOM, not a Reanimated timeline, so a single capture samples them exactly.

Tiles show placeholder matchType letters (A/B/C/…), not skin art — this verifies
timing only.

## Reading the filmstrip

- **t = 240 ms — Pass 1** — the A-run (objective pieces) has cleared, column 1
  refilled to B's. No overlay.
- **t = 720 ms — Pass 2** — the B-run cleared, column 1 now C's. Chain still
  resolving, no overlay.
- **t = 1080 ms — Pass 3** — the C-run cleared, column 1 settled to P/F/G. The
  winning move's data has **already resolved** here (status = WON committed at
  t = 960 ms), yet the overlay is **withheld** while this final pass finishes.
  This is the panel that proves the fix.
- **t = 1480 ms** — the final pass has finished (reveal at t = 1440 ms); only now
  does the **Won overlay** appear.
- **BEFORE FIX** (contrast panel) — under the old logic the overlay popped at
  t = 960 ms, the instant the data resolved, covering pass 3 mid-animation.

Together: multiple cascade steps genuinely play out (distinct B → C → settled
board states) before the overlay, and the overlay does **not** appear when the
win data resolves at t = 960 ms — only a full beat after the last pass finishes.
