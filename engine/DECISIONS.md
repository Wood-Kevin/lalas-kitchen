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

## Mid-play stuck-board rescue: reuses `hasLegalMoves`/`shuffle` from `matrix.ts`, no event fires

Confirmed via real mobile playtesting (not a theoretical worry, and not a
visual miscount — verified programmatically that the settled board had
zero legal moves anywhere): a settled cascade can leave the player with no
legal moves, same failure class `generateLevel` already guards against once
at level creation. `applyMove` now runs the identical check-then-shuffle
sequence after every cascade settles, reusing `hasLegalMoves` and `shuffle`
directly rather than writing new stuck-detection logic — one guarantee
("this board is playable"), enforced the same way everywhere it can be
violated, instead of two similar-but-separate implementations to keep in
sync.

The check runs unconditionally after `resolveCascades`, regardless of the
move's resulting `status` — not gated to `status === 'in_progress'`. A
`paused_awaiting_input` board isn't necessarily done being played: granting
a bonus (`grantBonusMoves`/`grantBonusLife`) resumes play on this exact
board, so a paused board with zero legal moves would reproduce the same
bug one layer later, just deferred until the player successfully
un-pauses. Running the check unconditionally (including the harmless case
where `status` is `'won'` and the board will never be swapped on again)
was simpler than threading a status-dependent branch through for a case
that costs nothing extra to cover.

No `EngineEvent` fires for this. Per CLAUDE.md's calm-pacing constraint,
the game shouldn't announce a shuffle happened — it should just always be
true, silently, that a settled board has a move available. `shuffle` is
called with its default `rng = Math.random`, not a seeded stream —
unlike `generateLevel`'s board-fill (where "same seed always produces the
same board" is the whole point), a mid-play rescue reshuffle was never
part of that reproducibility contract; it only reacts to however the
player actually played, which is already non-deterministic input.

**Alternative not taken:** gating the check to `status === 'in_progress'`
only was considered (simpler to read, matches the "no legal moves" bug as
literally reported) but rejected once the resume-into-a-stuck-pause case
above was noticed — that gate would silently reintroduce the same bug
class for the `grantBonusMoves`/`grantBonusLife` path.

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

---

# Phase 6 — blocker clearing (cling wraps go from inert to real)

## Adjacent damage over a hidden-piece-underneath mechanic

The cling sprite existed since Phase 5 but nothing ever placed a piece that
used it — this phase is the first time `type: 'blocker'` does anything.
Two designs were on the table for how a blocker actually clears: **adjacent
damage** (a blocker takes a hit whenever a match clears next to it, and
disappears once `hitsRemaining` reaches zero) versus a **hidden-piece
underneath** mechanic (a blocker conceals a real matchable piece; clearing
the blocker layer reveals it, and the player has to match the piece
underneath separately, jelly-and-candy style).

Adjacent damage was chosen and confirmed before this session started
(design point 2 in the session brief). The reasoning: it's simpler (one
integer counter per blocker cell, no second piece type tracked underneath),
it matches the dominant genre convention for a first blocker type, and it
avoids doubling the per-cell data model (every blocker cell would need both
its own state *and* a full hidden `Piece` object, which cascades/spawning
would then need to know how to reveal). The hidden-piece idea is logged in
`DEFERRED_COMPLEXITY.md` as a richer mechanic worth considering once a
second blocker type is real and "the same mechanic for everything" starts
to feel thin — not dropped, just not built now.

## `piecesMatch` and `hasLegalMoves` exclude blockers by `type`, not by absent `matchType`

Before this phase, a blocker (or any piece) with no `matchType` was
automatically excluded from matching because `piecesMatch` required a
*defined* `matchType` on both sides (see the Phase 1 entry above). That
approach stops working the moment a blocker needs to carry a *real*
`matchType` (e.g. `'cling'`) so its clears can be counted toward an
objective via the exact same `clearedByMatchType` bookkeeping every other
match already uses. So `piecesMatch` now checks `type === 'blocker'`
explicitly and short-circuits to `false` regardless of `matchType` — a
blocker can carry any `matchType` for objective-counting purposes without
that value ever letting it participate in a run.

