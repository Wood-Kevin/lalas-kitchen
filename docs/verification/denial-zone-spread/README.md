# Dynamic denial-zone spread — verification

`denial-spread-filmstrip.png` verifies the **dynamic denial-zone spread**
mechanic (see `engine/DECISIONS.md`'s denial-zone-spread entry and CLAUDE.md's
Data Model Notes): on a gated generated level, a blocker denial zone that's left
unaddressed **spreads into an adjacent ordinary cell**, and the move before it
spreads the frontier cell shows a **calm crack + dimming glow** so the growth is
never silent or sudden.

Captured the same way the area-bomb / color-bomb verifications were — a throwaway
`*.test.ts` harness (deleted after capture, per the WSL screenshot note) that
drives the **real `applyMove`** through the **real `stepDenialZone`** logic and
projects each real post-move board to HTML on the skin's real palette using the
app's real bundled sprites. **Every engine outcome is asserted with `expect()`
before the image is written**, so the artifact can't claim success on a broken
run. The warning overlay's CSS mirrors `components/Tile.tsx`'s
`SpreadWarningOverlay` (dark dimming wash + accent glow + a thin diagonal crack).

## Why this level's numbers

The header numbers are the **real** gated level-10 values, not invented: a
generated level at `generatedLevelNumber === 10` has `movesLimit 20`, places 4
blockers, and — being at or past `DENIAL_SPREAD_MIN_LEVEL_NUMBER` (10) — has
`denialSpread: true` (asserted directly against `buildGeneratedLevelConfig`).
`createGameState` derives `spreadInterval = round(0.25 × 20) = 5` from that budget
(a 30-move level would derive 8 — the timing is proportional, not fixed). The
demo uses a 2×2 `cling` cluster (the blocker the generator rotates in at level
10) and an unaddressed match far from the cluster each move.

## What the image shows

- **1 · Zone at rest.** The 2×2 cling cluster sits quiet. The spread clock is at
  3 of 5 unaddressed moves — no warning. Four blockers.
- **2 · Warning (move before spread).** An unaddressed move takes the clock to 4
  of 5. The deterministic frontier cell (the ordinary cell right of the cluster)
  shows the crack + dimming glow. It is **still an ordinary, matchable piece**
  (`type === 'normal'`, `spreadWarning === true`) — matching it, which damages the
  adjacent blocker, is exactly how a player defuses the spread. Still four
  blockers: nothing has spread yet, and this board is visibly distinct from
  panel 1.
- **3 · Spread.** One more unaddressed move (clock 5): the cracked cell has become
  a `cling` blocker — the top row now shows three cling tiles. **Five** blockers;
  warning gone; clock reset to 0.

## Engine outcomes asserted before the render

- Panel 1: 4 blockers, 0 warnings on the raw board.
- Panel 2: a real move was spent (`movesRemaining 20 → 19`); **4** blockers (no
  spread); exactly **1** warning; the warned cell is `type === 'normal'` with
  `spreadWarning === true`.
- Panel 3: **5** blockers; the frontier cell is now `type === 'blocker'`; **0**
  warnings; `denialSpread.movesUnaddressed` reset to 0.

## Live-motion captures (the two gaps the static filmstrip couldn't close)

`denial-spread-filmstrip.png` above is a **settled-board** filmstrip: it proves
the engine's outcomes at rest, but it can't show *motion* — neither the defuse
happening nor the warning breathing. Two follow-up captures close that, both
driven through the **real running Expo-web app in Windows Chrome over CDP** (the
same rig the striped-sweep and drag-timing verifications used), not a mock or a
`--screenshot` of virtual time. The throwaway render harness mounts the **real
`Tile`** (hence the real `SpreadWarningOverlay` + real Reanimated) and calls the
**real `applyMove`** in the page; every number in the images is baked into the
pixels from the live `GameState` (`performance.now()` in the corner), so the
artifact can't overstate a broken run.

### 1 · The defuse path — `defuse-filmstrip.png`

The gap: the static strip only ever showed the *unaddressed* path (the zone
spreading). This shows the **addressed** path — a player matching the warned cell
*before* it spreads — as a real live transition.

