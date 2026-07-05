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
    config.json     pieceTypes, blockers, lives, animationProfile, palette, recipeCards
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

Every piece object carries a `type` field from day one, so a future special piece becomes a config addition instead of a schema migration. `'blocker'` is no longer just the placeholder this note originally described — blockers are real as of the adjacent-damage clearing mechanic (see `engine/DECISIONS.md`'s Phase 6 section): not matchable, not swappable, cleared by taking one hit per adjacent match until `hitsRemaining` reaches zero, at which point the clear counts toward an objective exactly like any piece type's `matchType`. `'striped'` is the first special piece, now built (it replaced the old `'row_clearer'` placeholder — see `engine/DECISIONS.md`'s striped-piece entry): a run of exactly 4 converts one cell into a striped piece carrying the base `matchType` plus a `direction` (`'row'`/`'col'`), and matching that striped piece later — it's an ordinary matchable, swappable piece until then — sweeps its whole row or column. A horizontal 4-run makes a row-clearer, a vertical one a column-clearer (parallel mapping; the perpendicular genre convention is a one-line flip, see the DECISIONS entry). It renders through the same sprite path as every other piece: `components/spriteMap.ts`'s `getSpriteForPiece` resolves a striped piece to `striped_<its base sprite>`, so dedicated art is one `spriteRegistry.ts` line per asset and any type without it falls back to the standard text-label placeholder (tomato and lemon have real striped art; the other four fall back for now).

`'color_bomb'` is the second special piece, now built (see `engine/DECISIONS.md`'s color-bomb entry): a run of *exactly 5* (row or column) converts one cell into a colorless `type: 'color_bomb'` piece (no `matchType` — it can't form an ordinary run, excluded by `piecesMatch` like a blocker; a 5-run therefore credits 4 toward objectives, the anchor becoming the bomb). Its activation is a genuinely different mechanism from the striped piece's, not an extension of it: a striped piece fires by *being included in a later match*, but a color bomb fires the instant it's *swapped with any piece* — regardless of whether that swap would form a match — and clears every piece on the board sharing the swapped-with piece's `matchType` (swapping two bombs clears the whole board). This lives in `gameState.ts`'s `applyMove` as a branch that runs **before** the ordinary no-match snap-back check (a bomb swap is always a legal, committed move precisely because it doesn't rely on a run), with `resolveColorBomb` doing the detonation + refill and handing off to the normal `resolveCascades` for any chain matches; `hasLegalMoves` also treats any bomb-involving swap as legal so a board whose only move is a bomb swap is never wrongly judged stuck. Blockers are **never** force-cleared by a detonation (single-type or whole-board) — they only ever take normal one-hit-per-call adjacent damage, the same rule as every other clearing mechanism. It renders through the same `getSpriteForPiece` path (a fixed `'color_bomb'` sprite key — note: no `.webp` extension, so the `spriteRegistry.ts` entry is keyed by the bare `'color_bomb'` string, unlike every other filename-keyed entry). Real dedicated art (`color_bomb.webp`, a glowing potion bottle) has landed as one registry line; before it, a bomb fell back to the "CO" text-label placeholder. Both states verified live, see `docs/verification/color-bomb/`.

Special-piece **combos** are now built (see `engine/DECISIONS.md`'s special-piece combos entry): swapping two special pieces directly into each other fires a combined effect on the swap itself, bypassing the snap-back exactly like a solo bomb. Two exist — **striped + striped** clears a full cross (the entire row *and* column through the swap, overriding each piece's own direction), and **striped + color bomb** is a super-combo that converts every board piece of the striped piece's `matchType` into a striped piece and fires them all at once (`resolveStripedCross` / `resolveStripedBombCombo`, both routed through the shared `resolveClearSet` tail). Branch order in `applyMove` is load-bearing: striped+bomb is checked **before** the solo-bomb branch, or `resolveColorBomb` would consume it and run the weaker single-type clear; striped+striped is checked before the ordinary snap-back, since two stripeds needn't form a run. `hasLegalMoves` treats a striped+striped pair as always legal (striped+bomb already is, via the bomb). Blockers caught in either combo take normal one-hit adjacent damage, never a force-clear. Verified live, see `docs/verification/special-piece-combos/`. Still deferred: sweep/detonation chaining (a special caught in a combo's clear just clears, it doesn't recursively fire), L/T-shape triggers (an L/T-formed bomb, vs. the built straight-5 trigger), and the supercombo's convert-to-striped animation flash (the engine result is computed directly, so there's no intermediate all-striped frame) — see `DEFERRED_COMPLEXITY.md`.

`GameState.objective`/`LevelConfig.objective` are no longer a single item — both are now `objectives`, an array of the same per-item shape (`type`, `targetMatchType`, `targetCount`, `currentCount`). A single-objective level (every hand-built `LEVEL_QUEUE` entry today) is just an array of length one, not a special case. Win requires every entry to reach its target (see `engine/gameState.ts`'s `applyMove` and `engine/DECISIONS.md`'s multi-objective entry). Generator-driven levels only ever place a second objective once the level's own piece-type pool has grown to at least 5 distinct types (see `appPersistence.ts`'s `generatedObjectiveCount`) — deliberately late, since a second objective drawn from a small pool makes nearly every random match satisfy some target, and two objectives on one level are always distinct `targetMatchType`s — never the same piece type twice. The piece-type pool itself now grows as generated levels continue (fewer types early, more later — see `engine/DECISIONS.md`'s "Difficulty tuning" entry), the opposite direction from an earlier, incorrect version of this ramp.

`livesLastRegenAt` can be spoofed by changing the device clock. This is a known, accepted tradeoff at this scale. Leave a comment noting it, do not spend time solving it.

The recipe box meta layer is now in V1 scope (see Explicitly Out of Scope, below, for that line's own annotation). It's a fixed, curated collectible set, not one card per level forever: `skinConfig.recipeCards` (`config.json`) is a small array of 9 entries, each with `id`, `title`, `flavorText`, `milestoneLevel`, and `sprite`, and `appPersistence.ts`'s `findRecipeCardForLevel` is the one lookup from a level index to its card. Levels generate indefinitely, but a collection needs a completable set, so only those 9 milestone level numbers (currently 1, 3, 6, 10, 15, 21, 28, 36, 45 — triangular spacing, gaps widen gradually) ever unlock a card; every other level unlocks nothing. `SaveData.unlockedRecipeCards` persists which ids have been unlocked, the same optional-string-list shape as `seenTutorials` (see `appPersistence.ts`'s `unlockRecipeCard`, idempotent the same way `markTutorialSeen` is). No real card illustrations exist yet — every card's `sprite` field falls back to the same image/text-label placeholder contract `resolveSpriteAsset` already gives piece/blocker art with no bundled asset (see `components/spriteAsset.ts`), so dropping real art in later is purely a `skins/lalas-kitchen/spriteRegistry.ts` addition, zero code changes. The reveal (a single card at a gentle angle with a soft glow, shown inside the existing win overlay) and the collection screen (a plain 3x3 grid, filled vs. dashed-empty, reachable from Home's "Your recipe book" card) are both deliberately *not* a gamified badge/rarity system — no stars, no tiers, no locks, no progress bar, just a plain count against the fixed set.

## Design Constraints (from actual user research, not guessing)

- Sound defaults to off, with an easy one-tap mute. She specifically said Candy Crush's sound was distracting.
- Animation and pacing should read as calm and satisfying, not frantic. She plays to keep her mind occupied, not for an adrenaline hit. High-intensity combo particle effects are a bad fit for this specific player even if they're standard for the genre.
- Board renders close to edge to edge. A decorative frame around the grid eats tile size, and smaller tiles mean worse tap accuracy on a phone.

## Explicitly Out of Scope for V1

Do not build these yet, even if they seem like a natural extension mid-session:
- Special piece behavior beyond blockers, the striped piece, the now-built color bomb, and the now-built special-piece combos (the striped row/column clearer and the color bomb — a run of exactly 5 that detonates every piece of one type when swapped — were both brought into scope and built; the striped+striped cross and striped+bomb super-combos were then built on top of them; see the Data Model Notes above and `engine/DECISIONS.md`'s striped-piece, color-bomb, and special-piece combos entries; blocker clearing was built earlier, see the Phase 6 section). Still deferred: sweep/detonation chaining (including a special piece caught in a combo's clear), L/T-shape triggers (including an L/T-formed color bomb, vs. the straight-5 trigger that is built), and the supercombo's convert-to-striped animation flash.
- Recipe box meta layer UI — brought into V1 scope and fully built this session (see the Data Model Notes above); no longer in this list
- Cloud asset delivery or per-skin CDN loading (irrelevant until skin number two is real)
- Score-threshold objectives (v1 is move limit plus one-or-more collection targets — see the Data Model Notes above for the now-built multi-objective array; a numeric score threshold, distinct from counting matched pieces, is still unbuilt)
- Any App Store "distinct product" layout variation (matters only once a second skin ships)

If a build session surfaces a good idea that falls in this list, log it rather than building it. Add it to `DEFERRED_COMPLEXITY.md` at the repo root (create it if it doesn't exist yet) with a one-line note on why it was deferred.

## Documentation Rule

Docs move with the code. If a session changes the engine's shape, the config schema, or the phase boundaries, update this file and `lalas-kitchen-build-spec.md` in the same session, not later. A stale CLAUDE.md is worse than no CLAUDE.md, since it actively lies about what's true.

## Definition of Done for V1

A player can open the app, see a board, make legal swaps, watch cascades resolve, run out of moves or hit the collection target, and have progress saved on close. Winning one of the 9 curated milestone levels reveals a recipe card into a real, persisted collection, viewable from Home. No power-ups, no ads wired in. Just a real, playable, saved match-3 level, themed, calm, and built for the one person it's actually for.

## Playtest Feedback Protocol

When real playtesting surfaces something that feels wrong, broken, or unsatisfying, follow this shape by default, no need to be told each time:


Investigate the actual cause before proposing a fix. A symptom's obvious explanation is often wrong. Check the real code, the real data, the real behavior, before writing anything.
Check whether this might share a root cause with something already built. Several real bugs in this project turned out to be two independently correct systems that were never checked against each other once they started interacting (the piece-type ramp and the objective gate, the recipe card art and the placeholder contract, the win overlay and the cascade step sequencing). When something feels wrong shortly after a related feature shipped, checking for this kind of overlap first is often faster than assuming a fresh, unrelated bug.
When a new feature builds on an old one, check whether the old feature's shortcut still holds. A duplicated decision, a copied piece of logic, a special case, any of these can quietly drift the moment a second implementation exists. If a fix requires testing a decision, and that decision is duplicated somewhere, collapse the duplication into one shared source before writing the test, don't test a stand-in copy.
Verify against real behavior, not just a passing test suite. A test proves the code does what the test checks. It doesn't prove a player can see it, feel it, or that it's wired into the actual running app. When animation, timing, or feel is involved, a live trace, a real screenshot sequence, or a frame-by-frame capture is the honest standard, not a simulated or mocked equivalent.
Don't default to genre convention without checking it against this game's actual principles. This game is built for one specific real player who plays to relax, not for excitement, and everything a player gets access to comes from playing well, never purchased. Genre-standard choices (stingy resource grants, aggressive urgency framing, unlimited ad-for-continue loops) are worth checking against these principles specifically, not assumed correct just because most other games do it that way.
Confirm before deciding on a genuine fork, don't guess silently. If a fix could reasonably go two different directions with real consequences either way, say so plainly and ask, rather than picking one and hoping it was the intended one.
Update DECISIONS.md, DEFERRED_COMPLEXITY.md, and CLAUDE.md's own scope notes as part of the same session, not as an afterthought. Documentation moves with the code that changed, always.


This protocol applies by default. A future prompt doesn't need to restate it, just describe the actual symptom and trust this standing expectation to shape the investigation.