`hasLegalMoves` needed the same explicit exclusion, but for a different
reason: it isn't enough that a blocker itself never forms a run.
`swapPieces` swaps unconditionally, so a naive scan would happily "swap" a
blocker with a neighboring normal piece and then check whether the
*resulting* board has a match — and it can, if the neighbor's old position
lines up two other same-type pieces around the vacated blocker cell. That
would report a move as legal that would actually be **moving the
blocker**, which design point 1 explicitly rules out ("not swappable").
`hasLegalMoves` now skips any candidate pair where *either* cell is a
blocker before ever calling `swapPieces`, so a blocker can never be
half of a reported legal move even indirectly. `matrix.test.ts`'s
"only 'matching' swap requires moving a blocker" test exists specifically
to prove this — without the guard, that exact test fails.

**Alternative not taken:** teaching `swapPieces` itself to reject
blocker-involving swaps (throwing or no-op'ing) was considered, but
`swapPieces` already has a documented contract of not validating anything
about the positions it's given (see the Phase 1 "doesn't validate
adjacency" entry) — adding a blocker-specific check there would break that
existing invariant for one specific caller's concern. Both `hasLegalMoves`
and `gameState.ts`'s `applyMove` enforce "blockers aren't swappable" at
their own call sites instead, each already the natural boundary for that
distinct instance of the rule.

## `applyAdjacentDamage` lives in `matrix.ts`, not `gameState.ts`

The actual "which blocker gets hit and does it clear" computation
(`applyAdjacentDamage(board, clearedPositions)`) is a pure board-algorithm
function — same shape as `checkMatches`/`calculateCascades`/`shuffle` — so
it lives in `matrix.ts` alongside them rather than being inlined into
`gameState.ts`'s `resolveCascades` loop. `gameState.ts` is left owning only
the orchestration: call it once per cascade pass, fold any newly-cleared
blocker positions into the same clear/refill this pass already does, and
count the blocker's own `matchType` into `clearedByMatchType` the same way
a normal match's cleared cells are counted. This mirrors exactly how
`resolveCascades` already treats `calculateCascades` as the pure worker and
itself as the loop that calls it repeatedly.

A blocker adjacent to *several* cells cleared by the same match (e.g. an
L-shaped match wrapping two sides of it) only takes **one** hit for that
match, not one hit per adjacent cleared cell — `applyAdjacentDamage`
dedupes via a per-call "already damaged" set. This wasn't explicit in the
session brief, but it's the reading that matches the genre convention cited
as the reason for choosing adjacent damage in the first place (a jelly/
blocker tile in Candy Crush-style games takes one hit per match event, not
per tile of that match it happens to touch) — the alternative (counting
every adjacent cleared cell as a separate hit) would make a single
big/L-shaped cascade disproportionately more damaging than the same-size
match shape mattering at all, which isn't a rule anything asked for.

## `applyMove` rejects a blocker-involving swap the same way it rejects a no-match swap

Attempting to swap a cell that's a blocker (on either side of the pair)
returns the original `state` unchanged with `events: []` — identical to the
existing "no match, snap back" contract for an illegal swap (see the Phase
3 entry above). This was the smaller, more-consistent option versus
inventing a new "invalid move" outcome distinct from "no match" — from the
player's perspective both are "nothing happened," and the two-line guard
sits right next to the existing no-match check in `applyMove` rather than
needing its own event type or state field.

## The "Objective array" the session brief described doesn't exist — confirmed the single `Objective` already covers this

The session brief's design point 3 asked to confirm that blocker-clearing
objectives "use the exact same Objective array already built for
multi-objective levels" before building anything new. Checking the actual
code: `GameState.objective` and `LevelConfig.objective` are both a single
`Objective`, not an array — there is no multi-objective array anywhere in
this codebase, and `CLAUDE.md`'s own out-of-scope list explicitly excludes
"multi-target or score-threshold objectives" from V1. Flagging this
directly rather than silently building an `Objective[]` to match a premise
that didn't hold, since that would both be scope creep past `CLAUDE.md` and
solve a problem this phase doesn't have.

The underlying design goal holds anyway, with zero new architecture: a
blocker's clear already gets folded into `clearedByMatchType` (keyed by the
blocker's own `matchType`, e.g. `'cling'`) by the same code path a normal
match's cleared cells go through. `applyMove`'s existing
`objectiveGain = clearedByMatchType[state.objective.targetMatchType] ?? 0`
line — unchanged by this phase — already treats a blocker's `matchType` no
differently than any piece type's. A level wanting "clear 3 cling wraps" is
exactly `objective: { targetMatchType: 'cling', targetCount: 3 }`, and
`gameState.test.ts`'s blocker win-condition test proves it end to end.

## Blockers are placed by overwriting cells after the board is already match-free, not woven into the fill loop

`generator.ts`'s `placeBlockers` runs *after* the greedy fill and
`repairAccidentalMatches` pass, converting a random selection of already-
placed normal cells into blocker cells, rather than being woven into
`forbiddenTypesAt`/the per-cell fill loop. This is safe specifically
because a blocker is excluded from matching outright (see the
`piecesMatch` entry above): turning an existing cell into a blocker can
only ever *remove* a matchType from play at that position, never introduce
a new run, so there's no need to re-run the repair pass afterward, and
`forbiddenTypesAt` never needs to know blockers exist at all. This keeps
the fill/repair pipeline — already carefully reasoned through for the
hostile-config case (see the Phase 2 entry above) — completely untouched.

Positions are chosen via one `fisherYates` shuffle of every board cell,
taking the first `blockerCount`, rather than repeatedly picking a random
cell and re-rolling on collision — guarantees distinct cells in one pass
with no retry loop needed, the same reasoning `fisherYates` was already
used for elsewhere in this file.

The existing `hasLegalMoves` → `shuffle` fallback at the end of
`generateLevel` is reused unchanged as blocker placement's own safety net:
since `hasLegalMoves` now itself excludes blocker cells as candidates (see
above), that check already answers "is this board — including its
blockers — actually playable," and `shuffle` already handles rearranging a
board with mixed piece types into one that passes. No new safety-net logic
was written specifically for the blocker case.

**Alternative not taken:** validating that `blockerCount` stays under some
board-size-relative ceiling was considered, but rejected as unneeded
defensive code — `generatedBlockerCount` (`appPersistence.ts`) is the one
caller that actually varies this value, and it's capped at 4 on an 8x6
board, nowhere near dense enough to threaten `hasLegalMoves`. If a much
higher `blockerCount` is ever passed directly to `generateLevel`, the
existing bounded-retry `shuffle` fallback already degrades the same way it
does today for any other hostile config — returning its last attempt
rather than hanging (see the Phase 2 shuffle-retry-cap entry above).

---

# Phase 7 — the real life-spend trigger (losing costs a life)

## Investigation before building: regen math didn't exist, and three named entry points were actually four

This session's brief asked for an investigation pass before any code
changed, so the findings are recorded here rather than just implied by the
diff.

**Regen math:** `SaveData.livesLastRegenAt` existed since Phase 4 but was
write-only — `buildSaveData` stamped it on every save, and nothing anywhere
read it back to compute elapsed time or grant regenerated lives. Confirmed
via a repo-wide search for every reference to the field before writing any
regen logic.

**Level-start entry points:** the session brief named three (Home's "Start
cooking", an All Levels row, and Play Again from both overlays). Checking
`App.tsx` directly showed Home's "Start cooking" and an All Levels row tap
already call the exact same function, `handlePlayLevel` — not two separate
code paths that happened to look similar. The fourth entry point,
WonOverlay's "Next Level" (`handleNextLevel`), was deliberately **not**
gated: reaching a win already required lives > 0 to have started that same
level, and winning never spends a life anywhere in this design, so it can
never legitimately fire at zero lives. Gating it anyway would be dead
defensive code for a state that structurally cannot occur.

Play Again (`Board.tsx`'s internal `handlePlayAgain`, shared by both
overlays per the prior session) turned out to be the one entry point with
no gate *and* a latent staleness bug: it rebuilt the level from
`levelConfig.lives`, the value frozen at Board's original mount, not
whatever the account's lives actually were by the time the player tapped
Play Again. Under the old build this was harmless (nothing ever changed
lives), but it would have silently ignored this session's own loss
decrement. Fixed by threading a live `lives` prop down from `App.tsx`
instead — see the `Board.tsx` entry below.

## `pauseReason: 'lives'` removed outright, not just left unreachable

The investigation's third question was whether `pauseReason: 'lives'` (and
`grantBonusLife`, and `applyMove`'s `state.lives <= 0` check) were still
reachable. They weren't, for two independent reasons stacking on top of
each other:

- **Already true before this session:** Phase 4's own decision log
  (above) flags that nothing was ever built to decrement `GameState.lives`
  mid-level — the check existed, but nothing could trigger it outside a
  hand-built test state.
- **Permanently true after this session:** the life-spend mechanic actually
  built here spends a life *after* a level ends (at the account level, in
  `App.tsx`), not mid-level, and level-start itself is now gated at
  `lives > 0`. `GameState.lives` is fixed at level-start to an
  already-gated value and nothing ever decrements it during play, so it can
  now *never* reach zero inside a call to `applyMove` — not "not yet
  wired," but structurally excluded by the model this phase ships.

Given that, keeping the branch, `grantBonusLife`, and the `'lives'` values
on `PauseReason`/`PauseAction` around as inert "insurance" was rejected —
unlike `Piece.type`'s `'row_clearer'` placeholder (a field that costs
nothing to leave unused and has an obvious future use), this was a full
branch of *reachable-looking but dead* logic with its own test coverage
asserting behavior that could no longer occur, which is exactly the kind
of thing that lies about what's true the same way a stale doc does. Removed
cleanly: `PauseReason` is now `'moves' | null`, `grantBonusMoves` is the
only grant function left, `pauseActions.ts`'s `getPauseAction` only
handles `'moves'`, and the old lives-exhausted tests were deleted and
replaced with one regression test proving `lives <= 0` no longer causes or
reports a pause at all.

**Alternative not taken:** keeping the mechanism "for later, in case a
mid-level lives-spend trigger is ever built" was considered and rejected —
if that trigger is ever built, it's a new design decision (what event
spends a life mid-level, and per Phase 4's own note, whether resuming it
needs to replenish moves too) that deserves fresh reasoning at that time,
not a resurrection of a branch that was already flagged as built without a
real trigger once before.

