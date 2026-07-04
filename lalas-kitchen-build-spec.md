# Lala's Kitchen: Match-3 Engine Build Spec

A quick note before the phases: this whole document is basically a recipe with the steps in the right order. Each phase should be handed to Claude Code as its own prompt, and each one should be fully working and tested before moving to the next. Resist the urge to skip ahead, since the engine's whole value depends on it being solid before anything gets built on top of it.

## Core Philosophy

The engine is the recipe book. It never knows what a tomato is, it only knows piece type IDs, grid coordinates, and behaviors. Skins are the deck of cards, swappable content that the engine reads but never hardcodes.

The leak test: if you swapped the skin and something broke or looked weird, that logic lived in the wrong layer.

---

## Phase 1: The Core Matrix (`engine/matrix.ts`)

**Goal:** A pure, fully tested board state module. No rendering, no React, no UI. Just functions that take a board in and return a board out.

**Build:**
- Board representation as a 2D array of piece objects: `{ id: string, type: 'normal' | 'row_clearer' | 'blocker', matchType?: string }`
- `checkMatches(board)`: scans rows and columns, returns coordinates of all 3+ runs
- `swapPieces(board, posA, posB)`: swaps two adjacent tiles, returns new board (does not mutate the original)
- `calculateCascades(board)`: after a clear, drops pieces down to fill gaps, spawns new pieces at the top
- `shuffle(board)`: rearranges existing piece IDs in place (same counts, new positions), used when zero legal moves exist
- `hasLegalMoves(board)`: simulates every possible adjacent swap, returns true if any would create a match — excludes blocker cells from both sides of a candidate swap (see Phase 6)
- `applyAdjacentDamage(board, clearedPositions)`: added in Phase 6 — given the cells a match is about to clear, decrements `hitsRemaining` on any adjacent blocker cell by one hit, returning which blockers (if any) reached zero and should clear alongside the match

**Testing note (this is the fun part):** since everything here is a pure function, you can write tests using hand built board arrays instead of tapping through a simulator. Try a board with no matches, a board with one obvious three in a row, and a board that cascades twice. If a test fails, you can paste the exact board state into a scratch file and ask "why didn't this clear," no app needed.

**Piece attributes, not bare IDs:** even though v1 only has `type: 'normal'` pieces, build the piece object with a `type` field from day one. This is free insurance, since it means adding a row clearer or a blocker later is a config change, not a data model migration.

---

## Phase 2: The Seeded Generator (`engine/generator.ts`)

**Goal:** A deterministic level generator that lives in the same folder as the matrix logic, since it needs the same purity guarantee (same seed in, same board out, forever).

