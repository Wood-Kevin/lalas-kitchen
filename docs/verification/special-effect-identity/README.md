# Distinct animation identities — color bomb, cross combo, supercombo

Four frames (`effects-t040-early.png` through `effects-t450-settled.png`) verify
that the three swap-triggered effects that previously shared the generic flat
"everything vanishes at once" clear now each have their own presentation
identity, and that all three are genuinely distinct from each other — not just
differently colored versions of the same flourish.

## What was found before this session (investigation)

- **A solo striped piece caught in an ordinary match** already had a real
  identity: the traveling sweep beam (`components/sweepAnimation.ts` +
  `Tile.tsx`'s `ExitingTile` `sweepDelayMs` branch, see
  `docs/verification/striped-sweep/`).
- **A striped piece caught via chaining** (a special caught in another
  effect's clear, see `engine/DECISIONS.md`'s special-piece-chaining entry)
  already replayed the SAME real sweep correctly — it survives into
  `diffBoards`' `cleared` list with its real `type: 'striped'`/`direction`
  intact, and `sweepDelaysForClears` already treats it as a genuine beam
  origin. Confirmed directly in code (`expandChainClears` never mutates a
  caught special's type before it clears) — this path needed no fix.
- **The cross combo** (two striped pieces swapped) only got an *accidental*,
  frequently-wrong partial sweep: `sweepDelaysForClears` was reading each
  swapped piece's own *original* direction, not the true cross geometry
  (`resolveStripedCross`'s cross is always centered on posA, in BOTH
  directions, overriding each piece's individual direction). A piece whose
  original direction was `'col'` contributed zero delay to cells on the
  row half of the cross. Fixed properly rather than left "mostly working by
  luck."
- **The supercombo and solo color bomb detonation** got zero special
  treatment. A supercombo's "converted" cells are never actually mutated to
  `type: 'striped'` in the board (the engine computes the settled union of
  sweeps directly — see `engine/DECISIONS.md`'s special-piece-combos entry),
  so they never satisfied `sweepDelaysForClears`' origin check. A solo color
  bomb's cleared cells are ordinary same-matchType pieces, never striped
  either. Both fell through to `ExitingTile`'s final plain
  opacity/scale-to-zero branch — the flat generic vanish.

## The three new identities (presentation only, see `components/specialEffectAnimation.ts`)

1. **Color bomb — radial ripple.** A circular ripple (`Tile.tsx`'s new
   `radialGlow` overlay, `borderRadius: 999` vs. the sweep's square wash) timed
   by real Euclidean distance from the swapped bomb, normalized to a fixed
   total wave duration (`COLOR_BOMB_WAVE_MS`) so a board-spanning detonation
   always finishes in one calm beat regardless of board size.
2. **Cross combo — the existing sweep, corrected and extended bidirectionally.**
   Reuses the exact same `sweepDelayMs`/`sweepGlow` visual the solo striped
   sweep already has (no new Tile.tsx code) — only the delay computation
   changed, from each piece's own direction to a single true center (posA)
   sweeping both axes at once (`crossOriginDelays`).
3. **Supercombo — two distinct beats.** A brief flicker ("conversion",
   `Tile.tsx`'s new `convertFlash` overlay, a double-blink rather than a smooth
   brighten) plays on every converted piece, THEN every converted piece (plus
   the bomb cell) pops together at one synchronized delay
   (`SUPERCOMBO_CONVERT_MS`) rather than traveling — "sweeping together," not
   staggered. This resolves the "convert-to-striped flash" item
   `DEFERRED_COMPLEXITY.md` had carried since combos first shipped (the
   general per-link chaining flash is a separate, still-deferred item).

## What the filmstrip shows

Three boards side by side (color bomb: 8×8, whole-board detonation; cross
combo: 7×7; supercombo: 7×7), all firing from the same real `applyMove` call at
t=0, captured together so the SAME moment in time is directly comparable across
all three:

- **t040 (early):** the color bomb's near-origin cells have already popped
  while the far corner is still untouched — the wave has started. The cross's
  center cells (dist 0–1) are mid-brighten. The supercombo's scattered
  converted cells show the low, uneven opacity of the flicker's first beat,
  while its bomb/origin cells sit untouched, still waiting on the flash.
- **t170 (mid):** the color bomb's far corner is now at its brightest/largest
  — the ripple has traveled almost the full diagonal — while the near-origin
  cells have already faded. The cross now shows only its three farthest tips
  still visible, everything closer to center already cleared — a beam that
  swept past. The supercombo's origin/bomb cells are just beginning their
  synchronized pop while scattered converted cells are at various fade stages
  — a rhythm that does NOT follow a distance gradient the way the other two
  do, which is the point: it's "together," not "traveling."
- **t280 (late):** the cross and supercombo boards are already fully clear;
  only the color bomb's two farthest cells are still finishing — the
  radial wave's board-spanning reach legitimately takes a little longer than a
  local sweep or a synchronized pop, and reads that way on screen.
- **t450 (settled):** all three boards are empty. Every effect resolves within
  one calm, bounded beat — no effect drags on longer than the others by more
  than a fraction of a second.

## How this was captured

A throwaway harness (`components/__harness__/EffectIdentityHarness.tsx`,
deleted after capture) built three hand-authored boards on a diagonal Latin
square (`type = TYPE_CYCLE[(r+c) % 6]`, the same zero-incidental-matches
construction `docs/verification/special-piece-combos/` used, since a hand-built
board skips the generator's own match-free guarantee) and ran the **real**
`applyMove` for each swap. The real `diffBoards`, `resolveSpecialEffectDescriptor`,
and `buildPassAnimation` derived the real per-tile delays, rendered through the
**real** `ExitingTile` component (Reanimated animation, not simulated). A
temporary `?harness=effects` gate in `App.tsx` (reverted immediately after
capture) served it over the real Expo web dev server; frames were grabbed live
over Chrome DevTools Protocol against headless Windows Chrome (Reanimated
advances only on a real wall-clock, so a one-shot `--screenshot` can't sample
it — see the WSL screenshot-verification note). Tiles show the text-label
placeholder sprites (no asset map wired into the harness) and the skin's real
palette (accent `#A83A2E` over the cream `#FBF3E1` panel).

## Test coverage

Presentation only — zero files under `engine/` changed this session
(confirmed via `git status`). All 453 existing tests pass unchanged, including
every engine test for color bomb/combos/chaining, `sweepAnimation.test.ts`
(untouched), and `exitingTile.test.ts` (its existing 4-arg `buildExitingEntry`
calls still work — the two new fields are additional optional params). New:
`components/specialEffectAnimation.test.ts` (16 cases covering
`resolveSpecialEffectDescriptor`'s precedence, `radialDelaysForClears`'
normalization, `crossOriginDelays`' bidirectional geometry,
`supercomboConvertedIds`' classification, and `buildPassAnimation`'s merging —
including that a genuinely different chained special keeps its own authentic
sweep inside a cross or supercombo pass).
