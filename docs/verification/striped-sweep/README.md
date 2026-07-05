# Striped sweep — travelling-glow verification

The four `sweep-t*.png` frames were captured from the **real `ExitingTile`**
(`components/Tile.tsx`) driven by the **real `sweepDelaysForClears`**
(`components/sweepAnimation.ts`) — a throwaway harness (not in the repo) mounted a
full 8-tile swept column exactly as `resolveMatchEffects` produces one (a striped
piece at the top, ordinary pieces down the rest of the column) and let the real
Reanimated animation play. Frames were grabbed live over Chrome DevTools Protocol
against Windows Chrome (Reanimated advances only on a real wall-clock — it ignores
headless virtual time, so a single `--screenshot` can't sample it; CDP burst
capture can). The bottom-left readout is each frame's real elapsed time, written
from a rAF loop so the timestamp is baked into the pixels, not asserted after the
fact. Tiles show the `TO` text-label placeholder and the skin's real palette
(accent `#A83A2E` glow over the cream panel).

Reads as a sequence — the bright leading edge travels top → bottom:

- **`sweep-t034-rest.png`** (~34 ms) — the beam has just started; all tiles still
  essentially at rest. Establishes the starting column.
- **`sweep-t166-top.png`** (~166 ms) — tiles 0–1 glowing strongly (accent wash +
  slight pop), tile 2 just beginning to brighten, tiles 3–7 untouched. The beam's
  leading edge is near the top.
- **`sweep-t301-mid.png`** (~301 ms) — the origin tile is shrinking away at the
  top, the bright edge has moved down to tile 2, tile 3 is starting; lower tiles
  still at rest.
- **`sweep-t433-lower.png`** (~433 ms) — the top tiles are gone (cleared), the
  bright edge is now at tiles 4–5, and the tiles below are only just beginning.

Together they confirm the point of the change: **individual tiles along the
sweep react at different moments** as a gentle glow travels down the line, rather
than the whole row/column brightening and clearing all at once. It's a travel
cadence at the calm 55 ms/tile pacing (`SWEEP_TILE_STAGGER_MS`), not a flashier
or faster effect — per CLAUDE.md's "calm, not frantic" constraint.

**Presentation only.** No engine, config-schema, or phase-boundary change — the
sweep is derived entirely from data `diffBoards` already surfaces (the matched
striped piece's surviving `type`/`direction`). All **197** engine/component tests
pass, including the new `components/sweepAnimation.test.ts` (6 cases: row/column
stagger by distance, off-axis trigger cells excluded, crossing-beam nearest
origin, blocker keeps its own beat).
