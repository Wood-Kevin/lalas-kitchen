# engine/matrix.ts — Implementation Decisions

Choices made while building Phase 1 that weren't already pinned down in
`lalas-kitchen-build-spec.md` or `CLAUDE.md`. Read this if you need to
verify or challenge *why* something is shaped the way it is, not just *what*
it does — the code already tells you what.

## `type` vs `matchType`

The piece shape has both `type: 'normal' | 'row_clearer' | 'blocker'` and an
optional `matchType?: string`. The spec doesn't spell out the difference, so
I split them by role: `type` is the piece's *behavior* category (only
`'normal'` exists this phase; `row_clearer`/`blocker` are placeholders for
Phase 3+ special-piece logic per CLAUDE.md's "leave the door open" note).
`matchType` is the *kind/flavor* used purely for match-detection equality —
the abstract stand-in for "tomato vs. lemon vs. herb" that the skin layer
will eventually map to a sprite. `checkMatches` groups runs by `matchType`
equality, never by `type`.

**Alternative not taken:** collapsing both into a single `type` field (e.g.
`type: 'tomato' | 'row_clearer'`) was rejected because it conflates
"is this piece special" with "what does it match against," which would make
adding a matchable row-clearer variant later require touching every place
that currently checks `type === 'normal'`.

## Undefined `matchType` never matches anything

`piecesMatch` requires both pieces to have a *defined* `matchType` before
comparing equality — two pieces that both lack `matchType` are never
considered a match. This means a future blocker/placeholder piece with no
`matchType` is automatically excluded from match runs without `checkMatches`
needing any explicit `type === 'blocker'` filter, which would have been
building special-piece logic ahead of schedule (out of scope for V1 per
CLAUDE.md).

## `calculateCascades` takes an injected `spawnPiece` callback, not `Math.random`

The build spec says cascades "spawn new pieces at the top" but doesn't say
where the piece values come from. Baking `Math.random()` (or any RNG)
directly into `matrix.ts` would violate the "pure function, no side
effects" contract this whole phase depends on, and would pre-empt Phase 2's
job of owning seeded randomness. Instead, `calculateCascades(board,
spawnPiece)` takes the piece-generation function as a parameter. Given the
same board and a spawnPiece that returns the same sequence, the output is
fully deterministic and testable — Phase 2's seeded generator will supply a
seeded `spawnPiece`, but `matrix.ts` never needs to know that.

**Alternative not taken:** an optional `spawnPiece` parameter defaulting to
some internal `Math.random`-based generator was rejected — it would let
this phase quietly grow a hidden RNG dependency that Phase 2 would then
have to route around instead of build.

## `shuffle` takes an injected `rng`, defaults to `Math.random`, and retries with a cap

Same reasoning as above for randomness injection: `rng: () => number =
Math.random` lets production code call `shuffle(board)` plainly while tests
pass a seeded LCG for reproducibility.

Beyond just permuting piece positions, `shuffle` retries (bounded at 100
attempts) until the candidate board has zero immediate matches *and*
`hasLegalMoves` is true. The spec only says shuffle "rearranges existing
piece IDs in place, same counts, new positions," but a shuffle used to
recover from a zero-legal-moves state that immediately produces another
zero-legal-moves board (or an accidental instant match) would defeat its
own purpose. The 100-attempt cap guarantees termination — if every attempt
fails (only plausible on pathologically small/constrained boards), it falls
back to returning the last attempt rather than looping forever or throwing.

**Alternative not taken:** guaranteeing success via exhaustive search over
all permutations was rejected as unnecessary complexity — random retry
converges in practice for any board large enough for match-3 to make sense,
and the cap avoids hanging on a board where it genuinely can't converge.

## Row/column convention

`board[row][col]`, with row `0` as the top of the board and increasing row
index moving down. Gravity in `calculateCascades` moves surviving pieces
toward the *higher* row index (down), and new pieces fill the remaining
slots at the *lower* row indices (top). This wasn't specified in the spec;
picked to match normal top-to-bottom raster order since that's what the
presentation layer (Phase 5) will eventually map to screen coordinates.