**Build:**
- `generateLevel(seed, config)`: fills a board of the given dimensions using a seeded random number generator, never `Math.random()` directly
- While filling, check the two pieces already placed to the left and above each new cell, and avoid picking a piece type that would create an instant match
- After filling (and, since Phase 6, after blocker placement — see below), run `hasLegalMoves()` from Phase 1. If false, reshuffle and check again
- Difficulty should be tunable by constraining inputs (piece-type pool size, tighter move limits, and since Phase 6, blocker count) rather than rigging the randomness itself — `generateLevel` itself is direction-agnostic about which way "more types" or "fewer types" trends harder; that ramp direction is a caller decision (see `engine/DECISIONS.md`'s "Difficulty tuning" entry: more types is the harder direction for a human player, since it makes matches statistically rarer, not fewer)
- Since Phase 6: optional `blockerCount`/`blockerMatchType`/`blockerHitsToClear` on `GeneratorConfig` — after the fill and repair pass, overwrite that many random cells with blocker pieces. Safe to do without re-running the repair pass, since a blocker can never join a match run in the first place (see Phase 6 below)

**Why this belongs next to the matrix, not in its own folder:** the generator needs to inherit the same deterministic discipline as match detection. If it lived somewhere else, it would be easy for a future prompt to reach for unsanitized randomness "since it's just content." Keeping it in `engine/` as its own file (not merged into `matrix.ts`) gets cohesion without bloating the core file.

---

## Phase 3: Game State and Persistence (`engine/gameState.ts`)

**Goal:** The layer that turns "a board" into "a playable level with lives, moves, and a win condition."

**Build:**
- `GameState` shape: current board, moves remaining, lives, current objectives (originally v1: a single item-collection target, e.g. collect 24 lemons — since generalized to an array of one-or-more targets, see `CLAUDE.md`'s Data Model Notes and `engine/DECISIONS.md`; a single-objective level is still just an array of length one)
- `applyMove(gameState, posA, posB)`: validates the swap, applies it if legal, snaps back if not, resolves any cascades, decrements moves, checks win/loss
- A `paused_awaiting_input` state for when moves hit zero, with a `grantBonusMoves(n)` command that resumes play (this is the hook for a rewarded ad later, but the state machine itself doesn't know or care what triggers the grant)
- Combo streak tracking: if a single move triggers 4+ chained cascades, emit an event the skin layer can react to (sound, particles, or nothing, engine doesn't decide)
- Save data as its own object, separate from skin config: `{ skinId, currentLevel, lives, livesLastRegenAt, itemsCollected, powerUpCounts, completedLevels? }`. `completedLevels` (1-based level numbers won at least once) was added when the win flow grew a level queue and dashboard screen — see `App.tsx`'s `LEVEL_QUEUE` and `components/Dashboard.tsx`. It's optional on the type so save files written before that change still parse.
- `currentLevel` is no longer bounded by `LEVEL_QUEUE.length` — past the 3 hand-built levels, `App.tsx`'s `buildLevelConfig` falls through to `buildGeneratedLevelConfig` (`appPersistence.ts`), which derives a full `LevelConfig` (seed, moves limit, piece-type pool, objective) purely from the level index, then hands it to the exact same `createGameState`/`generateLevel` pipeline every level already goes through. So `currentLevel` can grow past 3 indefinitely; `resolveStartScreen` always resumes gameplay at whatever it is, with no upper clamp.
- `loadSave(skinId)` and `saveProgress(skinId, data)` wired to AsyncStorage

**Known and accepted limitation:** `livesLastRegenAt` can be spoofed by changing the device clock. Not worth solving at this scale, just leave a comment noting it's a known tradeoff.

---

## Phase 4: The Skin Config Schema (`skins/lalas-kitchen/config.json`)

**Goal:** The data file that makes the engine cook a specific dish. This should be pure JSON, no logic.

```json
{
  "skinId": "cooking-lalas-kitchen",
  "pieceTypes": [
    { "id": "tomato", "sprite": "tomato.webp" },
    { "id": "lemon", "sprite": "lemon.webp" },
    { "id": "herb", "sprite": "herb.webp" },
    { "id": "garlic", "sprite": "garlic.webp" },
    { "id": "chili", "sprite": "chili.webp" },
    { "id": "spoon", "sprite": "spoon.webp" }
  ],
  "blockers": [
    { "id": "cling", "sprite": "cling.webp", "hitsToClear": 1 }
  ],
  "lives": { "max": 5, "regenMinutes": 30, "icon": "flame.webp" },
  "animationProfile": {
    "matchStyle": "popAndShrink",
    "matchDurationMs": 220,
    "cascadeFallSpeed": "medium",
    "swapDurationMs": 140
  },
  "palette": {
    "background": ["#F6D9A8", "#EFC087"],
    "panel": "#FBF3E1",
    "accent": "#A83A2E"
  }
}
```

Board dimensions and objectives live per level, not in this skin file, since board shape is a source of variety across levels, not a skin-wide constant.

`lives.icon` is a sprite reference, same shape as a `pieceTypes` entry's `sprite` field, so the HUD's life count never hardcodes a heart glyph — a different skin can point it at any sprite (a flame, a heart, whatever fits the theme) without touching `components/Hud.tsx`.

**Design note for this specific player:** she plays to keep her mind occupied, not for excitement, and she plays with sound off since it's distracting. That means `animationProfile` should lean calm and satisfying rather than intense. Sound should default to off with an easy one-tap mute, not buried in a settings menu.

---

## Phase 5: The Presentation Layer (`components/Board.tsx` and friends)

**Goal:** React Native rendering, driven entirely by engine output. This is the only phase that touches UI.

**Build:**
- Board renders from `GameState`, mapping piece IDs to sprites via the active skin's `pieceTypes`
- Use React Native Reanimated for match, swap, and cascade animations, not raw `setState` per frame, since the JS to native bridge will bottleneck on a 15-piece cascade otherwise
- HUD panels: Target, Moves, Lives (flat panels, board runs close to edge to edge, thin border only, no extra decorative frame eating tile size)
- Tap handling: select a tile, tap an adjacent tile, call `applyMove`, animate whatever the engine returns

**One rule worth repeating here since it's the whole point:** if this file ever contains the string `"tomato"` directly, something has leaked. It should only ever read `config.pieceTypes` and loop.

---

## Phase 6: Blocker Clearing (`engine/matrix.ts`, `engine/gameState.ts`, `engine/generator.ts`)

**Goal:** Make the `'blocker'` piece type — real since Phase 1's `type` field, but inert until now — actually clear, using the cling wrap sprite that's been wired into the skin config since Phase 5.

**Build:**
- Blockers are not matchable and not swappable: `checkMatches` and `hasLegalMoves` both exclude any cell whose `type` is `'blocker'`, regardless of its `matchType`
- Blockers clear via adjacent damage, not by being matched directly: whenever a match clears cells, any blocker adjacent to one of those cells takes one hit (one hit per match, not per adjacent cell — see `engine/DECISIONS.md`). A blocker whose `hitsRemaining` reaches zero clears alongside the triggering match and refills the same way any other cleared cell does
- Blocker clears count toward level objectives through the exact same `Objective`/`clearedByMatchType` mechanism every other piece type already uses — `targetMatchType: 'cling'` just works, no new objective architecture needed
- Generated levels place blockers too: `GeneratorConfig` gained optional `blockerCount`/`blockerMatchType`/`blockerHitsToClear`, and `appPersistence.ts`'s `generatedBlockerCount` is the difficulty lever (same shape as `generatedPieceTypeCount`/`generatedMovesLimit`) — none on the first couple of generated levels, then a slow ramp capped at 4

**Full reasoning, including the hidden-piece-underneath alternative that was considered and deferred, lives in `engine/DECISIONS.md`'s Phase 6 section — this file only tracks what got built, not why.**

---

## What's Explicitly Out of Scope for V1

Skip these until the core loop is proven fun and stable:
- Row clearers and other special piece behaviors beyond blockers (the `type` field is ready for them, but don't build the logic yet). Blocker clearing itself was built in Phase 6, below — no longer in this list.
- Recipe box meta layer and its event listener (build the engine's summary event emitter when a level ends, but wire up the actual UI later). Brought into V1 scope and built in a later session: `skinConfig.recipeCards` is a fixed 9-card curated set, each tied to one milestone level number (`appPersistence.ts`'s `findRecipeCardForLevel`); winning a milestone level reveals the card inside the existing win overlay and adds it to `SaveData.unlockedRecipeCards` (same shape as `seenTutorials`); a "My Recipe Book" screen off Home shows the fixed 3x3 grid, filled vs. dashed-empty — no stars, tiers, or locks. See `CLAUDE.md`'s Data Model Notes for the full mapping and `engine/DECISIONS.md` for the reasoning. No longer in this list.
- Cloud asset delivery / CDN-based skin loading (only matters once there are multiple skins to distribute)
- Score-threshold level objectives (a numeric score threshold, distinct from counting matched pieces, is still unbuilt). Multi-target objectives were built in a later session — `GameState`/`LevelConfig`'s `objectives` is an array; see this file's Phase 3 note above and `engine/DECISIONS.md` — no longer in this list.
- Any App Store "distinct product" layout variation work (only matters when skin number two is real)

---

## Success Criteria for V1

A player can open the app, see a board, make legal swaps, watch cascades resolve, run out of moves or hit the collection target, and have their progress saved when they close the app. Winning one of the 9 curated milestone levels reveals a recipe card into a real, persisted collection. No power-ups, no ads wired in yet, just a real, playable, saved match-3 level themed around cooking.