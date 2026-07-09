# FINAL STEP — full test suite + cross-feature live sanity pass

Closes out the 14-item closing pass: full test suite run, then a real
cross-feature session touching several systems built across this pass
together, not just each in isolation again.

## Full test suite

613 tests passing across 27 suites (up from the session's starting count).
No skipped/failing tests. Command: `npx jest`.

## Cross-feature live session

Crafted a save reaching **generated level 16** (real level 24, past the
8 hand-built levels) — chosen because it's the first level number where
two features built in *different* parts of this session's history
genuinely compose on the same board:

- **`sealed_jar` (blocker depth, this session)** — eligible from generated
  level 12, and `chosenBlocker`'s rotation lands on it at level 16.
- **Dynamic denial-zone spread (an earlier session's feature)** — eligible
  from generated level 10, so it's active here too.
- The generator's own difficulty ramp, piece-type pool, and moves/target
  calculation (multiple earlier sessions) all still apply underneath both.

`level24-sealed-jar-plus-denial-spread.png` — the real board loaded with
four genuine `sealed_jar` ("SE" placeholder) blockers, confirmed via
`[data-testid^="tile-blocker"]`.

Performed two real moves via the Hint button (tap-tap swaps at real
`getBoundingClientRect()` coordinates), then a free Shuffle:

- Move 1: Moves 18→17, zero JS errors (a `window.onerror`/`console.error`
  capture hook was installed before any interaction).
- Move 2: Moves 17→16, chili objective credited 0→3, zero errors.
- Shuffle: `level24-after-real-moves-and-shuffle.png` — confirmed the four
  blockers stayed in place (blockers are excluded from the shuffle's
  permutation, matching `docs/verification/manual-shuffle/`'s own
  precedent) while ordinary pieces visibly rearranged.

This confirms the level genuinely loads and accepts real player input
without crashing or misbehaving with both mechanics simultaneously active
— the actual point of a cross-feature check, since each mechanic was unit-
tested and live-verified independently but never previously exercised
together in the real running app.

**Crash telemetry sanity check**: read `SaveData.lastCrash` directly from
`localStorage` at the end of the session — `null`, confirming
`ErrorBoundary`'s crash-recording path (item 4) never fired a false
positive during any of this session's live testing (across items 10, 11,
and this final pass).

## A real accuracy correction this pass caught

While tracing exact tile coordinates for this cross-feature move sequence,
`getBoundingClientRect()` queries on `[data-testid="tile-{row}-{col}"]`
returned positions that didn't match the visual grid at all after a
shuffle — tracing this down revealed that a tile's `data-testid` is keyed
by the piece's **stable id** (assigned once at spawn/placement), not
recomputed from its current board position. This meant item 11's original
live-verification claim that four `sealed_jar` blockers "remained at their
exact original positions" after an ordinary match was **not actually what
that DOM check verified** — only that the same four blocker ids still
existed (proving zero damage, since a 1-hit blocker has no partial-damage
state to miss), not that they hadn't physically moved. Blockers are NOT
anchored like a void cell: `calculateCascades` compacts a blocker toward
the bottom of its column segment exactly like any surviving ordinary piece
whenever cells clear in that segment — it's excluded only from
matching/swapping/being force-cleared, not from gravity. The blocker
originally at (1,1) shared a column with the cleared match, so it most
likely did shift position — a separate, correct, unrelated behavior. Both
`engine/DECISIONS.md`'s blocker-depth entry and
`docs/verification/blocker-depth/README.md` were corrected in place rather
than silently left overclaiming. See those files for the full correction.
