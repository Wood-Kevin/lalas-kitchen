# Chain-reaction per-link animation staging — live verification

Date: 2026-07-19. Verified against the real running app (expo web dev server,
driven in a real Chrome browser with a live renderer — the in-app preview
pane's frame loop was suspended this session, `requestAnimationFrame` never
fired there, so it could not play animations at all; disclosed, not hidden).

## What was verified

A temporary, URL-gated (`?chainDebug=1`), removed-after-capture debug hook
(the same convention as the accessibility pass's `?fontScaleDebug`) crafted
level 1's board with a color bomb at (0,0) and a column-striped tomato at
(4,2), so one real two-tap swap — real clicks on the real tiles — produced a
genuine bomb-detonation-catches-striped chain. A matching temporary console
trace logged each pass's computed `PassAnimation` delays.

### Run 1 — caught a real bug the unit tests missed

The first live run's pass-0 trace showed `chainHoldMs=260` (the engine's
wave metadata arrived correctly) but the wave-1 offsets had been applied to
the RADIAL delay channel for the swept column's cells:

    sweepDelays=[["0-2",220],["1-2",165],...]  (unstaged)
    radialDelays=[...,["5-2",458],["6-2",493],["7-2",528],...]  (staged +260)

Those cells carry BOTH channels in a color-bomb pass (the generic sweep from
the caught striped origin AND the ripple's every-cleared-cell radial), and
`Tile.tsx`'s `ExitingTile` plays the sweep channel first — so the staging
silently didn't play. `applyChainStaging`'s channel priority was fixed to
mirror ExitingTile's exactly (sweep whenever a sweep entry exists or neither
does; radial only when it's the sole channel), with a dedicated dual-channel
regression test added (`specialEffectAnimation.test.ts`).

### Run 2 — the fix confirmed live

The identical replayed move's pass-0 trace after the fix:

    chainHoldMs=260
    sweepDelays=[["0-2",480],["1-2",425],["2-2",110],["3-2",55],["4-2",0],
                 ["5-2",315],["6-2",370],["7-2",425]]
    radialDelays=[["0-0",0],...,["4-2",164],["5-2",198],...,["7-3",280]]  (pure, unstaged)

Exactly the designed staging, on the channel that plays:
- wave-1 cells = beam travel + 260ms wave offset ("0-2": 220+260=480,
  "5-2": 55+260=315, "7-2": 165+260=425);
- cells the detonation itself cleared at wave 0 — including the caught
  striped piece's own cell ("4-2": 0) and the tomatoes already on the swept
  column ("2-2": 110, "3-2": 55) — carry NO offset;
- radial delays stay pure distance-normalized (max "7-3": 280 =
  COLOR_BOMB_WAVE_MS), staging the ripple's own wave-0 identity untouched;
- passes 1–2 (ordinary refill cascades, no chain): chainHoldMs=0, empty
  maps — the chainless schedule is byte-identical to pre-staging.

Both moves committed identically (Target 7/15, Moves 19) — staging is
presentation-only, the settled result unchanged.

### Also confirmed live in the same session

- The chain_reaction tutorial ("Everything at Once") fired from run 1's
  genuine 2-special pass (`multiSpecialFired`), and the color_bomb tutorial
  fired on run 2's mount with the real potion-bottle sprite — after run 1's
  60s cadence throttle had correctly deferred it.
- Lives badge on Home (flame + 5, hero top-right corner) rendering live.
- Settings' new "Version 1.0.1" footer rendering live.
- Ordinary post-chain cascade passes animating and committing normally
  (no regression on the chainless path).

## Disclosed gaps

- No frame-by-frame video/GIF of the staged animation itself — the evidence
  is the computed per-tile delay trace from the real running pipeline (the
  exact values `ExitingTile` schedules its Reanimated delays from), plus the
  settled outcomes. A human eyeball pass on a real device (the App Store
  build) is the remaining honest check, same as every animation feature.
- Only the bomb-catches-striped chain shape was driven live; deeper chains
  (wave 2+) are covered by engine unit tests (the three-link 1→2→3 wave
  assertions in gameState.test.ts), not a live capture.
