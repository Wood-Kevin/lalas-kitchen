# Area-bomb powder animations — idle drift & trigger poof

Two presentation-only powder moments added to the `area_bomb` piece, verified
against the **real** running app (real `Tile`/`ExitingTile`, real Reanimated,
real sprite path), not a mock.

## How it was captured

Reanimated animations advance on real wall-clock time, so a one-shot
`--screenshot` (which uses virtual time) can't capture them — the live-motion
CDP approach from `docs/verification/denial-zone-spread/` was reused. A
temporary `?harness=powder` gate in `App.tsx` mounted a real 3×3 scene — the
`area_bomb` piece (rendered by the real `Tile`) in the centre, eight ordinary
food pieces around it — exactly the cells a real 3×3 blast clears. Windows
Chrome was driven headless over CDP from WSL: a `requestAnimationFrame` loop
sampled the live DOM (`getComputedStyle().opacity`/`transform`) every frame with
`performance.now()` timestamps, and `Page.captureScreenshot` grabbed the frames.
The harness (`components/PowderHarness.tsx`) and the App gate were reverted after
capture — neither ships.

## Idle drift (`idle-filmstrip.png`)

While the bag rests unmatched on the board, a soft pale wisp of powder drifts up
from its tied top and loops calmly, forever. It reuses `SteamWisp`'s established
motion exactly (rise + fade, `1800ms`, `Easing.out(Easing.quad)`, no scale
spike), so it reads as the same calm material as the app's other wisps rather
than a new effect competing with ordinary tiles.

**Live trace (`idle-samples.json`, 133 frames over 2.2s):**
- opacity cycles `0.000 → 0.692` (envelope peaks at the intended `0.7`) and back
- `translateY` sweeps `0 → −21.8px` (≈ `tileSize × 0.34`) — the upward drift
- the cycle repeats continuously (two wisps on a half-cycle stagger, so there is
  always some powder in the air)

The filmstrip panels show the wisp at the knot → rising → drifted to the top →
fading as the loop restarts.

## Trigger poof (`burst-filmstrip.png`)

The instant the bag detonates, a soft powder cloud puffs outward from it,
expanding past the tile into the surrounding 3×3 **as those cells clear** — so
the burst visibly reads as the cause of the surrounding clear, not a flourish
layered on top. It lives in a sibling view of the shrinking bag (so it grows
while the bag shrinks away underneath it) and runs on the same `matchDurationMs`
(300ms) clock as the clear — no new pacing invented.

**Live trace (`burst-samples.json`, 26 frames over 420ms):**
- cloud `scale` `0.40 → 2.10` — swells past the tile into the 3×3
- cloud `opacity` peaks `0.85` then fades to `0` (quick swell, ease-out
  expansion, fade as it grows)

The filmstrip panels show: resting 3×3 → fire → cloud growing (~55ms) → cloud
spread over the whole 3×3 while every cell shrinks/fades (~100ms) → fading
(~150ms).

## Where the logic and tests live

- Idle wisp: `components/Tile.tsx` — `PowderWispOverlay` / `PowderWisp`
  (`POWDER_WISP_CYCLE_MS`, `POWDER_WISP_COLOR`), gated by the `powderWisp` prop.
- Trigger poof: `components/Tile.tsx` — `ExitingTile`'s `isPowderBurst` branch
  (`burstScale`/`burstOpacity`) + the sibling burst view.
- Wiring: `components/Board.tsx` sets `powderWisp={piece.type === 'area_bomb'}`
  on the live tile and `isPowderBurst={entry.pieceType === 'area_bomb'}` on the
  exiting tile — the same per-type-from-engine pattern as `direction` and
  `isBlockerClear`, presentation only.
- All 287 existing tests still pass (`npx jest`); the engine is untouched.
