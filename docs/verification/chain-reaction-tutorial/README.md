# The fourth tutorial — `chain_reaction` — live organic verification

`chain-reaction-before.png` / `chain-reaction-after.png` verify the fourth
one-time tutorial, `chain_reaction`: the calm, once-ever card shown the first
time a single move fires **more than one special piece together** — the
actual differentiator of this whole game — via a chain reaction (a special
caught in another's clear set firing its own effect too) or a combo (two
swapped specials).

Unlike the three per-piece tutorials, this was built with the genuine-organic
verification requirement **in from the start**, not as a follow-up closing a
gap the way `special-piece-tutorial/organic-spawns/` had to for color bomb and
area bomb. There is no pre-placed-piece shortcut version of this capture.

## Where the trigger actually lives (no new detection)

`engine/gameState.ts`'s chaining machinery (`expandChainClears`/`originKeys`)
already computes, per cascade pass, exactly which cells were already a special
piece (striped/color bomb/area bomb) that fired its own effect — either as the
pass's own trigger or a chain reaction it caught. This session added
`countFiredSpecials` (a pure count over that same clear set) and threaded a
`maxSpecialsFired` count through `resolveMatchEffects` → `resolveCascades` /
`resolveClearSet` → `applyMove`, exposing it as
`ApplyMoveResult.multiSpecialFired` (true once 2+ specials fire within the
SAME pass — a max across cascade passes, not a sum, so two unrelated specials
firing on separate later beats of a long chain don't count as "together").
`appPersistence.ts`'s `shouldShowChainReactionTutorial(multiSpecialFired,
seenTutorials)` is a plain once-ever gate over that boolean — not a board
scan like `findSpecialPieceTutorial`, because the specials that fired a chain
reaction are, by definition, already cleared by the time the move settles;
there's no resting piece left to find.

## How it was captured — the real app, not a mock

1. **`expo start --web`** was actually running (Metro serving the real bundle
   on `:8081`), and Windows Chrome was driven headless over CDP from WSL — the
   established mirrored-networking rig this repo's other live-motion captures
   use (see `docs/verification/denial-zone-spread/`, `dev-reset/`, and
   `special-piece-tutorial/organic-spawns/`).
2. A **temporary** `?forge=chain` query param (a few lines in `App.tsx`'s
   mount effect, reverted immediately after this capture) skipped the normal
   save load and dropped straight into a hand-crafted 6×6 board — via a
   **temporary** `LevelConfig.debugBoard` escape hatch in `createGameState`
   (`engine/gameState.ts`, also reverted). Exactly the same "temporary harness
   gate, reverted after" pattern the prior live captures used. It only
   controls the board's *starting layout*; matching, chaining, and the
   tutorial pipeline all run completely unmodified.
3. The board was designed so exactly **one adjacent swap** produces a genuine
   chain reaction and **nothing else** — verified against the real
   `checkMatches`/`checkSquares`/`applyMove` (not hand-reasoned) in a
   throwaway `engine/__forge_scratch__.test.ts` before being copied into the
   harness (see "What the board actually contains" below); that scratch file
   was deleted after this capture.
4. `seenTutorials` was seeded to `['striped', 'color_bomb']` — a player who's
   about to genuinely trigger a chain reaction has necessarily already met
   the striped piece and the color bomb individually, so their per-piece
   tutorials are pre-dismissed. (The first driver run, without this, correctly
   surfaced the real "A Color Bomb" per-piece tutorial blocking input — the
   forge board's resting bomb existing from move zero is exactly the
   condition `findSpecialPieceTutorial` is built to catch. Seeding
   `seenTutorials` fixed the harness; nothing in the app changed.)
5. A **real two-click tap-to-select-then-tap-adjacent gesture** was dispatched
   over CDP (`Input.dispatchMouseEvent` on the actual tile DOM nodes,
   `[data-testid="tile-<pieceId>"]`) — the exact input path `Board.tsx`'s
   `handleTilePress` implements for a real player's two taps, calling the real
   `applyMove`. No `window.__hook()` shortcut, no direct state injection.
6. After the real cascade settled, `Board.tsx`'s `animateCascade` final-pass
   branch (unmodified) read the real `result.multiSpecialFired` from that real
   `applyMove` call and showed the real `SpecialTutorialOverlay`.

## What the board actually contains

A 6×6 board, every cell a globally-unique filler `matchType` except:

- `(0,0)`: a live `color_bomb`.
- `(0,1)`: an ordinary `tomato` — the bomb's real swap partner.
- `(2,2)`: a live `striped` `tomato` piece, column direction — **not** part of
  the swap; it only exists to be *caught*.
- `(4,4)`: one more ordinary `tomato`.

Swapping `(0,0)` with `(0,1)` detonates every `tomato` on the board — which
includes the striped piece at `(2,2)`, since it's colored `tomato` too. That
striped piece is not the bomb's own trigger (it's not one of the two swapped
cells), so it's a genuine **chain reaction**: caught by the bomb's detonation,
it fires its own column sweep on top of it, clearing all of column 2 — two
specials firing together from one real move.

## What the screenshots show

- **`chain-reaction-before.png`** — the real board before the swap: `Target
  0/999`, `Moves 20`. The live color bomb sits at top-left, the live striped
  tomato mid-board (with its column-direction badge visible), a plain tomato
  bottom-right — everything else the real text-label sprite-placeholder
  fallback (`?`), since these filler cells use synthetic matchType ids with no
  registry art, exactly like any other un-arted piece.
- **`chain-reaction-after.png`** — the real settled board (dimmed by the
  overlay's scrim) behind the real `SpecialTutorialOverlay`: `Target 3/999`
  (the bomb's partner + the caught striped + the extra tomato — the bomb
  itself is colorless and credits nothing, matching the documented
  accounting), `Moves 19` (one real move spent). The card shows **"Everything
  at Once"** with the real calm copy and the `spriteLabel`-derived `"CH"`
  placeholder icon (no dedicated art exists for this tutorial, the same
  graceful fallback every un-arted piece/tutorial already uses).

## Assertions made by the driver (not just eyeballed)

```
--- BEFORE swap ---
{ "tileCount": 36, "hasChainTutorial": false, "hasBombTile": true, "hasTargetTile": true, "hasStripedTile": true }
--- AFTER swap ---
{ "hasChainTutorial": true, "subtext": true, "bombGone": true, "stripedGone": true, "col2Gone": true }
PASS — genuine organic chain-reaction move triggered the chain_reaction tutorial
```

`col2Gone` asserts every tile in column 2 (rows 0–5) is gone from the DOM —
the decisive proof the caught striped piece genuinely fired its own sweep,
not just that the overlay text happened to match.

## Cleanup

The temporary `?forge=chain` gate and `FORGE_CHAIN_LEVEL_CONFIG`/
`forgeChainBoard` in `App.tsx`, the temporary `LevelConfig.debugBoard` field
and its branch in `createGameState` (`engine/gameState.ts`), and
`engine/__forge_scratch__.test.ts` were all reverted immediately after this
capture. The full test suite was re-run after reverting to confirm all tests
still pass with zero trace of the harness left in the shipping code.

## Where the logic lives (unchanged by this capture)

- `engine/gameState.ts` — `countFiredSpecials`, `CascadeResolution.maxSpecialsFired`,
  `ApplyMoveResult.multiSpecialFired` (the real detection, reusing
  `expandChainClears`/`originKeys`).
- `appPersistence.ts` — `CHAIN_REACTION_TUTORIAL_ID`,
  `shouldShowChainReactionTutorial`.
- `components/SpecialTutorialOverlay.tsx` — the same data-driven overlay the
  three per-piece tutorials use, now also accepting a null `piece` (this
  tutorial celebrates a moment, not one resting piece) and the `chain_reaction`
  entry in `SPECIAL_TUTORIAL_CONTENT`.
- `components/Board.tsx` — `animateCascade`'s final-pass branch, which sets
  `specialTutorial` from `result.multiSpecialFired` at the same point the
  combo-streak banner fires; this naturally takes priority over the
  per-piece board-scan effect (both write the same `specialTutorial` slot,
  and React's batching means the effect sees it already set and defers), so
  the two tutorials never stack with no new priority logic needed.

## Test coverage (see `engine/gameState.test.ts` and `appPersistence.test.ts`)

- A hand-built board where a color bomb's detonation genuinely chains into a
  caught striped piece → `multiSpecialFired: true`.
- A striped+striped cross combo → `multiSpecialFired: true` (always, since a
  combo's own two swapped specials are both origins).
- A solo color bomb detonation with no other special anywhere on the board →
  `multiSpecialFired: false`.
- A single striped piece firing via an ordinary in-match sweep with nothing on
  its swept line → `multiSpecialFired: false`.
- A rejected (no-match) move → `multiSpecialFired: false`.
- `shouldShowChainReactionTutorial`'s once-ever gate: shows when fired and
  unseen, never shows again once dismissed, never shows when the move only
  fired a single special, and is unaffected by the other three tutorials'
  seen state (distinct id).

All 338 tests pass.