- **Warned** (`t≈5044ms`): the 2×2 covered-dish denial zone, its frontier cell
  (0,2) lit with the crack + dimming warning. Live readout: `clock:4/5`,
  `warnings:1`, `blockerHealth:8`.
- One real swap forms a 3-run through the warned cell (0,2). `window.__defuse()`
  runs the **real `applyMove`**; React re-renders from the returned `GameState`.
- **Defused** (`t≈5909ms`): warning **gone**, clock **reset 4/5 → 0/5**, blocker
  health **8 → 6** (both dishes took a hit → the move is "addressed"), one move
  spent (19 → 18). The zone did not spread.

A 6-frame burst captured immediately after `__defuse()` confirmed the warning's
DOM element (`[data-testid="spread-warning"]`) was **absent on the very first
post-move frame** and stayed absent, with `warnings:0 clock:0 health:6` on every
frame — the visual clear and the clock reset land together on the committed move.

**Proven:** the warning visually clears and the clock genuinely resets on a real
addressed move, through the real engine → real render path.
**Honestly not claimed here:** this harness renders the committed board directly;
it does not replay `applyMove`'s intermediate cascade `steps` frame-by-frame
(the per-cascade animation staging is Board's job and a separate, already-built
concern). What's shown is the before/after of one real committed move, not the
mid-cascade in-betweens.

### 2 · The warning breath — `warning-breath.png` + `warning-breath-samples.json`

The gap: does the 900 ms `SPREAD_WARNING_PULSE_MS` glow actually read as a *calm,
gradual* breath rather than an abrupt blink? That's a wall-clock motion question,
so it needs frame sampling, not a still. The glow's opacity was read every
animation frame straight off the live DOM element
(`getComputedStyle(glow).opacity`) over 2.4 s of the real animation — **145
frames at ~60 fps** (`warning-breath-samples.json` is the raw trace).

Measured against the spec:

- **Half-cycle = 901 ms** peak → trough (spec `SPREAD_WARNING_PULSE_MS = 900`).
- **Opacity 0.180 → 0.500** across the breath (spec 0.18 ↔ 0.50).
- **Max per-frame step 0.012** (mean 0.006) over a 0.32 range — a hard flash
  would jump ~0.32 in a single frame; this is ~1/27th of that. The plotted curve
  **eases in and out at each extreme** (Reanimated's default easing), slowest
  exactly where it turns around — the signature of a slow breath, not a blink.

The two stills (trough ≈0.18, peak ≈0.50) look **only subtly different** on
purpose: per `SpreadWarningOverlay`'s own comment, the dark dimming wash and the
crack are **steady, not opacity-animated**, so the warning reads unambiguously at
any phase; only the accent glow breathes on top. So the still-to-still delta being
gentle is itself the calm brief holding — and the per-frame trace is the honest
motion proof, not the pair of stills.

**Proven:** the breath's cadence (901 ms), range (0.18–0.50), and smooth eased
shape, on real Reanimated motion sampled on the real clock.
**Honest caveat (same as drag-timing's):** Reanimated runs on the JS thread on
web, so this is web-thread motion, not a native-device UI-thread capture; the
timing curve itself is identical (it's a plain `withTiming`/`withRepeat`), but a
native frame grab was not done.

## Where the logic and tests live

- `engine/matrix.ts` — the `spreadWarning` field on `Piece`; `findSpreadTarget`
  (the deterministic frontier scan).
- `engine/gameState.ts` — `DenialSpreadState`, the `SPREAD_MOVE_FRACTION`
  interval derivation in `createGameState`, and `stepDenialZone` (called in
  `applyMove` before the legal-move rescue).
- `appPersistence.ts` — `DENIAL_SPREAD_MIN_LEVEL_NUMBER` (10) and the
  `buildGeneratedLevelConfig` gate.
- `components/Tile.tsx` / `components/Board.tsx` — `SpreadWarningOverlay` and the
  `spreadWarning` prop wiring.
- Tests: `engine/gameState.test.ts` (`applyMove — dynamic denial-zone spread`:
  below-threshold never spreads, spread at interval for two budgets, proportional
  interval derivation, warning distinguishable, addressing resets the clock) and
  `engine/matrix.test.ts` (`findSpreadTarget`). All tests pass.
