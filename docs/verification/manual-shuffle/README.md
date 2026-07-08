# Free, player-invoked shuffle button — verification

Verifies `engine/DECISIONS.md`'s "Free, player-invoked shuffle button" entry:
a new "🔀 Shuffle" button in `components/Board.tsx`'s top bar, backed by
`engine/gameState.ts`'s `requestManualShuffle`, which reuses `matrix.ts`'s
existing `shuffle()` (the same function the stuck-board rescue already
trusts) to give the player a free, always-available, uncapped "fresh board"
affordance with no move or life cost.

## How this was captured

The Expo web dev server (an existing instance on `localhost:8082`) driven
from WSL2 over raw CDP against headless Windows Chrome, using this repo's own
`node_modules/ws` — the same rig prior sessions' verification docs describe
(see `docs/verification/stuck-player-hint-button/`).

Steps performed, in order:

1. Loaded the app, clicked "Start cooking" into level 1 "Tomato Toss," and
   dismissed the real `how_to_play` onboarding overlay with "Got it."
2. Confirmed the new "🔀 Shuffle" button renders in the top bar, to the left
   of "💡 Hint" and the exit "✕" — see `before-shuffle.png`.
3. Captured every tile's real DOM position (`getBoundingClientRect()`) and
   sprite (`<img>` `src`) via `testID="tile-<pieceId>"`, plus the HUD's real
   Target/Moves/Lives text.
4. **Tapped the real "🔀 Shuffle" button** (a real `Input.dispatchMouseEvent`
   press+release at its actual on-screen coordinates).
5. Re-captured the same per-tile position/sprite data and HUD text.

## What was confirmed

- **39 of 40 tiles changed screen position** after one tap — a genuine
  reshuffle, not a no-op.
- **The sprite multiset was byte-identical before and after** (same 40
  sprites, sorted) — a real permutation of the existing pieces, not a
  respawn/regeneration.
- **Target stayed `0/15`, Moves stayed `20`, Lives stayed `5`** — confirming
  the shuffle is genuinely free: no move spent, no life spent, no objective
  progress lost or gained.
- **The resulting board is visibly match-free** (`after-shuffle.png`) — no
  3-in-a-row anywhere, consistent with `shuffle()`'s own legality guarantee.

## Where the logic and tests live

- `engine/gameState.ts` — `requestManualShuffle`, covered by
  `engine/gameState.test.ts`'s new `requestManualShuffle` describe block.
- `components/Board.tsx` — `handleRequestShuffle`, the "🔀 Shuffle" `Pressable`
  in the top bar. No React component-test harness exists in this project (see
  CLAUDE.md's Testing Philosophy), so this wiring is verified live here.

Full suite: 552 tests passing.
