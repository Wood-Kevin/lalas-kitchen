# Generator-driven board shapes — verification

`generated-shaped-level.png` verifies that the level **generator** (not just
the hand-built "Cutting Board" showcase level) can produce a genuinely
**non-rectangular** board, reusing the existing `void`-cell engine mechanism
(see CLAUDE.md's board-shape / void-cell Data Model Note). This is the first
capture of a shaped board that nobody hand-authored — the void positions come
from `appPersistence.ts`'s `generatedShapeId` gate and `engine/boardShapes.ts`'s
curated templates, exercised at their real generated-level cadence.

## How this was captured

Driven against the **real running app**, not a synthetic harness: the Expo
web dev server (`npm run web`, `localhost:8081`) and a headless Windows
Chrome (`chrome.exe --headless=new --remote-debugging-port=9222`, launched
from WSL2 — this environment's loopback is shared with Windows in mirrored
networking mode, so `localhost:9222` reaches it directly with no proxy),
driven over raw CDP via this repo's own `node_modules/ws`. Same recipe as
`docs/verification/dev-reset/` and `docs/verification/denial-zone-spread/`.

Steps actually performed:

1. Loaded `localhost:8081` once to warm the bundle.
2. Seeded `localStorage['lalas-kitchen:save:cooking-lalas-kitchen']` (the real
   key from `engine/gameState.ts`'s `saveKey`) with a `SaveData` whose
   `completedLevels` is `[1..11]` and `seenTutorials` includes every tutorial
   id, so `components/levelProgress.ts`'s `resolveNextUnplayedLevel` lands on
   level 12 with no tutorial overlay in the way.
3. Reloaded. Home rendered **"UP NEXT · LEVEL 12"** / **"Level 12"** —
   confirmed via `document.body.innerText` before touching anything else.
4. Dispatched a real `Input.dispatchMouseEvent` click on the "Start cooking"
   button (found by locating the DOM node whose `textContent` is exactly
   "Start cooking" and reading its real `getBoundingClientRect()`, not a
   guessed coordinate).
5. Captured `Page.captureScreenshot` once the board rendered.
6. Counted rendered tile nodes directly in the page (`Runtime.evaluate`):
   every absolutely-positioned 90×90px div — **28** of them, all the same
   size, nothing more.

## What the screenshot shows

- HUD reads **"Level 12"**, proving this is the generator-driven level, not
  the hand-built Level 4 "Cutting Board."
- `Target 0/13`, `0/13` (two objectives — this generated level's piece pool
  has grown past 5 types, per the existing multi-objective gate),
  `Moves 21`, `Lives 5`.
- The board's row pattern, top to bottom, is **1, 3, 5, 5, 5, 5, 3, 1** tiles
  — all **4 corners visibly notched**, background showing through where a
  tile would otherwise sit. This is the exact shape `cutCornersVoids(8, 5)`
  predicts: row 0 voids cols 0,1,3,4 (1 tile left, col 2); row 1 voids cols
  0,4 (3 tiles left); rows 2–5 are untouched (5 tiles each); rows 6–7 mirror
  rows 1 and 0. `1+3+5+5+5+5+3+1 = 28`.
- Structural check: exactly **28** rendered tile nodes in the DOM (all
  90×90px), matching `8×5 − 12 voids = 28` exactly.

Level 12 = generated level number 8 (`levelIndex − LEVEL_QUEUE.length`, and
`LEVEL_QUEUE` is length 4), the first generated level at or past
`generatedShapeId`'s threshold of 8, landing on `BOARD_SHAPE_ROTATION[0]` =
`'cut_corners'` — all consistent with what was predicted going into this
capture, not adjusted after the fact.

## Where the logic and tests live

- `engine/boardShapes.ts` — the 3 curated pure shape templates
  (`cutCornersVoids`, `plusVoids`, `ringVoids`) and `BOARD_SHAPE_ROTATION`.
- `appPersistence.ts` — `generatedShapeId` (the below-threshold/cadence/
  rotation gate) and `buildGeneratedLevelConfig`'s `voidCells` wiring.
- `engine/boardShapes.test.ts` — unit coverage of each template.
- `engine/generator.test.ts` — `describe('generateLevel — curated shape
  templates (boardShapes.ts), at the real generated-level board size')`
  exercises each template against the real 8×5 generated-level size.
- `appPersistence.test.ts` — `describe('generatedShapeId')`: below-threshold
  returns `undefined`, on-cadence rotation, determinism.
- All 399 jest tests pass (confirmed in the implementation session; not
  re-run here since nothing in this pass touched source).

## Cleanup

The background `npm run web` dev server and the headless Chrome process
launched for this capture were both killed after the screenshot was saved.
No source file was modified — this was a read-only verification pass.
