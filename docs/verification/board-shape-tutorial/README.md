# Board-shape tutorial — verification

Verifies `board_shape` (`appPersistence.ts`'s `BOARD_SHAPE_TUTORIAL_ID` /
`shouldShowBoardShapeTutorial`) — the calm, once-ever "here's what this gap
is" card shown the first time a level's board actually contains a void cell,
so a non-rectangular shape reads as intentional rather than a rendering bug.
It's a mount-time tutorial (same shape as the blocker card), because a
level's void cells are fixed at generation and never appear mid-level.

Captured by driving the **real running Expo-web app** over CDP (headless
Windows Chrome, mirrored WSL2 networking — the established procedure this
project's other live captures use), not a mocked component tree or a board
fed directly into `shouldShowBoardShapeTutorial`.

## Method

1. Loaded the real app once, then seeded a realistic prior-progress
   `SaveData` directly into `localStorage['save:cooking-lalas-kitchen']`:
   `completedLevels: [1,2,3]`, `currentLevel: 4`, `seenTutorials:
   ['how_to_play']` (`board_shape` deliberately absent). This is ordinary
   save-state setup, not touching any detection function or the board itself.
2. Reloaded (genuine relaunch) and dispatched a real `Input.dispatchMouseEvent`
   click on Home's real "Start cooking" button.
3. `Start cooking` resolves via the real `resolveNextUnplayedLevel`, which
   lands on the real hand-built **Level 4 "Cutting Board"**
   (`App.tsx`'s `LEVEL_QUEUE[3]`, `PLUS_SHOWCASE_VOIDS` — a genuine plus
   shape on a 7×7 grid, 4 corner 2×2 blocks voided, 33 playable cells, no
   blockers).
4. Captured the overlay on first paint, then dismissed via a real click on
   "Got it", then did a genuine full page reload and re-entered the same
   level to check the once-ever guarantee.

## What the images show

**`1-overlay-on-load.png`** — the real plus-shaped board (all four corners
genuinely empty, no rendered tiles there) with `SpecialTutorialOverlay` up
immediately, **before any tap or move**: headline "A Different Shape",
subtext "A few spots on this board aren't part of play — just match around
the gaps like normal", the "BO" text-label placeholder icon (`board_shape`
has no piece to anchor an icon to — see `SpecialTutorialOverlay.tsx`'s
`piece: null` fallback). This is the one thing that distinguishes it from
every special-piece tutorial: those need a real forged piece and a move
first; this fires purely from the level's starting board.

**`2-dismissed-interactive-board.png`** — after a real click on "Got it": the
overlay is gone, the same plus-shaped board renders fully interactive, no
"Got it" text anywhere in the DOM.

**`3-no-overlay-on-replay-after-reload.png`** — after a genuine full page
reload and re-entering level 4 again: no overlay, board immediately
interactive. Confirms the once-ever guarantee across a real relaunch, not
just a re-render.

## Real outcomes confirmed during capture

- `localStorage`'s persisted save went from `"seenTutorials":["how_to_play"]`
  before dismissal to `"seenTutorials":["how_to_play","board_shape"]`
  immediately after clicking "Got it" — a real, immediate persist, not a
  deferred one.
- `completedLevels: [1,2,3]` also triggered the real, pre-existing
  `backfillUnlockedRecipeCards` on load (`unlockedRecipeCards` gained
  `tomato_stew`/`herb_garden_salad`, the levels-1-and-3 milestone cards) — an
  expected side effect of real app logic running end-to-end, not something
  this capture set up or asserts on.
- The real board underneath is visibly the plus shape in every screenshot,
  not a placeholder rectangle.

## Where the logic and tests live

- `appPersistence.ts` — `BOARD_SHAPE_TUTORIAL_ID`, `shouldShowBoardShapeTutorial`
  (mount-time, scans the initial board for any `type === 'void'` cell).
- `components/SpecialTutorialOverlay.tsx` — the `board_shape` entry in
  `SPECIAL_TUTORIAL_CONTENT` (reused component, no new file).
- `components/Board.tsx` — `showBoardShapeTutorial` mount-time state (same
  shape as `showBlockerTutorial`), gates `canAcceptMove`/`dragEnabled`/the
  post-move tutorial effect, and renders between the onboarding card and the
  blocker card (a shaped board is the most immediately visible thing about a
  level, so it's explained before content sitting within that shape).
- Tests: `appPersistence.test.ts`'s `shouldShowBoardShapeTutorial` describe
  block (true/false/dismissed/distinct-from-blocker cases) and the
  `markTutorialSeen` generic-writer proof. `npx jest` — all tests pass.

## Honest caveats

- No dedicated `board_shape` icon art exists — it falls back to the same
  text-label placeholder every un-arted tutorial icon uses, the same as
  `chain_reaction`/`how_to_play`.
- This capture used Level 4, the only currently-shipping void-cell level
  (hand-built). Generator-driven shaped levels (`generatedShapeId`, gated at
  generated level 8+) use the identical `voidCells` mechanism and therefore
  the identical mount-time trigger — not separately captured here, since the
  trigger condition (`board.some(p => p.type === 'void')`) is the same board
  scan regardless of which template produced the shape.
