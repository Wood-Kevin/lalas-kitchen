# engine/matrix.ts — Implementation Decisions

Choices made while building Phase 1 that weren't already pinned down in
`lalas-kitchen-build-spec.md` or `CLAUDE.md`. Read this if you need to
verify or challenge *why* something is shaped the way it is, not just *what*
it does — the code already tells you what.

## `type` vs `matchType`

The piece shape has both `type: 'normal' | 'striped' | 'blocker'` and an
optional `matchType?: string`. The spec doesn't spell out the difference, so
I split them by role: `type` is the piece's *behavior* category (`'normal'`
was the only one in Phase 1; `blocker` became real in Phase 6, and `striped`
— the first special piece — in the striped-piece session, see that entry
below; the union's original third member was a `'row_clearer'` placeholder,
renamed to `'striped'` once it was actually built as a single type carrying a
row/col `direction`). `matchType` is the *kind/flavor* used purely for
match-detection equality —
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

- **`pieceTypeIds` (longer list → harder):** **Retraction, corrected in the
  generated-level ramp (`appPersistence.ts`'s `generatedPieceTypeCount`):**
  this entry originally claimed a *shorter* `pieceTypeIds` list was the
  harder direction ("fewer distinct types means fewer safe choices at each
  cell, more frequent forced repairs, and denser boards"). That's a
  board-generation-difficulty claim, not a player-difficulty one, and it's
  backwards for the player: on a fixed board size, fewer distinct types
  means each type is packed more densely, so any given swap has a much
  higher statistical chance of creating a match — the board gets *easier*
  to play, not harder. Real match-3 games add colors for harder difficulty,
  not remove them, since more types make matches genuinely rarer and
  require deliberate play instead of near-automatic ones. This was caught
  after generated levels using the old (backwards) ramp were clearing
  two-objective levels in ~3 moves once the pool shrank toward its floor.
  The corrected direction — fewer types early (gentle intro), more types as
  levels continue (matches genuinely rarer) — is what `generatedPieceTypeCount`
  implements now. `generateLevel` itself is difficulty-direction-agnostic;
  it just fills whatever `pieceTypeIds` it's given, so this correction lives
  entirely in the caller's ramp, not in this file.
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

## `applyMove` returns each cascade pass as a distinct step (was: only the final settled board)

**Resolved.** `applyMove` now returns `steps: Board[]` on `ApplyMoveResult`
— one settled-board snapshot per cascade pass, in resolution order, with the
last entry equal to `state.board`. `Board.tsx` walks that sequence and
animates each pass as its own beat (this pass's clears settle, then a fixed
interval later the next pass's clears begin), instead of collapsing the
whole chain into one before/after diff.

**Why this changed:** the original accepted limitation (below) was justified
on the theory that one continuous motion reads *calmer* than distinct steps.
Real play showed the opposite — watching every cell across a multi-pass
chain clear simultaneously, including chains the player didn't directly
cause, is *harder* to follow than watching it resolve in sequential beats.
This traded the calm-vs-legible call the other way, which is the correct
read of CLAUDE.md's calm-pacing constraint for *this* player.

**How it's exposed, not recomputed:** `resolveCascades`'s `while` loop
already computed each pass's settled board internally; the change just
pushes each one onto a `steps` array and returns it. No new cascade math.
`applyMove` overwrites the final step with the post-rescue `resolvedBoard`
so the sequence ends exactly on the committed board — a zero-legal-move
rescue shuffle (see the stuck-board entry below) folds silently into that
last beat rather than becoming a visible extra rearrangement.

**Presentation side (`Board.tsx`):** diffs consecutive snapshots
(`components/boardDiff.ts`, still the same before/after id diff, now applied
per pass rather than once end-to-end), renders intermediate passes from a
`displayBoard` state, and defers committing `gameState` — and therefore any
win/paused overlay — until the final pass so overlays never appear over a
still-resolving board. Taps are locked (`animatingRef`) during the
animation, since `gameState` is still the pre-move state until the chain
finishes. Per-step pacing reuses the existing cascade fall duration
(`cascadeStepIntervalMs`), not a new number. A single-pass move
(`steps.length === 1`) collapses to exactly the prior one-shot behavior:
one diff from the pre-move board to the settled board, `gameState`
committed immediately.

**Original limitation, kept for context:** `applyMove` used to resolve the
entire chain internally and hand back only the fully settled board plus
aggregate counts (`cascadeCount`, `clearedByMatchType`), so `Board.tsx`
inferred cleared/moved/spawned pieces from *only* the pre- and post-move
endpoints. Multi-cascade chains still animated — every piece's start and end
position was known — but resolved as one continuous motion rather than
distinct chained beats.

**Follow-up fix — the terminal overlay was NOT actually deferred past the
final pass.** The "defers committing gameState — and therefore any win/paused
overlay — until the final pass" claim above was only half-true. `animateCascade`
committed `gameState` (flipping `status` to `'won'`/`'paused_awaiting_input'`)
at the *start* of the final pass's `runStep`, and the overlays rendered directly
off `gameState.status`. So the overlay appeared the instant the winning move's
data resolved — over the final pass while it was still animating (and, on a
single-pass win, over the winning match's own pop). Real play surfaced this: the
Won overlay cut off the chain reaction of the winning move. Root cause is the
same "two features built at different times, never checked against each other"
shape — the cascade-steps sequencing solved everything-happens-at-once for
ordinary matches, but the overlay trigger was never revisited against it.

Fixed by gating the terminal overlays on a `terminalOverlayReady` flag
(`Board.tsx`) set `true` only one full between-pass beat *after* the final pass
commits — the last pass now gets the same play time every earlier pass already
gets before the next one starts. The reveal timing is pure and unit-tested:
`planCascadeAnimation` / `terminalOverlayHoldMs` in `components/cascadeTiming.ts`
(the overlay reveal is always strictly after every pass's start). `status`
itself — and therefore App-level persistence, recipe unlocks, and input lockout
— still commits with the data on the final pass; only the *visual* reveal waits,
so nothing about win/persistence semantics moved, just when the overlay is drawn.
Verified live: `docs/verification/won-overlay-timing/`.

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

**Superseded for `combo_streak` specifically:** a later session asked for
exactly this — a calm acknowledgment, explicitly not a celebration — so
`combo_streak` is consumed now. `Board.tsx` reads `result.events` for a
`combo_streak` entry and mounts `components/ComboStreakBanner.tsx`, a
small text pill ("Nice chain!") that fades in, holds briefly, and fades
back out on its own — no scale/bounce/particle motion, satisfying the same
"calm, not frantic" constraint this entry originally cited as the reason
*not* to build one, by simply picking a gentler effect than a particle
burst rather than skipping the effect entirely. `LevelSummaryEvent` is
still unconsumed — the recipe-box/summary layer it would feed remains out
of scope per CLAUDE.md, and this session didn't touch it.

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

**Retraction, corrected alongside the `generatedPieceTypeCount` inversion
(see the "Difficulty tuning" entry above):** the `generatedObjectiveCount`
description two paragraphs up is stale. It gated the second objective on
`levelNumber < 4`, timed against the old (backwards) piece-type ramp so the
second objective wouldn't land "while the full piece-type pool was still in
play." Once the piece-type direction inverted, that timing became actively
harmful: the second objective was landing exactly when the piece-type pool
was at its smallest (the new ramp's easy end), and two objectives drawn from
a tiny pool meant nearly every random match satisfied one target or the
other — generated levels were clearing in ~3 moves. `generatedObjectiveCount`
now takes `typeCount` alone (no `levelNumber` parameter) and gates on
`typeCount >= MIN_TYPES_FOR_SECOND_OBJECTIVE` (5), so the second objective
only appears once the pool has grown large enough that 3 types remain
"neutral" (not a target) — the actual variable that determines whether a
second objective trivializes the level, not a levelNumber proxy for it. The
`min(2, typeCount)` cap and the distinct-consecutive-index construction
described above are unchanged.

## `generatedTargetCount` is a per-level total, shared across objectives — not a per-objective quota

Reported from real play: level 28 asked for 26 tomatoes **and** 26 lemons,
which felt unwinnable. Investigation confirmed it effectively was.
`buildGeneratedLevelConfig` was handing **every** objective the full
`generatedTargetCount(levelNumber)` independently, so a two-objective level
demanded double an equivalent single-objective one. `generatedTargetCount`
takes `levelNumber` alone and has no knowledge that multiple objectives
exist, so nothing ever divided the burden — the two objectives compounded.

The real numbers at level 28 (generated level number 25): 2 objectives ×
26 = **52** pieces against an **18**-move floor = **2.89 target pieces
cleared every single move**. The theoretical minimum of clean 3-matches
(9 per objective = 18) *equals* the move budget, i.e. zero margin in a
physically impossible perfect game — before accounting for the 4-of-6
neutral piece types (~⅔ of the board makes no progress) and up to 4
blockers. Not unique to 28: the 52-piece burden lands on **every**
two-objective level from level 10 on, while the move budget only shrinks
(21 → 18), so the milestones 15, 21, and 28 were all in the wall zone.

Two contributing factors, both confirmed:
1. **The compounding bug itself** (above) — the target formula was never
   re-examined after multi-objective levels were introduced. The test that
   should have caught it instead asserted `26 + 26` and enshrined it.
2. **The `generatedPieceTypeCount` ramp inversion** (see the "Difficulty
   tuning" retraction above) was correct on its own, but it widened the pool
   at high levels, making each specific type ~1/6 of the board and target
   matches statistically scarcer. The `generatedTargetCount` ceiling of 26
   had been tuned under the old ramp (fewer types high up, denser target
   packing), so the same 26 became meaningfully harder without anything
   re-tuning it.

**Fix:** `perObjectiveTarget = ceil(generatedTargetCount(levelNumber) /
objectiveCount)`. `generatedTargetCount` is now the level's **total** piece
burden, shared across its objectives, so a two-objective level stays in line
with a one-objective level of the same number rather than doubling. `ceil`
guards against an odd total rounding a level below its intended burden,
though in practice two objectives only ever appear once the target has
saturated at 26 (both need levelNumber >= 7), so it splits cleanly to 13 +
13. Single-objective levels are unchanged (`ceil(x / 1) === x`).

Corrected numbers at the reported milestones: level 15 → 13 + 13 = 26 over
19 moves (1.37 pieces/move); level 21 → 13 + 13 over 18 moves (1.44); level
28 → 13 + 13 over 18 moves (1.44). All comfortably feasible, down from 2.89.
The alternative lever — keeping 52 and raising the move budget past ~30 —
was rejected: it would break the deliberately calm 18-move floor, and
lowering the grind is the cleaner correction than inflating the moves.

## `grantInstantLife` is a full refill to max, not the genre-standard +1

Explicitly requested as a deliberate design choice, not a bug fix: the
"watch a video" bonus on `OutOfLives.tsx` now restores lives to `max`
outright rather than adding exactly one. Match-3 games conventionally grant
a single life per ad specifically to keep the player wanting more (and
watching more ads) — this app has no ad-revenue incentive pulling that way,
and CLAUDE.md's Design Constraints already establish a calm, generous,
no-pressure tone everywhere else (no timers, no urgency copy, no
high-intensity effects), so a stingy grant here would be the one place that
tone breaks.

Mechanically, this made the function's `lives` parameter dead — the result
never depended on the current count, only on `max` — so the signature
dropped it (`grantInstantLife(max)`), rather than keeping an unused
parameter around for a shape no longer accurate. `OutOfLives.tsx`'s
countdown pill needed a third state alongside its existing
counting-down/ready pair: `msUntilNextLifeRegen` already returns 0 once
`lives >= max` (nothing left to regenerate), which the pill used to read as
"a life should be ready" — technically true but misleading once a full
refill already landed and all flame slots are already filled. Added an
explicit `atMax` check ahead of `ready` so that state reads "Lives are full"
instead.

## Recipe card collection: a fixed curated set tied to milestone levels, not one card per level

Brought into V1 scope from CLAUDE.md's Explicitly Out of Scope list
(previously "Recipe box meta layer UI" — the engine's `level_summary`
event existed but nothing consumed it, see this file's "Combo-streak and
level-summary events" entry above for the sibling case). The core design
question: levels generate indefinitely (`buildGeneratedLevelConfig`), but a
personal collection needs to actually be completable someday, so a card
can't be awarded per level forever.

**Chosen: a fixed array of 9 curated cards, each pinned to one specific
milestone level number** (`skinConfig.recipeCards` in `config.json` — `id`,
`title`, `flavorText`, `milestoneLevel`, `sprite`), looked up by
`appPersistence.ts`'s `findRecipeCardForLevel`. Every other level (every
non-milestone hand-built or generated level) unlocks nothing. Milestone
levels are 1, 3, 6, 10, 15, 21, 28, 36, 45 — triangular numbers
(`T(n) = n(n+1)/2`), chosen so cards land quickly at first (levels 1, 3, 6
are reachable in a single sitting) and the gaps widen gradually rather than
jumping straight to some arbitrary late-game number, without hand-tuning
nine unrelated constants. Confirmed with the requester before implementing,
per that session's explicit ask.

**Alternative not taken:** one card per level, capped at 9 by only
rewarding the first 9 levels ever completed. Rejected because it would tie
the collection to raw completion order rather than to specific, memorable
level identities — replaying out of order, or skipping around via All
Levels, would make "which 9 levels give cards" an accident of play order
instead of a deliberate curated set a player could look forward to by name.

**Persistence mirrors `seenTutorials` exactly, not a new pattern:**
`SaveData.unlockedRecipeCards` is an optional string list of unlocked card
ids; `appPersistence.ts`'s `unlockRecipeCard` is idempotent the same way
`markTutorialSeen`/`markLevelCompleted` are, so replaying an
already-unlocked milestone level (Board.tsx's "Play Again", or revisiting
it from All Levels) never duplicates an entry. The reveal itself
(`components/RecipeCardReveal.tsx`) is a distinct, separately-computed
value — `App.tsx`'s `handleBoardStateChange` recomputes "did this exact win
just unlock a *new* card" fresh at every won transition (the same spot
`completedLevels` already updates from) and threads the single resolved
card (or `null`) down through `Board.tsx` to `WonOverlay.tsx`, rather than
having `WonOverlay` or `Board` independently infer newness from the
persisted list — one place decides "is this new," everything downstream
just renders what it's told.

**No real card art exists yet, by design, not as a gap left for later:**
every `recipeCards[].sprite` value has no corresponding
`skins/lalas-kitchen/spriteRegistry.ts` entry, so every card renders
through the exact same `resolveSpriteAsset` image/text-label fallback
contract every piece and blocker already uses. This was explicitly asked
for as a way to ship the whole system now and drop in real illustrations
later as a pure asset addition — zero code changes in
`RecipeCardReveal.tsx` or `RecipeBook.tsx` either way.

**Calm over gamified, by explicit design brief, not an oversight:** the
reveal is a single card at a fixed gentle tilt with one soft glow and a
mount-in fade — no confetti, no burst, no flip animation. The collection
screen (`components/RecipeBook.tsx`) is a plain 3x3 grid with dashed-empty
placeholders for anything not yet unlocked — no lock glyph (unlike
`AllLevels.tsx`'s locked-level rows, which do use one), no star, no tier,
no percentage, no progress bar, just `components/levelProgress.ts`'s
`buildRecipeBookSubtitle` plain "X of 9 collected" count. This replaced
`Home.tsx`'s old `buildProgressCopy` (an open-ended "N recipes cooked so
far" flavor line keyed off level-completion count, unrelated to any real
collection) — that function and its "Your recipe book" card were the only
place in the app that already used recipe-themed copy without a real
recipe system behind it, so once a real one existed, leaving the old
disconnected count in place under the same heading would have actively
misled a player into conflating two different numbers.

## Striped pieces: the first special piece (spawn on 4, sweep a line when matched)

The first genre-standard special piece. A run of *exactly* 4 (row or column)
converts one of its cells into a `type: 'striped'` piece carrying the base
`matchType` plus a `direction: 'row' | 'col'`; matching that striped piece
later (it participates in matches by its `matchType` like any ordinary
piece) sweeps its whole row or column. All of this lives in
`gameState.ts`'s `resolveCascades` / `resolveMatchEffects`; `matrix.ts` only
gained the data to make it possible (`Match.orientation` and
`Piece.direction`).

**Why one `'striped'` type + a `direction` field, not `'row_clearer'` /
`'col_clearer'`:** the feature was specified as "a striped piece carrying a
direction," and one type keeps every "is this special?" check a single
`type === 'striped'` test instead of a growing set of literals. This is the
former `'row_clearer'` placeholder, now built and renamed.

**Direction mapping — parallel, and deliberately one line to flip.** A
horizontal 4-run makes a **row**-clearer, a vertical one a **col**-clearer
(`resolveMatchEffects` sets the anchor's direction to `match.orientation`
directly). This is the most literal reading of the spec ("4 in a row …
clears a full row") and the simplest to reason about. The genre's other
common convention is *perpendicular* (Candy Crush: a horizontal match makes a
column-clearer); switching to it is the single expression
`match.orientation === 'row' ? 'col' : 'row'` at that one call site — no
other code cares. Engine correctness is identical either way; only feel
differs, so it's parked as a runner-level default the architect can flip.

**Spawn mechanics:**
- The anchor is `positions[0]` of the run (deterministic, easy to test). The
  other three cells clear; the anchor is transformed **in place**, keeping
  its `id` and `matchType`, so the presentation diff sees a piece that stayed
  put (not a spawn) and just re-renders as a striped tile, and it falls
  under gravity like any piece.
- **Objective counting:** only cells that actually clear are counted, so a
  4-match credits **3** toward objectives (the anchor became a striped piece,
  it wasn't cleared) and the striped piece pays out the rest when it later
  sweeps. Counting is now driven by the actual cleared-cell set, not
  `match.positions.length` — which also removed the old double-count when two
  matches overlapped a shared cell.

**Trigger mechanics:**
- Any match *containing* a striped piece triggers it: its full row or column
  is added to the clear set, alongside the ordinary match cells. The striped
  piece is consumed.
- **Blockers are never force-cleared by a sweep.** A line sweep adds only
  non-blocker cells to the clear set; a blocker sitting in the swept line
  still takes ordinary adjacent damage from its cleared neighbours
  (`applyAdjacentDamage`), so its `hitsRemaining` semantics stay intact — one
  clearing rule for blockers, everywhere.

**Deliberate scope limits (see DEFERRED_COMPLEXITY.md):** a sweep does **not**
chain — a striped piece caught in another's sweep just clears, it doesn't
fire; runs of **5+** clear normally with no larger special (no color bomb);
and overlapping straight runs (L/T shapes) are each handled independently,
with an anchor cell winning over any match that also wanted to clear it
(`resolveMatchEffects` deletes anchor keys from the clear set last). These
keep the first special piece bounded and correct rather than half-building
the whole genre's special-piece tree.

**Rendering: dedicated art with the standard placeholder fallback (not an
overlay).** A striped piece resolves its sprite through the *same* path every
other piece uses — `components/spriteMap.ts`'s `getSpriteForPiece` returns
`striped_<base sprite>` (e.g. `striped_tomato.webp`), and `resolveSpriteAsset`
shows the registered image if the skin has that art or the usual text-label
placeholder if not. So real striped art is purely a
`skins/lalas-kitchen/spriteRegistry.ts` addition, one line per asset, exactly
like piece/blocker/recipe-card art. Tomato and lemon have real striped art;
herb/garlic/chili/spoon fall through to the placeholder until art lands. The
filename is derived by prefixing the *base sprite filename config already
gives*, so no literal piece name appears in the presentation layer (the leak
test holds). Only the board's live tiles use `getSpriteForPiece`; HUD/objective
icons still call `getSpriteForMatchType` (they show a matchType, never a
striped piece).

**An earlier draft drew a translucent directional stripe overlay** (horizontal
bars for a row-clearer, vertical for a column-clearer) over the base sprite, as
a general marker that worked for all six types before any dedicated art
existed. It was removed once real striped art landed: the art bakes its own
stripes in (a horizontal-striped, sparkled tomato/lemon), so an overlay would
double them, and the provided art is one-per-type rather than per-direction.
Consequence worth knowing: **row vs. column direction is no longer shown
visually** — the dedicated art is non-directional and the placeholder is a
plain label. The direction is still tracked and enforced in the engine; if
surfacing it to the player matters, it needs either per-direction art
(`striped_tomato_row` / `_col`) or a reintroduced subtle indicator. Flagged,
not decided.

## Color bombs: the second special piece (spawn on 5, detonate on swap)

The second special piece tier. A run of **exactly 5** (row or column) converts
one of its cells into a `type: 'color_bomb'` piece. Unlike the striped piece,
which is triggered by *being included in a later match*, a color bomb is
triggered by **being swapped with any other piece** — and that swap detonates
every piece on the board sharing the *other* piece's `matchType`. Scoped
deliberately to straight 5-in-a-line only this session; L/T-shape triggers
(intersecting runs at a shared point) are real genre content but add real
complexity and are deferred (see `DEFERRED_COMPLEXITY.md`).

**Why the activation path is genuinely different from striped, not an extension
of it.** A striped piece resolves entirely inside `resolveCascades` /
`resolveMatchEffects` — its trigger *is* an ordinary match. A color bomb can't
work that way: it's colorless (carries no `matchType`, so `matrix.ts`'s
`piecesMatch` excludes it exactly like a blocker) and it fires on a swap that
**forms no ordinary match at all**. So the whole feature splits across two
places: `resolveMatchEffects` only *spawns* the bomb (a `cells.length === 5`
branch, mirroring the `=== 4` striped branch, both feeding the same in-place
anchor conversion in `resolveCascades`), while *activation* lives in `applyMove`
as a distinct branch that runs **before** the no-match snap-back check. That
ordering is the crux: `applyMove` currently validates a normal swap by calling
`swapPieces` + `checkMatches` and snapping back (no move spent) if there's no
resulting match — a color bomb swap has to bypass exactly that, because it's
always a legal, committed move precisely for *not* relying on a run. Blockers
are still rejected first, above the bomb branch, so a bomb-with-blocker swap
snaps back (a blocker is never a valid detonation partner), matching the same
exclusion `hasLegalMoves` makes.

**`hasLegalMoves` had to learn the bomb is always a move.** Because a bomb swap
never forms a run, the old "swap then checkMatches" probe would report a board
whose only move is a bomb swap as *stuck* and shuffle it out from under the
player. `hasLegalMoves` now short-circuits any candidate pair where either cell
is a color bomb to `true` (still excluding blocker partners). This matters for
the same mid-play stuck-board rescue path the striped/blocker work already fed.

**Swapped with another color bomb → clear the whole board.** The design rule
("clear every piece matching the *other* piece's matchType") is undefined when
the other piece is itself a colorless bomb. Confirmed with the architect: two
bombs clear **every non-blocker piece on the board** — the genre-standard, and
the rarest, most set-up-intensive payoff (a player must build and hold two
separate 5-matches), which fits this project's skill-earned-reward design
principle. `resolveColorBomb` keys this off `other.type === 'color_bomb'`.

**One clearing rule for blockers, everywhere — including a full-board
detonation.** Explicitly confirmed as a consistency requirement: a color bomb
(single-type *or* whole-board) never force-clears a blocker. The clear set is
built from non-blocker pieces only; blockers then take normal **adjacent
damage** through the same `applyAdjacentDamage` call every other mechanism uses,
which caps at one hit per call. So a two-hit pot lid caught in a detonation
loses exactly one hit and survives with one remaining — identical to being
caught in a striped sweep or beside a 3-match. `gameState.test.ts`'s
whole-board-detonation blocker test proves this end to end.

**Mechanics, mirroring the striped entry above:**
- **Spawn:** anchor is `positions[0]` of the 5-run, converted **in place**
  (keeps its `id` so the presentation diff sees a piece that stayed put, not a
  spawn), but **drops** `matchType`/`direction` — a bomb is colorless. A 5-run
  therefore credits **4** toward objectives (the anchor became the bomb, it
  wasn't cleared), and the detonation pays out later.
- **Activation (`resolveColorBomb`):** neither cell is physically swapped first
  — both the bomb and its partner clear regardless, so the swap is cosmetically
  irrelevant. It clears the bomb + all matching (or all non-blocker, for
  two-bomb) cells, applies adjacent damage, counts every cleared cell by
  `matchType` (the bomb itself counts as `'unknown'`), refills, then hands the
  refilled board to the ordinary `resolveCascades` so any chain matches the
  refill creates still cascade normally. Returns the exact same
  `{ board, cascadeCount, clearedByMatchType, steps }` shape `resolveCascades`
  does, so `applyMove` treats both move kinds identically from there on.
- **A bomb caught in *another* effect just clears, it doesn't fire.** A striped
  sweep or another detonation that happens to clear a bomb's cell removes it
  without recursively detonating — same "chaining is deferred" scope decision
  the striped sweep already made.

**Rendering: fixed placeholder filename with the standard fallback.**
`components/spriteMap.ts`'s `getSpriteForPiece` special-cases
`type === 'color_bomb'` to a single fixed `'color_bomb'` sprite key (an engine
piece-type name, not a skin flavor — the leak test holds exactly as it does for
the `striped_` branch). Note this key has **no `.webp` extension**, unlike every
other registry key (which is a config.json filename): the `spriteRegistry.ts`
entry must therefore be keyed by the bare `'color_bomb'` string
(`getSpriteForPiece`'s return value, which is what `resolveSpriteAsset` looks
up), with the real `./sprites/color_bomb.webp` file only on the `require()`
side. Real dedicated art (`color_bomb.webp` — a glowing potion bottle) has since
landed via exactly that one registry line, zero code changes; before it, the
lookup missed and fell through to the same `spriteLabel` "CO" text-label
placeholder every un-arted piece uses. The bomb-on-the-board state was verified
live — see `docs/verification/color-bomb/`.

**Two sprite lookup paths, not one — and both must go through `getSpriteForPiece`.**
The paragraph above describes only how a *live* board tile resolves its sprite.
There is a second path that is easy to forget: a *clearing* tile. `Board.tsx`
draws live tiles (`gameState.board`) and exiting/clearing tiles (`ExitingTile`,
one per `diffBoards` cleared piece) as **separate** render branches, each with
its own sprite lookup. Both must resolve through `getSpriteForPiece(piece)` (which
reads the piece's `type`), *not* `getSpriteForMatchType(matchType)` (which reads
`matchType` alone). This matters specifically because the color bomb is the first
and only clearable piece with **no `matchType`**: a `matchType`-only lookup on a
detonating bomb resolves to `undefined` → `spriteLabel(undefined)` → the **"?"**
placeholder, so the bomb's icon turned into a "?" the instant it detonated even
though it rendered fine sitting still. (A swept striped piece keeps its base
`matchType`, so it didn't "?" — but a `matchType`-only lookup dropped its stripe
overlay, degrading it to the plain base sprite mid-sweep.) The exiting-tile path
was written in Phase 5, when every clearable piece had a `matchType`, and wasn't
reconciled with the later color bomb until this bug — the classic "two
independently-correct systems that were never checked against each other once
they interact." Fix: `ExitingEntry` carries the cleared piece's full `pieceType`
and the exit tile resolves via `getSpriteForPiece`, exactly like a live tile. The
entry construction (`buildExitingEntry`) and the exit-sprite lookup
(`exitingTileSprite`) were pulled out of `Board.tsx`'s inline JSX into a shared
`components/exitingTile.ts` so the data flow is a single source of truth, unit-
tested in `exitingTile.test.ts` — a regression guard asserting a color bomb and a
striped piece both thread their full `type` through and resolve to their real
sprite (`color_bomb` / `striped_tomato.webp`), never the matchType-only "?" or
plain-base result a revert would reintroduce. The transient mid-clear frame (the
beat the settled-board capture above never looked at) is also verified live for
both a detonating bomb and a swept striped piece — see
`docs/verification/exiting-tile-special-sprites/`.

**Deliberate scope limits (see `DEFERRED_COMPLEXITY.md`):** only exactly-5
straight runs spawn a bomb (6+ still clears normally); L/T-shape triggers and
sweep chaining are still deferred. The bomb+striped combo that was listed here is
now built — see the special-piece combos entry below.

## Special-piece combos: striped+striped (cross) and striped+bomb (supercombo)

The payoff of having both special pieces: swapping two special pieces directly
into each other triggers a combined effect immediately, on the swap itself,
rather than either piece waiting to be included in a later ordinary match. Two
combos were built.

- **striped + striped → a full cross.** Both sweeps fire at once, clearing the
  entire row AND entire column through the swap (`resolveStripedCross`). The cross
  is centered on `posA`; `posB` is its adjacent swap partner and lies on one of
  the two lines. The combo overrides each piece's individual direction — two
  stripeds always make a cross, even if both were row-clearers — matching the
  genre.
- **striped + color bomb → a supercombo.** Every non-blocker piece sharing the
  striped piece's matchType is converted to a striped piece and fired at once
  (`resolveStripedBombCombo`). Because a converted striped piece's only effect is
  to sweep its line, the settled result is exactly the union of those sweeps,
  which is computed directly (the same way `resolveColorBomb` computes its clear
  set without staging the physical swap). Directions alternate row/col by
  discovery order, so the effect clears both full rows and full columns. The
  intermediate "everything flashes striped" frame is presentation polish, deferred
  (see `DEFERRED_COMPLEXITY.md`).

**Both bypass the snap-back, like the solo bomb.** A combo swap doesn't rely on
forming a run, so it's always a legal, committed move — the same architectural
bypass the color bomb already established (see the color-bomb entry). `applyMove`
routes both combos through the same `resolveClearSet` tail every swap-triggered
effect uses (blocker adjacent-damage, matchType counting, gap + refill, hand off
to `resolveCascades` for chains), so nothing about objective crediting, cascade
chaining, or the terminal-state machinery is special-cased for combos.

**Branch precedence in `applyMove` is load-bearing.** The order is: (1)
striped+bomb, (2) striped+striped, (3) solo color bomb, (4) ordinary swap. (1)
MUST precede (3): a striped+bomb swap is also "bomb-involving," and a striped
piece carries a matchType, so `resolveColorBomb` would accept it as an ordinary
detonation partner and silently run the WEAKER single-type clear instead of the
supercombo — checking it first is the only thing that guarantees the stronger
effect. (2) MUST precede (4): two stripeds don't necessarily form a run, so the
ordinary branch would snap them back instead of comboing.

**`hasLegalMoves` extended the same way.** A striped+striped pair is always legal
(the cross fires on the swap, no run required), so a board whose only move is a
striped+striped combo isn't wrongly judged stuck and shuffled. A striped+bomb
pair was already legal via the existing color-bomb clause (the bomb makes any
swap involving it legal), so both combos are covered.

**Blocker consistency holds.** Both combos build their clear set from non-blocker
cells only; a blocker caught in a cross or a supercombo takes normal one-hit
adjacent damage through the same `applyAdjacentDamage` call, never a force-clear —
the one blocker rule shared by every clearing mechanism in the game.
`gameState.test.ts`'s two combo-blocker tests prove a two-hit blocker survives
with one hit remaining in each combo.

**Shared geometry, one source.** The striped line sweep (whole row or whole
column) is factored into `sweepLinePositions`, used by both the in-match sweep
(`resolveMatchEffects`) and both combos, so the line geometry has one definition.

Both combos verified live — see `docs/verification/special-piece-combos/` for the
before → fire → after filmstrip of each.

**Deliberate scope limits (see `DEFERRED_COMPLEXITY.md`):** sweep chaining (a
special piece caught in a combo's clear just clears, it doesn't recursively fire),
the bomb+bomb whole-board clear is unchanged (not a "combo" in this sense), and
the intermediate convert-to-striped animation frame for the supercombo are all
deferred; the combos are correct at the settled-board level, which is what the
engine and objectives care about.
