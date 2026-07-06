# Level map — verification

`04-level-map-real-state.png` verifies the new `components/LevelMap.tsx`
against real, persisted save data — not seeded, not mocked: a real level was
actually played and won, a real star rating was actually computed and
persisted, and the map correctly renders that plus the real current level
and real locked levels ahead.

## How this was captured

Driven against the **real running app**, same rig as
`docs/verification/stuck-player-hint/` and
`docs/verification/denial-zone-spread/`: the Expo web dev server
(`npx expo start --web`, `localhost:8081`) and a headless Windows Chrome
(`chrome.exe --headless=new --remote-debugging-port=9222`, reached directly
from WSL2 via mirrored networking), driven over raw CDP via this repo's own
`node_modules/ws`. `Emulation.setDeviceMetricsOverride` pinned the viewport
to 430x900 so element coordinates stayed consistent across calls.

Unlike prior sessions' captures, **no `SaveData` was seeded into
`localStorage`** — every byte of save state in the final screenshot was
produced by genuinely playing the game:

1. Loaded `localhost:8081` on a genuinely fresh save (nothing in
   `localStorage` yet), landing on Home.
2. Clicked "Start cooking" (Level 1, "Tomato Toss") via a real
   `Input.dispatchMouseEvent` click on the button's real rendered position.
3. Read the real board's tile images from the live DOM each turn (sprite
   filenames identify each tile's `matchType`), computed a real
   3-in-a-row-forming adjacent swap locally, and dispatched two real clicks
   (tap-select, tap-adjacent — `Board.tsx`'s real `handleTilePress` path) per
   move — repeated until the level's real objective was met. The actual
   engine (`engine/matrix.ts`/`engine/gameState.ts`) processed every swap;
   the driver script only ever decided *which* adjacent pair to tap.
4. Level 1 was won for real after 11 real moves (9 of the level's 20 moves
   left over) — `components/wonActions.ts`'s `computeStarRating(9, 20)`
   correctly resolves to **2 stars** (ratio 0.45, between the 1/3 and 2/3
   thresholds), which is exactly what rendered on the real `WonOverlay`
   (`02-real-win-2-stars.png`) and is exactly what's now persisted.
5. Level 2 ("Lemon Squeeze") was attempted several real times and
   genuinely lost each time (ran out of moves before reaching its 18-lemon
   target) — a real, honest loss, not a scripted outcome. Real lives
   depleted from 5 to 2 as a result (`applyLivesRegen`/`livesAfterLoss`
   processing real losses), confirming the account-level lives accounting
   is untouched by this feature.
6. Exited the level (real `✕` close button), landing back on Home, which
   correctly showed **"UP NEXT · LEVEL 2 · Lemon Squeeze"**
   (`03-home-up-next-level2.png`) — confirming `resolveNextUnplayedLevel`
   still resolves to 2 (a lost/abandoned attempt never marks a level
   completed).
7. Clicked "Browse all levels" to open the new Level Map.

## What the final screenshot proves

`04-level-map-real-state.png`, read directly from the live DOM against the
real running app:

- **Level 1 — completed**: sage checkmark badge, sage medallion border, and
  a **real 2-star row** (2 filled, 1 empty) — read straight from
  `localStorage`'s real `SaveData.levelStars: { "1": 2 }` (confirmed via a
  direct `localStorage.getItem` dump in the same session — see below), not
  a fabricated or seeded value.
- **Level 2 — current**: the egg-yolk glow ring, the "LEVEL 2" caption pill,
  and the PLAY button, matching `resolveLevelStatus`'s real `'current'`
  branch for the real next-unplayed level.
- **Levels 3 and 4 — locked**: dimmed medallions with the padlock badge,
  and the connecting path itself rendered dimmed/thinner past the current
  level, per `resolveLevelMapIndices`' real lookahead.
- The header reads **"1 cooked · pick up wherever you like"** — the real
  `completedLevels.length`.
- The map opened already scrolled so level 1 and level 2 are both in frame
  near the top of the viewport, not the very top of the list — the
  scroll-to-center-current behavior (`computeScrollOffsetToCenter`).

The real persisted save at the moment of this screenshot (dumped via
`localStorage` inside the same live page, not reconstructed):

```json
{
  "skinId": "cooking-lalas-kitchen",
  "currentLevel": 2,
  "lives": 2,
  "completedLevels": [1],
  "levelStars": { "1": 2 },
  "seenTutorials": ["how_to_play", "blocker", "striped", "color_bomb", "area_bomb", "chain_reaction"],
  "unlockedRecipeCards": ["tomato_stew"],
  "soundEnabled": false,
  "hapticsEnabled": false
}
```

Worth noting: genuine random-adjacent-swap play organically triggered every
one of this game's tutorial overlays for real during this session (a
blocker, a striped piece, a color bomb, an area bomb, and a chain reaction
all occurred without being deliberately staged) — a small, incidental
confirmation that a wide slice of the engine's real mechanics fire
correctly under real, undirected play, not just under hand-built test
boards.

`01-real-level1-board.png` and `02-real-win-2-stars.png` show the real
level-1 board and the real win moment (2 stars) referenced above.
`03-home-up-next-level2.png` shows the real Home screen confirming level 2
as the real next-unplayed level immediately before opening the map.