## `swapPieces` doesn't validate adjacency

`swapPieces(board, posA, posB)` swaps whatever two positions it's given —
it doesn't check that they're actually adjacent. Adjacency is a caller-side
invariant: `hasLegalMoves` only ever calls it with adjacent pairs, and
Phase 3's `applyMove` (gameState.ts) will be the place that rejects a
player's non-adjacent tap. Adding an adjacency guard here would be
validating a scenario the pure function itself doesn't need to care about,
per the "don't validate what can't happen at this boundary" rule.

## `checkMatches` return shape: grouped runs, not a flat position list

`checkMatches` returns `Match[]`, each with its own `matchType` and
`positions` array, rather than a single flattened list of matched
coordinates. The spec only asks for "coordinates of all 3+ runs," but
keeping runs grouped preserves information Phase 3 will want anyway (e.g.
combo-streak counting counts *runs*, not raw cleared tiles) without
requiring a second pass to re-derive grouping later.

---

# engine/generator.ts — Implementation Decisions

## PRNG choice: mulberry32

Picked mulberry32 over alternatives (`xorshift128`, `sfc32`, a full
Mersenne Twister port) because it's a single 32-bit integer of state, about
six lines of arithmetic, has no dependency to add, and its statistical
quality is well past what placing match-3 piece types needs — this isn't a
cryptographic or scientific-simulation use case. `generator.ts` implements
it directly rather than pulling in a library, for the same reason
`matrix.ts` has zero dependencies: one less thing to audit or version-bump
in a module whose whole value is "same input forever produces same output."

**Alternative not taken:** `Math.random()` seeded indirectly by reseeding
some global state was rejected outright — the task requirement is explicit
that no path in this file may reach for `Math.random()`, and a truly seeded
generator needs its own isolated PRNG state per call anyway, not shared
global mutable state.

## One `rng` instance threaded through fill → repair → shuffle

`generateLevel` creates exactly one `mulberry32(seed)` closure and passes
that same closure through the initial fill loop, into
`repairAccidentalMatches`, and finally into `matrix.ts`'s `shuffle` if
needed. Reusing the single stateful closure (rather than creating a fresh
one per phase) is what makes "same seed always produces the exact same
board" hold end-to-end — every `rng()` call anywhere in the pipeline
advances the same deterministic sequence in a fixed order, so nothing about
the output depends on wall-clock time, call order across invocations, or
any other hidden state.

## Repair pass for dead-end cells (the hostile-config case)

The build spec's left/above check only looks at the two cells immediately
left and immediately above the cell being filled. That's sufficient to
avoid the *common* case of an instant match, but it can't always succeed:
with only two piece types, a cell can end up with a horizontal pair to its
left forcing type A to be forbidden and a vertical pair above it forcing
type B to be forbidden — leaving zero valid types when only A and B exist.
This isn't a bug in the check's logic, it's a real dead end that a purely
local, single-pass, no-backtracking fill cannot avoid by construction.

Rather than accept the resulting instant match (which would violate "never
contain an accidental match on creation," a hard requirement with no
hostile-config exception in the test list) or implement true backtracking
(re-visiting and changing earlier cells, which is meaningfully more complex
for a one-phase addition), `generateLevel` falls back on a bounded repair
pass: after the greedy fill, it runs the real `checkMatches` (global ground
truth, not the 2-cell heuristic) and, for each run found, reassigns the
middle position to a different type — chosen deterministically from the
same seeded `rng` — then re-checks. This converges because changing a run's
middle cell always breaks that specific run, and the pass is capped at
`rows * cols * pieceTypeIds.length + 20` iterations, throwing a clear error
if that's ever exceeded (mirroring `shuffle`'s own retry-cap pattern in
`matrix.ts` rather than inventing a different termination style) — a
possibility only if `pieceTypeIds` has fewer than 2 usable values for the
given board size, not something the 6x6/2-type test in `generator.test.ts`
comes close to hitting.

