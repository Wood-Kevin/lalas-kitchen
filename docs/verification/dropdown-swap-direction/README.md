# Dropdown swap direction (sideways only) — verification

Verifies `engine/DECISIONS.md`'s dropdown-swap-direction entry: a dropdown
(escort) piece's always-legal swap is now restricted to sideways (same-row)
movement only — a vertical (up or down) swap is rejected the same way an
ordinary illegal swap is, snapping back with no move spent. Investigated and
built after a real playtest report flagged unrestricted swapping as feeling
like a bug; confirmed the original design intent (`matrix.ts`'s `Piece`
comment, `findAnyLegalMove`'s own comment, `engine/DECISIONS.md`) only ever
justified the always-legal rule in terms of sideways navigation.

## How this was captured

The Expo web dev server on `localhost:8081`, driven from WSL2 over raw CDP
against headless Windows Chrome (`node_modules/ws`), the same rig every
other verification doc in this project uses. A crafted save
(`completedLevels: [1..7]`, `currentLevel: 8`) routed straight to the real
hand-built "Delivery Day" level — the one with real `dropdownPositions`
(`{row:0,col:1}` and `{row:0,col:3}`, both top-row). All swaps below were
performed with two real CDP-dispatched tap gestures (tap the first tile,
tap the second adjacent tile), the same input method
`docs/verification/dropdown-escort-mechanic/` used, against the real running
app — not simulated engine calls.

## Sequence and results

Starting state: `Moves 24`, dropdowns at extracted grid positions
`(row1,col1)` and `(row1,col3)` (the level's row 0, offset by one row from
the HUD's own flame-icon sprite also matching the board-reading script's
image-based grid extraction).

1. **Downward swap attempt** — tapped the dropdown at `(1,1)`, then the
   ordinary piece directly below it at `(2,1)`. Result: `Moves` stayed at
   **24**, the dropdown was still at `(1,1)`, and `(2,1)` was unchanged —
   correctly rejected, no move spent.
2. **Sideways swap attempt** — tapped the same dropdown at `(1,1)`, then its
   left neighbor at `(1,0)`. Result: `Moves` dropped to **23**, the dropdown
   was now at `(1,0)`, and the ordinary piece that had been there was now at
   `(1,1)` — correctly succeeded, a real committed move.
3. **Genuine gravity via a real match** — to get the *other* dropdown off
   the top row for a real upward-swap test, tapped two ordinary pieces in
   column 1 (`(5,1)` and `(6,1)`, ordinary tomato/garlic, no dropdown
   involved) to form a real horizontal three-in-a-row at row 6 that happened
   to span column 3 as well. Result: `Moves` dropped to **22**, and the
   still-untouched dropdown at `(1,3)` fell to `(2,3)` — a real match
   clearing a cell in its column, resolved through ordinary gravity, not any
   dropdown-specific mechanism.
4. **Upward swap attempt** — tapped the dropdown now at `(2,3)`, then the
   piece directly above it at `(1,3)`. Result: `Moves` stayed at **22**, the
   dropdown was still at `(2,3)`, and `(1,3)` was unchanged — correctly
   rejected, no move spent.

`04-after-all-four-swap-attempts.png` — the real screenshot after all four
steps: one basket relocated sideways to the top-left corner, the other one
row down in column 3, `Moves` reading 22 (exactly the two real committed
moves — the two rejected attempts cost nothing), `Target` still `0/2` (ready
for the reader to confirm neither piece has reached the bottom yet).

## What was confirmed

- A vertical dropdown swap — both directions — is genuinely rejected by the
  real running app, not just by a unit test against the pure engine
  function: no move spent, no board change, the same snap-back an ordinary
  no-match swap gets.
- A sideways dropdown swap still works exactly as before: a real committed
  move with no match required.
- The piece's only route toward collection is now genuinely gravity-driven:
  a real ordinary match elsewhere in its column pulled it down one row, with
  no swap directly touching the dropdown itself.
- Full engine test suite: 617/617 passing (up from 613), including new
  direct coverage in `engine/gameState.test.ts` (downward/upward rejection,
  sideways success) and `engine/matrix.test.ts` (`findAnyLegalMove`/
  `hasLegalMoves` correctly excluding vertical dropdown pairs, including one
  case where the vertical swap would have incidentally formed a match for
  the displaced piece — confirming rejection is unconditional, not a
  fallthrough to the match check).
