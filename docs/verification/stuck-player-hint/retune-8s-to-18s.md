# Retune: HINT_IDLE_MS raised from 8000ms to 18000ms — verification

`before-idle-18s.png` / `hint-appears-18s.png` verify the retuned threshold
(see `engine/DECISIONS.md`'s stuck-player-hint entry, retune addendum, and
`CLAUDE.md`'s calm-not-frantic constraint): the original 8000ms read as
fighting that same principle for a player whose normal thinking/scanning
pace can easily exceed 8 seconds on a genuine turn. `components/Board.tsx`'s
`HINT_IDLE_MS` is now `18000`.

## How this was captured

Same rig as the original capture in this folder's `README.md`: the existing
Expo web dev server on `localhost:8081`, driven from WSL2 over raw CDP
against a headless Windows Chrome (`chrome.exe --headless=new
--remote-debugging-port=9222`), using this repo's own `node_modules/ws`.

Steps actually performed:

1. Connected to the already-running dev server, seeded a `SaveData` blob
   into `localStorage`, and navigated to `localhost:8081`. The hand-seeded
   blob didn't fully match the persisted schema, so `loadSave`'s
   corrupted/invalid-save fallback (see this project's safety-hardening
   fix) correctly produced a genuinely fresh save instead of crashing —
   itself a small live confirmation that fallback still works, not a
   scripting bug worth masking.
2. Clicked "Start cooking" (found by real text search + `scrollIntoView`,
   since the button sits below the fold at this viewport size — the
   original capture used a wider window that didn't need this).
3. A fresh save shows the `how_to_play` onboarding tutorial on level 1's
   first load; dismissed it with a real click on "Got it", confirmed via
   `document.body.innerText` that no overlay remained.
4. From that moment (`t0`), made **zero further input** and polled
   `document.querySelectorAll('[data-testid="hint-glow"]').length` every
   ~700ms.
5. Captured `before-idle-18s.png` at **6316ms** (no glow). The poll
   immediately before the hint appeared, at **16889ms**, still showed zero
   `hint-glow` nodes; the hint first appeared at **17591ms**, where
   `hint-appears-18s.png` was captured.

The ~17.6s observed figure, not an exact 18000ms, is expected: `t0` is set
by this script right after the dismiss-click completes, while the real
`Board.tsx` effect re-arms on the tutorial-dismiss state change slightly
earlier in that same render pass, and the poll only samples every ~700ms —
both push the *observed* figure a little under the true 18000ms window.
What matters for this verification is the delta from the old behavior: the
original capture's hint appeared at 8458ms; this one didn't appear until
past 16889ms — over double the wait, consistent with the constant actually
having changed, not a rounding artifact.

## What the screenshots show

- **`before-idle-18s.png`** — Level 1 "Tomato Toss," `Target 0/15`,
  `Moves 20`, `Lives 5`, no overlay, no glow, ~6.3s into the idle window.
- **`hint-appears-18s.png`** — Same board, same seed, ~17.6s in. Two tiles
  carry the same soft rosy-pink breathing glow as the original capture:
  `tile-0-1` (tomato) and `tile-1-1` (garlic). Verifiable straight off the
  board: row 0 reads garlic, tomato, garlic — swapping the glowing tomato
  into (1,1)'s garlic position drops a garlic into (0,1), completing
  garlic/garlic/garlic across row 0, a real 3-in-a-row exactly as
  `findAnyLegalMove` is contracted to return.

## Test suite

Ran `npm test` after the `HINT_IDLE_MS` change and the doc updates
(`CLAUDE.md`, `engine/DECISIONS.md`, `DEFERRED_COMPLEXITY.md`, this folder's
`README.md`): all existing tests still pass, including
`components/stuckHintTiming.test.ts` (asserts only the generic cancel/arm
semantics via mocked `schedule`/`cancel`, never the literal constant) and
`engine/matrix.test.ts`'s `findAnyLegalMove` block — neither depends on the
specific millisecond value, as expected from the original investigation.

## Cleanup

The headless Chrome process launched for this capture was killed after the
screenshots were saved. The pre-existing Expo web dev server (already
running from an earlier session on port 8081) was left untouched, since
this session didn't start it and other work may depend on it.