## Life-spend lives in `App.tsx`, not `engine/gameState.ts`

The loss condition (`applyMove` reaching `paused_awaiting_input` with
reason `'moves'`) is an engine-level fact, but *spending an account-level
life because of it* is not engine logic — it's exactly the kind of
persistence/meta-progression decision `appPersistence.ts` already owns
(alongside `markLevelCompleted`, `buildSaveData`, etc.), not something
`engine/gameState.ts` should know exists. `GameState.lives` continues to
exist purely as the HUD's per-level display value, seeded fresh from the
account's lives at level start; the account-level count that actually
changes lives in `App.tsx` as real `useState`, mirrored into a ref
(`livesRef`) for the same stale-closure reason `levelIndexRef`/
`completedLevelsRef` already exist.

Two pure functions carry the actual logic, tested directly rather than
through a mounted component (this project still has no component-mount
harness — see `components/NOTES.md`): `shouldSpendLifeOnLoss(prevStatus,
nextStatus, pauseReason)` decides *whether* this transition is a loss (by
composing the already-existing `didLevelJustEnd`, not re-deriving that
condition), and `livesAfterLoss(lives)` is the one-line decrement itself.
Splitting them this way means "is this a loss" and "what does a loss do to
the count" are each independently testable, and `handleBoardStateChange`
in `App.tsx` is left doing only orchestration — no branching logic of its
own to get subtly wrong.

