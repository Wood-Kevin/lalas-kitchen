# CLAUDE.md: Lala's Kitchen (Match-3 Engine)

This file is the map. Read it before touching code, since it explains not just what to build but why the boundaries exist. Skipping the "why" is how a reusable engine quietly turns into a single-use game.

## What This Project Actually Is

A reusable match-3 engine, first deployed as a cooking-themed skin called Lala's Kitchen, built for a real audience of one (my mom, who plays Candy Crush to keep her mind occupied and plays with sound off). The engine is the long-term asset. This skin is the first proof it works.

Think of it like a kitchen. The engine is the stove, the pots, and the knife skills, they don't change no matter what's cooking. The skin is tonight's recipe. If you ever catch yourself writing knife-skills logic that only works for tonight's specific recipe, stop, that's the signal something leaked into the wrong layer.

## The Leak Test (the one rule that matters most)

Before writing any code inside `engine/`, ask: if the skin were swapped for something totally different, would this code break or look weird?

If yes, it belongs in `skins/`, not `engine/`. The engine should never contain a string like `"tomato"` anywhere. It only knows piece type IDs, grid coordinates, and behaviors.

## Architecture

```
/engine
  matrix.ts        pure functions: checkMatches, swapPieces, calculateCascades, shuffle, hasLegalMoves, applyAdjacentDamage
  generator.ts      seeded random level generator, lives next to matrix.ts for the same purity guarantee
  gameState.ts      lives, moves, save/load, the paused_awaiting_input state machine
/skins
  /lalas-kitchen
    config.json     pieceTypes, blockers, lives, animationProfile, palette
    /sprites
/components
  Board.tsx         reads engine output + active skin config, renders, never hardcodes piece names
```

**Architect / runner boundary:** I own architecture, sequencing, and verification. Claude Code owns implementation. If a prompt seems to require an architectural decision that isn't already answered in this file, stop and ask rather than guessing.

## Build Order

Build and fully test each phase before starting the next one. Do not jump ahead, the engine's value depends on Phase 1 being solid before anything gets built on top of it.

1. **Core matrix** (`engine/matrix.ts`), pure functions, no UI, no React
2. **Seeded generator** (`engine/generator.ts`), deterministic, same seed always produces the same board
3. **Game state and persistence** (`engine/gameState.ts`), lives, moves, save/load, event emitter
4. **Skin config** (`skins/lalas-kitchen/config.json`), pure data, no logic
5. **Presentation layer** (`components/`), React Native + Reanimated, reads engine output only

Full phase details, including the actual config schema and per-phase build notes, live in `lalas-kitchen-build-spec.md` in this repo. That file is the recipe card. This file is the kitchen rules.

## Testing Philosophy (the fun part, genuinely)

Everything in `engine/` is a pure function: same board in, same board out, no side effects. That means bugs get debugged with a test file, not a phone in your hand.

If a cascade doesn't resolve the way you expect, don't reach for the simulator first. Paste the exact board state into a test, call the function directly, and read what comes back. This is strictly more fun than tapping through fifteen screens hoping to reproduce a bug, and it's a direct rep for the same telemetry-over-assumption habit that caught the RLS bug on GoldStar.

Minimum test coverage before a phase counts as done:
- A board with zero matches
- A board with exactly one obvious three-in-a-row
- A board that cascades at least twice
- A board with zero legal moves (should trigger `shuffle`)

## Data Model Notes

Every piece object carries a `type` field from day one, so a future special piece becomes a config addition instead of a schema migration. `'blocker'` is no longer just the placeholder this note originally described — blockers are real as of the adjacent-damage clearing mechanic (see `engine/DECISIONS.md`'s Phase 6 section): not matchable, not swappable, cleared by taking one hit per adjacent match until `hitsRemaining` reaches zero, at which point the clear counts toward an objective exactly like any piece type's `matchType`. `'row_clearer'` remains an unbuilt placeholder — leave the door open, don't build its logic yet.

`GameState.objective`/`LevelConfig.objective` are no longer a single item — both are now `objectives`, an array of the same per-item shape (`type`, `targetMatchType`, `targetCount`, `currentCount`). A single-objective level (every hand-built `LEVEL_QUEUE` entry today) is just an array of length one, not a special case. Win requires every entry to reach its target (see `engine/gameState.ts`'s `applyMove` and `engine/DECISIONS.md`'s multi-objective entry). Generator-driven levels only ever place a second objective once the level's own piece-type pool has at least 2 distinct types (see `appPersistence.ts`'s `generatedObjectiveCount`), and two objectives on one level are always distinct `targetMatchType`s — never the same piece type twice.

`livesLastRegenAt` can be spoofed by changing the device clock. This is a known, accepted tradeoff at this scale. Leave a comment noting it, do not spend time solving it.

## Design Constraints (from actual user research, not guessing)

- Sound defaults to off, with an easy one-tap mute. She specifically said Candy Crush's sound was distracting.
- Animation and pacing should read as calm and satisfying, not frantic. She plays to keep her mind occupied, not for an adrenaline hit. High-intensity combo particle effects are a bad fit for this specific player even if they're standard for the genre.
- Board renders close to edge to edge. A decorative frame around the grid eats tile size, and smaller tiles mean worse tap accuracy on a phone.

## Explicitly Out of Scope for V1

Do not build these yet, even if they seem like a natural extension mid-session:
- Row clearers or any special piece behavior beyond blockers (blocker clearing itself is now built — see the Data Model Notes above and `engine/DECISIONS.md`'s Phase 6 section)
- Recipe box meta layer UI (the engine's end-of-level summary event should exist, but nothing should listen to it yet)
- Cloud asset delivery or per-skin CDN loading (irrelevant until skin number two is real)
- Score-threshold objectives (v1 is move limit plus one-or-more collection targets — see the Data Model Notes above for the now-built multi-objective array; a numeric score threshold, distinct from counting matched pieces, is still unbuilt)
- Any App Store "distinct product" layout variation (matters only once a second skin ships)

If a build session surfaces a good idea that falls in this list, log it rather than building it. Add it to `DEFERRED_COMPLEXITY.md` at the repo root (create it if it doesn't exist yet) with a one-line note on why it was deferred.

## Documentation Rule

Docs move with the code. If a session changes the engine's shape, the config schema, or the phase boundaries, update this file and `lalas-kitchen-build-spec.md` in the same session, not later. A stale CLAUDE.md is worse than no CLAUDE.md, since it actively lies about what's true.

## Definition of Done for V1

A player can open the app, see a board, make legal swaps, watch cascades resolve, run out of moves or hit the collection target, and have progress saved on close. No power-ups, no recipe unlocks, no ads wired in. Just a real, playable, saved match-3 level, themed, calm, and built for the one person it's actually for.