**Alternative not taken:** true backtracking (walking back to the earlier
cell that created one of the two conflicting constraints and trying a
different value there, recursively if that cell is itself constrained) was
rejected as disproportionate complexity for what the hostile-config test
actually requires — a board that resolves correctly without hanging, not a
maximally "natural" distribution of piece types.

## `pieceTypeIds.length < 2` is rejected outright

`generateLevel` throws if `config.pieceTypeIds` has fewer than 2 entries.
With a single piece type, every cell three-or-more wide or tall is
mathematically guaranteed to match — there is no valid board to generate,
so this isn't a defensive check against a scenario that "can't happen," it's
a genuine precondition of the function being satisfiable at all. Treated as
a system-boundary validation (config arrives from skin/level data, external
to this pure function) rather than an internal invariant the engine should
just trust.

## Seed is a `number`, not a `string`

`generateLevel(seed: number, config)` takes a plain number because
mulberry32 needs numeric state and nothing in this phase requires a
human-readable level identifier. If a later phase wants to seed by a string
(e.g. a level slug), hashing that string down to a number is a one-line
addition at the call site — not something worth building into `generator.ts`
now on spec.

## Difficulty tuning: what a config value changes vs. what never moves

Per the build spec, difficulty should come from constraining inputs, not
from rigging the randomness. Concretely, in `GeneratorConfig`:

- **`pieceTypeIds` (shorter list → harder):** fewer distinct types means
  fewer safe choices at each cell, more frequent forced repairs, and denser
  boards where legal moves are harder to spot by eye — this is the main
  difficulty lever `generateLevel` itself controls.
- **`rows` / `cols`:** board dimensions are a per-level content choice, not
  strictly a difficulty axis, but a smaller board with the same
  `pieceTypeIds` count is harder for the same reason (less room to
  maneuver).
- **Move limit is explicitly *not* part of `GeneratorConfig`.** The spec
  mentions "tighter move limits" as a difficulty lever, but a move limit
  doesn't affect what board gets generated — it's consumed by Phase 3's
  `gameState.ts` alongside whatever board `generateLevel` hands back. Adding
  it here would mix a game-state concern into a board-generation function
  that has no use for it.
- **What never changes regardless of difficulty:** the local
  left/above-match-avoidance rule, the repair pass's correctness guarantee,
  and the final `hasLegalMoves` check are invariants of `generateLevel`
  itself — every board it produces is match-free and playable on creation,
  no matter how the difficulty knobs are set. Difficulty affects *how hard*
  it is to spot the legal moves that exist, never *whether* one exists.

---

# engine/gameState.ts — Implementation Decisions

## No separate `'lost'` status — `paused_awaiting_input` is this phase's loss outcome