**Why this can't double-decrement:** `shouldSpendLifeOnLoss` is checked
using the exact `prevStatus`/`nextStatus` pair `didLevelJustEnd` already
uses to gate `persistLatestState()`, captured from `prevStatusRef` *before*
it's overwritten. Board's own
`useEffect(() => onStateChange?.(gameState), [gameState])` only re-fires
when the `gameState` object identity actually changes (a real move, grant,
or restart) — a plain re-render with the same `gameState` reference never
re-invokes it. So a paused state sitting on screen while the player reads
"Out of moves!" and decides what to do next re-renders freely without ever
calling `handleBoardStateChange` again, and the one call that *does* fire
for the loss sees `prevStatus === 'in_progress'` exactly once, immediately
overwriting `prevStatusRef.current` to `'paused_awaiting_input'` before
any subsequent call could see the same prior value again.

## `buildSaveData` takes an explicit `livesLastRegenAt` instead of always stamping `now()`

Before this session, every single save (level end, app backgrounding)
called `now()` unconditionally for this field — harmless when nothing read
it back, but it would have silently reset the regen clock on every save
once real regen math existed, since a player backgrounding the app while
sitting on 3/5 lives would erase whatever partial progress the timer had
made toward the next tick. `buildSaveData` now takes an optional
`livesLastRegenAt` parameter that, when provided, is used verbatim instead
of falling back to `now()` — optional (not required) specifically so the
one pre-existing test call site (which predates regen math and isn't
testing the regen anchor) keeps working completely unchanged, while
`App.tsx`'s real call site always passes the authoritative anchor it's
been tracking in `livesLastRegenAtRef`.

## `applyLivesRegen`: caps discard excess elapsed time, but a partial interval below the cap doesn't

`applyLivesRegen(lives, livesLastRegenAt, max, regenMinutes, now)` is a
pure function (elapsed time computed from an injected `now: number`, not
read internally via `Date.now()`) — same reasoning as `calculateCascades`'s
injected `spawnPiece` in `matrix.ts`: same inputs, same output, directly
testable without mocking a clock.

Two cases are handled differently on purpose, both required by this
session's own test list:

- **Already at (or would exceed) `max`:** lives clamp to `max` and the
  anchor resets to `now`. Elapsed time beyond what `max` can absorb is
  discarded outright, not banked — otherwise a player idle for days at full
  lives who then loses one later would appear to have an enormous head
  start on the next regen, which is exactly the "doesn't grant extra lives
  for elapsed time beyond what regenMinutes and max allow" behavior this
  session's tests require.
- **Still below `max` after granting whatever intervals fit:** the anchor
  only advances by the elapsed time actually *consumed* by the granted
  intervals (`livesLastRegenAt + grantedIntervals * regenMs`), not reset to
  `now`. A player who checks in slightly before the next tick is due
  shouldn't lose that partial progress just because *something* happened
  to trigger a regen check.

**Where regen is actually invoked:** three checkpoints, all owned by
`App.tsx`, no ticking timer anywhere (matching Home's own "No timers. No
rush." footer copy) — app boot (from whatever the save last recorded),
every `handlePlayLevel` call (a player can sit on Home or All Levels for a
while before tapping into a level), and immediately before applying a loss
decrement (so a delayed save flush still reflects the most accurate
possible count). `handleNextLevel` also refreshes it, for the same
"freshest possible count" reason, without gating on the result — see this
phase's investigation note above on why "Next Level" is exempt from the
lives gate itself.

**Alternative not taken:** a genuinely spoof-resistant regen scheme (server
time, monotonic clocks, etc.) was not built — `CLAUDE.md`'s Data Model
Notes already call the `livesLastRegenAt` clock-spoofing gap an accepted
tradeoff at this project's scale, and this session's brief explicitly asked
to reuse the existing field and caveat rather than solve that problem now.

## `Board.tsx` gates Play Again with a `lives` prop, not `levelConfig.lives`

`Board.tsx` now takes `lives: number` (the account's current count, kept
fresh by `App.tsx`) and `onOutOfLives: () => void` as new props.
`handlePlayAgain` checks `canStartLevel(lives)` — the exact same function
`App.tsx`'s `handlePlayLevel` calls, imported directly rather than
duplicated as an inline `lives <= 0` — before restarting, and seeds the
fresh `createGameState` call with the live `lives` prop instead of the
frozen `levelConfig.lives` snapshot from this Board instance's original
mount (see this phase's investigation note above on why that mattered).

Reusing `canStartLevel` here means `components/Board.tsx` imports from
root-level `appPersistence.ts` — a new cross-import direction for this
codebase (previously only `App.tsx` imported from it). Considered keeping
the check as a duplicated one-line inline expression instead to avoid the
new dependency, but rejected: the session's own emphasis on "the same lives
gate, not just one of them" argues for one shared function over three call
sites that happen to currently agree, and `appPersistence.ts` is already
documented as app-shell logic split out specifically for testability, not
something scoped exclusively to `App.tsx`'s own file.

## `OutOfLives.tsx` is one shared screen, not three inline treatments

All three gated entry points (`handlePlayLevel` for Home/All Levels, and
Board's `onOutOfLives` callback for Play Again) route to the same
`App.tsx` `screen: 'outOfLives'` state and the same `OutOfLives` component,
rather than each rendering its own inline "blocked" message. Consistent
with this session's "just needs to exist and be honest, not polished"
scope: one minimal screen (message, brief detail, a back-to-Home button) is
both less code and a more honest single answer to "what does being out of
lives look like in this app" than three slightly-different placeholders
would be.

## Objective becomes an array — the multi-objective work an earlier phase explicitly deferred, now directly requested

An earlier phase's entry above ("The 'Objective array' the session brief
described doesn't exist") confirmed there was no multi-objective array
anywhere in the codebase and flagged multi-target objectives as explicitly
out of scope per `CLAUDE.md`. That conclusion was correct *for that
session* — it wasn't asked for then. This session's brief asked for it
directly and in detail, so it's now built; this entry supersedes that one's
"doesn't exist" conclusion without erasing it, since it was accurate history
at the time.

`GameState.objective`/`LevelConfig.objective` (a single item) became
`objectives`/`objectives` (an array of the same per-item shape). The
per-item `Objective` type itself didn't change at all — every existing
consumer of a single objective's shape (`components/wonActions.ts`, unused
in production but still tested) needed zero changes, only the container
around it did. `applyMove` maps every entry's `currentCount` forward each
move (each keyed off its own `targetMatchType` against the same
`clearedByMatchType` bookkeeping every match already produces) and wins only
once `objectives.every((o) => o.currentCount >= o.targetCount)` — a
single-objective level (every hand-built `LEVEL_QUEUE` entry today) is an
array of length one, not a special case, so this required no changes to any
existing level data.

For generator-driven levels, `appPersistence.ts` gained
`generatedObjectiveCount(levelNumber, typeCount)`: 1 objective until level
number 4 (chosen so the very first generated level, still at full
piece-type-pool size, doesn't also take on a second simultaneous target —
a bigger jump than any other step this difficulty ramp takes elsewhere),
then `min(2, typeCount)` — capped at the level's own piece-type pool size as
a structural safety net, not a real difficulty lever, since
`generatedPieceTypeCount`'s floor of 3 means it never actually bites once
the threshold opens. Two objectives are picked as consecutive indices into
the level's own `pieceTypeIds` (`pieceTypeIds[(levelNumber - 1 + i) %
length]`), which is distinct-by-construction — never worth a runtime
duplicate check since the math can't produce one as long as objectiveCount
<= pieceTypeIds.length, which `generatedObjectiveCount`'s own cap
guarantees.

`components/Hud.tsx`'s Target panel maps over `objectives`, rendering one
icon+count row per entry (stacked, `marginTop` only between rows past the
first) — a single-objective level renders exactly the one row it always
rendered before, unchanged. `components/WonOverlay.tsx`'s plated-dish
illustration stays pinned to the first objective (no room for more than one
icon there), but the "COLLECTED" chip row below now maps over every
objective, each still reading its own real `currentCount`/`targetCount`
directly (so overshoot — a cascade clearing more than the remaining target
— still displays correctly per objective, unchanged behavior just no longer
assumed singular). `components/levelProgress.ts`'s `buildLevelSummary`
(Home's "Up Next" card, All Levels' row icons) deliberately still only ever
reads `objectives[0]` — that single-icon row layout was never asked to grow
with objective count, so a two-objective generated level's row/card just
shows its first target, same as before.