The build spec asks `applyMove` to "check win and loss," and separately
describes a `paused_awaiting_input` state that "triggers when moves hit
zero." Read literally as two different things, that implies a `'lost'`
status distinct from `paused_awaiting_input` — but nothing in the spec
describes what would ever transition the state machine *into* a `'lost'`
status, and the state machine is explicitly told not to know or care what
triggers a bonus-move grant (i.e. it can't unilaterally decide "no bonus is
coming, this is final"). Adding a `declineBonusMoves`-style command to
manufacture a `'lost'` status would be inventing an architectural piece the
spec never asked for.

The reading that makes every requirement consistent without inventing
anything: **hitting zero moves without the objective met *is* the loss
outcome, and `paused_awaiting_input` is what it looks like.** There's no
separate `'lost'` enum value. `GameStatus` is `'in_progress' |
'paused_awaiting_input' | 'won'`. The end-of-level summary event fires on
*both* ways a level can end — reaching the objective (`'won'`) or running
out of moves (`'paused_awaiting_input'`) — which is exactly the standard
match-3 UX of showing a game-over/summary overlay with a "watch an ad for
more moves" option layered on top; accepting that option is
`grantBonusMoves` un-ending the level that just "ended." This is an
interpretation, not something spelled out verbatim in the docs — flagging
it here per CLAUDE.md's architect/runner boundary so it's easy to
challenge if the intent was actually a distinct terminal state.

## `GameState.spawnPiece` is a stored closure, not `rng` + `pieceTypeIds`

Rather than storing `rng: () => number` and `pieceTypeIds: string[]` on
`GameState` and having `applyMove` derive a spawn function from them each
call, `GameState` stores `spawnPiece: () => Piece` directly — the exact
same shape `matrix.ts`'s `calculateCascades` already takes. `applyMove`
never needs to know a seeded PRNG or a piece-type pool exists; it just
calls `state.spawnPiece()`. This is also what makes the combo-streak test
possible without fighting rng-to-index arithmetic by hand: a test can
construct a `GameState` with a plain queue-based `spawnPiece` (`() =>
queue.shift()`) and get fully deterministic, hand-verifiable spawns,
exactly the "paste the board into a test" testing philosophy CLAUDE.md
asks for, extended to spawn behavior.

`createGameState` builds the real seeded version via the exported
`createSeededSpawnPiece(seed, pieceTypeIds)` helper, using `config.seed +
1` rather than `config.seed` itself — `generateLevel`'s own `mulberry32`
instance is internal and fully consumed by the time it returns a board, so
ongoing cascade spawns need their own stream. Offsetting by 1 keeps the
whole level's randomness fully determined by one seed while not replaying
the exact sequence the board fill already consumed.

**Alternative not taken:** storing `rng` + `pieceTypeIds` on `GameState`
and re-deriving `spawnPiece` inline in `applyMove` was rejected — it would
duplicate the index-selection logic that already exists once in
`generator.ts`, and it couples `GameState`'s shape to "how a piece gets
picked" instead of just "how to get the next piece," which is all
`calculateCascades` actually needs.

## `mulberry32` is duplicated here rather than imported from `generator.ts`

`generator.ts` doesn't export its `mulberry32` implementation (it's a
private, six-line detail of how that file achieves determinism), and this
session's scope explicitly excludes touching `generator.ts`. Duplicating
six lines of arithmetic here — used only by `createSeededSpawnPiece` for
`createGameState`'s convenience — is smaller and lower-risk than exporting
internal implementation detail from Phase 2's file to satisfy Phase 3, and
avoids a mid-session Phase 2 edit that wasn't asked for. If a Phase 4+
touch-up wants a single shared PRNG module, that's a clean small
extraction; not done here since it wasn't required and would mean editing
a file this session was told not to touch.

## `applyMove`'s illegal-move contract: no match, no move spent, no state change

A swap that produces no match doesn't just "not apply the swap" — it
returns the *original* `state` object (not a new one with the same board),
and consumes no move. This matches the literal spec wording ("snaps back")
and the intuitive player-facing behavior: tapping two tiles that don't
match should feel like nothing happened, not like a wasted move. `events`
is always `[]` for a rejected move — nothing worth notifying the skin
layer about happened.

## Applying a move while `status !== 'in_progress'` is a silent no-op

`applyMove` returns `{ state, events: [] }` unchanged if the game isn't
currently `'in_progress'` (i.e. it's paused or already won), rather than
throwing. The UI is expected to stop accepting taps once a level has ended
or paused, so this is a defensive-but-cheap guard against a stray call
landing after the fact, not a scenario the engine needs to explain itself
about with an error.

## `AsyncStorage` — real package now wired

Originally (before Phase 5's React Native scaffolding existed), this file
defined an `AsyncStorageLike` interface (`getItem`/`setItem`, both
`Promise`-returning) with only an in-memory default (`createInMemoryStorage`),
since `@react-native-async-storage/async-storage` wasn't installed yet.
That interface was written to structurally match the real package's method
shapes exactly for this reason: swapping it in later would be a matter of
changing what `defaultStorage` points to, not touching `loadSave`/
`saveProgress` or any call site.

That swap happened this session: `@react-native-async-storage/async-storage`
is installed, and `defaultStorage` is now the real package directly —
`AsyncStorage.getItem`/`setItem`'s actual signatures (each with an extra
optional trailing callback) are structurally assignable to the narrower
`AsyncStorageLike` type with no adapter object needed. `createInMemoryStorage`
is kept as an explicit, no-dependency option for tests that pass their own
`storage` argument rather than relying on the default.

## Save key namespacing

`loadSave`/`saveProgress` key the underlying storage as
`` `lalas-kitchen:save:${skinId}` `` rather than just `skinId` directly, so
the same `AsyncStorageLike` instance (a real device's AsyncStorage is a
single shared namespace) can't collide with unrelated keys some other part
of the app might someday store under a bare skin id like `"lalas-kitchen"`.

---

# Phase 4 — dual resume paths (moves and lives)

## Lives moved fully into live `GameState`, not just `SaveData`

Phase 3 already had a `lives` field on `GameState`, but it was effectively
just a copy of whatever `SaveData.lives` was at level start. Phase 4 treats
it as a genuinely independent, live-tracked value: a level attempt can now
spend lives *during play* without that spend being visible in `SaveData`
until the attempt actually saves. This mirrors exactly why `movesRemaining`
already lived on `GameState` and not just as a static "moves limit" config
value — a resource that can change mid-level needs to be *state*, not a
constant re-read from persisted data every time.

## `pauseReason` is the mechanism for per-pause-type skin messaging

`PauseReason = 'moves' | 'lives' | null` is a plain data field on
`GameState` (and mirrored on `LevelSummaryEvent`), not a message string, an
icon reference, or anything presentation-shaped. The engine's job stops at
"here's which resource hit zero" — a future skin can look at `reason` and
show "Out of moves! Watch an ad for 5 more?" vs. "Out of lives! Wait 30
minutes or spend a gem?" (wildly different copy, different monetization
hooks, possibly different animations) without `gameState.ts` ever needing
to know either message exists. Same "engine emits data, skin decides
presentation" separation the event types were already built on.

## `grantBonusMoves` / `grantBonusLife` each check the reason, not just the status

Both grant functions require `status === 'paused_awaiting_input'` **and**
`pauseReason` matching their own resource before doing anything — this is
what makes "granting the wrong resource should not accidentally unstick the
game" (an explicit test requirement) hold. Before this phase,
`grantBonusMoves` only checked `status`; now that two different reasons can
produce the same `paused_awaiting_input` status, checking status alone
would let a bonus-life grant wrongly resume a moves-exhausted pause (or
vice versa). Both functions also reset `pauseReason` to `null` on
successful resume, keeping it in sync with `status` the same way it was
initialized in `createGameState`.

## What actually decrements `lives` mid-level is deliberately left unbuilt this phase

This is the one open question this session didn't resolve unilaterally. The
task asks for "running out of lives mid-level pauses the level the same way
running out of moves does" — but unlike moves (decremented by `applyMove`
itself, once per legal swap, since Phase 3), nothing anywhere in
`CLAUDE.md`, the build spec, or this session's instructions specifies what
event during a level attempt should actually reduce `lives`. I flagged this
as a real fork with two incompatible designs (moves-exhaustion
auto-spending a life as its natural consequence, vs. lives being a fully
independent resource whose spend trigger is a separate, later concern) and
asked; no answer came back in time, so I proceeded with the smaller,
more-reversible option and I'm flagging it clearly here rather than
quietly deciding for good.

**What was built:** `applyMove`'s status computation checks `state.lives <=
0` as an independent trigger (checked before the `movesRemaining <= 0`
check, so if both happen to be true at once, `'lives'` — the more severe
resource — is the reason reported). `GameState.lives` is otherwise
untouched by any function in this file. This makes the reason/pause/resume
*mechanics* fully correct and tested (see `gameState.test.ts`'s
lives-exhausted test, which constructs a state with `lives: 0` directly to
exercise the check), without inventing a specific gameplay rule for how a
level actually burns through its lives.

**What's still open, logged to `DEFERRED_COMPLEXITY.md`:** the actual
in-level life-spend trigger. The strongest candidate considered was "moves
hitting zero costs exactly one life, and the reason tag reflects whether
lives are still available afterward (`'moves'`) or now also exhausted
(`'lives'`)" — the standard match-3 "failed attempt costs a life" pattern —
but adopting it would also require `grantBonusLife` to replenish moves (not
just lives), since a level resumed with `movesRemaining` still at 0 would
immediately re-trigger the same pause on the very next call. That's a
second design decision bundled inside the first, which is exactly the kind
of thing this file's own rule says to get confirmed rather than guess
twice in a row.

---

# Phase 5 — mismatches surfaced by building the presentation layer

Per this session's instruction, nothing in `engine/` was changed to
accommodate `components/Board.tsx` — these are flagged, not fixed. Full
rendering-side reasoning (placeholder sprites, animation timing, etc.)
lives in `components/NOTES.md`; this section is specifically about places
where the engine's existing API shape made rendering against it awkward.

## `applyMove` only returns the final settled board, not intermediate cascade steps

`Board.tsx` wants to animate a cascade as a sequence of beats — the swap,
then each match popping, then pieces falling, then the next chained match
popping, and so on — but `applyMove` resolves the *entire* chain internally
(`resolveCascades`'s `while` loop) and only ever hands back the fully
settled board plus aggregate counts (`cascadeCount`,
`clearedByMatchType`). There's no way, from the public API, to render each
cascade pass as a distinct visual step.

**What `Board.tsx` does instead:** a single before/after diff
(`components/boardDiff.ts`) comparing piece ids between the board state
before `applyMove` and the one after, inferring cleared/moved/spawned
pieces from *only* the two endpoints. Multi-cascade chains still animate —
every piece's start and end position is known — they just resolve as one
continuous motion rather than distinct chained beats. For this project that
arguably reads as *more* calm/satisfying, not less, which fits CLAUDE.md's
pacing goal — but it's a real capability gap, not a deliberate design
choice on the engine's part, and it's worth knowing about before any
future session assumes step-by-step cascade animation is possible without
an engine change (e.g. `applyMove` returning an array of intermediate board
snapshots instead of just the final one).

## `Position` isn't re-exported from `gameState.ts`

`gameState.ts` imports `Position` from `matrix.ts` internally (for
`applyMove`'s signature) but doesn't re-export it. `Board.tsx` needs
`Position` too (for tap-handling state) and has to reach past `gameState.ts`
into `matrix.ts` directly to get it — a minor but slightly odd asymmetry,
since everything else `Board.tsx` needs from the engine (`GameState`,
`applyMove`, `LevelConfig`, `PauseReason`, the grant functions) comes from
`gameState.ts` alone. Not changed this session per scope; a one-line
`export type { Position }` re-export in `gameState.ts` would remove the
need for components to know `matrix.ts` exists at all.

## Combo-streak and level-summary events aren't consumed by anything yet

`gameState.ts` emits `ComboStreakEvent` and `LevelSummaryEvent` from
`applyMove`'s return value, but `Board.tsx` currently discards
`result.events` entirely — it only reads `result.state`. This is
intentional, not an oversight: CLAUDE.md explicitly keeps the recipe-box/
summary layer out of scope for V1, and a dedicated combo-streak visual
effect would run against the same "calm, not frantic" constraint that
already rules out high-intensity particle effects. Noting it here so a
future phase wiring up real event consumers knows the event data has been
available and unused since Phase 3, not newly added.
