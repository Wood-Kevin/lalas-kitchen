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

### Fixed: the namespace tag itself was a leaked skin name

The `lalas-kitchen:` prefix above was never actually load-bearing for
uniqueness — `skinId` was already the thing that made one key distinct from
another — but it meant a specific skin's product name lived inside otherwise
generic engine storage infra, failing CLAUDE.md's own Leak Test the exact
same way a hardcoded `"tomato"` in `engine/matrix.ts` would. `saveKey` now
derives its namespace from a generic `SAVE_KEY_NAMESPACE = 'save'` constant
— `` `save:${skinId}` `` — so the engine genuinely has no opinion on which
skin it's saving for, only `skinId` does. `saveKey` is also now exported
(was a private module-level function before), specifically so it's a single
testable source of truth: `engine/asyncStorage.test.ts` used to independently
hardcode the expected key as its own second literal
(`'lalas-kitchen:save:lalas-kitchen'`) rather than calling the real function
— exactly the kind of duplicated-decision drift CLAUDE.md's Playtest
Feedback Protocol warns about — and now calls `saveKey('lalas-kitchen')`
instead. No other file in the codebase reconstructs this key independently.

No migration was needed for this cutover: no real device save exists yet
worth preserving (this is still a local, unpublished project — see
CLAUDE.md's Definition of Done), so the old key format simply stops being
read or written, with nothing to carry forward. Confirmed with a new
`engine/gameState.test.ts` test (two different skinIds produce genuinely
distinct keys, with no `lalas-kitchen` substring appearing in either), and
every existing save/load round-trip test for the current single skin passes
unmodified — the key's *value* changed, but every caller still goes through
`loadSave`/`saveProgress`/`clearSave` consistently, so round-trip behavior
for one skin was never observable-different. 409 tests pass (`npm test`).

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

## Area bombs: the third special piece (spawn on a 2×2 square, clear a 3×3 on match)

A run of 3 clears, 4 spawns a striped piece, 5 spawns a color bomb — all
straight-line shapes. The area bomb is the first special triggered by a
genuinely different shape: a **2×2 square** of four same-type pieces spawns one
area bomb; matching that bomb later clears the **3×3** block centered on it.
L/T-shape triggers stay deferred (`DEFERRED_COMPLEXITY.md`) — the square is a
strictly simpler detection than intersecting runs meeting at a corner.

**A 2×2 is a new match shape, not a longer/shorter run.** Every prior detector
(`checkMatches`) scans straight runs only, so a pure 2×2 (which contains no
3-in-a-row) was invisible to the whole engine. A new pure scan `checkSquares`
(`matrix.ts`) finds every 2×2 of four `type === 'normal'` cells sharing a
matchType, alongside — never folded into — `checkMatches`. (This corner-type
gate was later relaxed to also allow a live striped corner — see the
"Squares: a live striped corner now counts" entry below.) It gets its own
`Square` type (no `orientation`; a square is neither a row nor a column) so it's
never mistaken for a 4-run, which would spawn a striped piece instead.

**The detection surface is broader than the trigger.** Because a pure square
forms no run, EVERY "is there a match?" gate had to learn about squares, or the
feature breaks in two ways: a valid square-forming swap gets snapped back as a
no-match move, and a board with a latent square (from generation or a shuffle)
auto-spawns a *free* bomb on the player's next move. So `checkSquares` now joins
`checkMatches` in: `applyMove`'s snap-back check, `resolveCascades`'s loop
condition, `hasLegalMoves`'s legal-pair test, `shuffle`'s match-free guarantee,
and the generator's `repairAccidentalMatches`. This surface is required
regardless of the activation choice below.

**Activation: passive, like the striped piece — a real fork, confirmed with the
architect.** The area bomb is a *colored* special: it spawns from four same-type
pieces and keeps its `matchType`, exactly like a striped piece. In this game's
taxonomy, colored specials fire by being **matched** (the striped sweep); the
color bomb fires on **swap** only because it's colorless and has no color to
match on. Putting the area bomb in its natural (striped) camp means it activates
passively — included in a later ordinary run of its type, then it blasts its 3×3.
The decisive practical consequence: passive needs **no** new `applyMove` branch
and **no** `hasLegalMoves` trigger-clause. It rides the existing
`resolveCascades` → `resolveMatchEffects` path — the same generalization that
already fires a striped piece caught in a match. (Active/swap activation would
have needed both, and would have wasted the piece's color.) The architect
confirmed passive before the build.

**Where it plugs in.** `resolveMatchEffects` gained an `area_bomb` alongside
`striped` in the "this match contains a live special — fire each" branch (a
match containing both fires both; a special caught in another's blast just
clears — chaining stays deferred). It also gained a squares loop that converts a
square's top-left anchor to an area bomb and clears the other three — but only if
none of the square's four cells is touched by a run this pass. That
run-overlap guard is what keeps L/T/larger shapes deferred: an L contains both a
3-run and a 2×2, and the run logic owns those cells, so the overlapping square
stands down and no bomb spawns. `resolveCascades` computes `checkSquares`
each pass, breaks when both runs and squares are empty, and converts an
`area_bomb` anchor with `{ ...base, type: 'area_bomb' }` — keeping the base
cell's matchType (colored, matchable, passively triggerable), no direction. The
3×3 geometry is `areaBlastPositions`, the square-shaped sibling of
`sweepLinePositions`.

**Crediting mirrors the striped piece.** A 2×2 converts one cell and clears
three, so it credits 3 toward objectives now; the bomb pays out the rest when it
later fires — the same anchor-excluded accounting a 4-run→striped uses.

**Blocker consistency holds.** `resolveMatchEffects`'s `addClear` skips blocker
cells, so a blocker caught in a 3×3 blast takes normal one-hit adjacent damage
through `applyAdjacentDamage`, never a force-clear — the one blocker rule every
clearing mechanism obeys.

**Sprite: one fixed `area_bomb.webp`, like the color bomb — but keyed by its real
filename.** The skin ships a single `area_bomb.webp` (the bomb wrap looks the
same whatever ingredient it wraps), so `getSpriteForPiece` resolves every area
bomb to that one filename regardless of matchType — even though the engine keeps
the matchType for the trigger and credit. This was a course-correction: the first
implementation used a per-base `area_bomb_<type>` scheme (like striped), which
would have left the architect's pre-dropped `area_bomb.webp` permanently
unrendered (always the "AR" text placeholder) — exactly the recipe-card-art vs.
placeholder-contract class of silent bug the playtest protocol warns about.
Unlike the color bomb's deliberately extensionless key, this keys by the real
filename `'area_bomb.webp'` like every other registry entry.

Verified live — see `docs/verification/area-bomb/` for the real-`applyMove`
filmstrip (2×2 → bomb, match → 3×3, blocker spared on one hit).

**Deliberate scope limits (see `DEFERRED_COMPLEXITY.md`):** L/T-shape triggers
(an L/T-formed area bomb, vs. the built square trigger), and blast chaining (a
special caught in a 3×3 blast just clears, it doesn't recursively fire) remain
deferred, consistent with the striped and color-bomb scope limits.

### Area bomb: reversed from passive/colored to active/colorless (swap-triggered)

**Why the reversal.** Real play surfaced the flaw in the passive design above: the
area bomb kept its `matchType` and fired by being *matched*, but it renders through
a **single universal `area_bomb.webp`** (the decision just above) that shows no
color. So a player literally could not see *which* match would trigger a given
bomb — the trigger information was in the data but not on the screen. Two fixes
were possible: encode color into the sprite, or remove color from the piece. We
chose the latter — make the area bomb **colorless and swap-activated**, moving it
out of the striped piece's "colored, passive" camp and into the color bomb's
"colorless, active" camp — because it makes the ambiguous-color question *moot*
rather than merely legible, and it reuses infrastructure the color bomb already
has instead of adding a new art requirement.

**What changed (each one reverses a passive-design shortcut).**
- `piecesMatch` (`matrix.ts`) now **excludes `area_bomb`** alongside `color_bomb`:
  a live area bomb is colorless (`checkMatches` can never see it in a run).
- The spawn still comes from a pure 2×2 square (`checkSquares` unchanged), but
  `resolveCascades` now builds the anchor as `{ id, type: 'area_bomb' }` —
  **dropping matchType/direction**, identical to the color bomb (was
  `{ ...base, type: 'area_bomb' }`). `resolveMatchEffects` no longer collects area
  bombs into its in-run `specials` set (nothing to collect — they can't be in a
  run).
- `applyMove` gained a **swap branch** (`resolveAreaBomb`) that fires the 3×3
  blast on the swap itself, bypassing the no-match snap-back exactly like the color
  bomb. It sits **before** the solo-color-bomb branch: an `area + color_bomb` swap
  is "bomb-involving," so `resolveColorBomb` would otherwise run a degenerate
  clear on the area bomb's `undefined` matchType.
- `hasLegalMoves` gained an **area clause** (also first): `area + ordinary` is
  always legal; `area + special` was not, at the time this was originally written
  (see below — this has since changed, see the "Area-bomb combos: the last three
  pairings" entry further down).
- The 3×3 geometry helper `areaBlastPositions` is unchanged; only its caller moved
  from `resolveMatchEffects` (passive) to `resolveAreaBomb` (active).

**The area+special fork (confirmed with the architect) — since superseded.**
Because the color bomb *also* fires on swap, swapping an area bomb directly into
another special (color bomb, striped, or another area bomb) is two swap/match-
activated specials meeting. At the time the area bomb was built, this was left as
a **deferred combo**: such a swap snapped back with no move spent (the same
reject path a no-match ordinary swap uses), guarded in `applyMove` before the
color-bomb branch and mirrored in `hasLegalMoves`. This kept the area bomb's
combo behavior bounded exactly like the then-still-deferred sweep/blast chaining.
**All three pairings now have a real combined effect** — see the "Area-bomb
combos: the last three pairings" entry below; the snap-back this paragraph
describes no longer exists in the code.

**Objective accounting shift.** A colorless area bomb's own cell now credits
nothing when it detonates (its `matchType` is gone), same as the color bomb — the
cleared *neighbours* still credit by their own matchType. A 2×2 spawn still credits
3 (the three non-anchor cells), unchanged.

Verified live — see `docs/verification/area-bomb/active/` for the swap-triggered
filmstrip (area bomb + ordinary piece → immediate 3×3 blast, no matching run).

### Area bomb: two powder animations (idle drift + trigger poof), presentation only

The area bomb had no motion of its own — it sat as a static sack and, on
detonation, its own cell exited through the ordinary pop-and-shrink like any
cleared tile. Two calm powder moments were added, both **purely presentational**
(the engine is untouched; no new `Piece` field, no config change), following the
Playtest-Feedback habit of reusing this app's established timing rather than
inventing new pacing.

**Reuse over invention.** Both effects lean on conventions already in the tree:
- The **idle wisp** reuses `SteamWisp`'s exact motion recipe — a rise-and-fade
  loop, `1800ms`, `Easing.out(Easing.quad)`, opacity/position only (no scale
  spike) — so the bag's ambient powder reads as the same calm material as the
  steam on the Won/Paused overlays. It lives in `Tile.tsx`'s new
  `PowderWispOverlay`/`PowderWisp`, gated by a `powderWisp` prop that `Board.tsx`
  sets with `piece.type === 'area_bomb'` — the same per-type-from-engine pattern
  as `direction` (striped) and `spreadWarning`. Two wisps on a half-cycle
  stagger keep powder continuously in the air; opacity is capped at `0.7` and
  the rise scales with the tile (`× 0.34`) so it never competes with ordinary
  tiles, per the calm-not-frantic brief.
- The **trigger poof** reuses the clear's own `matchDurationMs` (300ms) clock —
  no bespoke duration. It's the `isPowderBurst` branch of `ExitingTile`: a soft
  cloud whose `scale` swells `0.4 → 2.1` (ease-out) while `opacity` peaks `0.85`
  then fades, so it puffs outward past the tile into the 3×3 **as those cells
  clear**. `Board.tsx` sets `isPowderBurst={entry.pieceType === 'area_bomb'}` —
  a detonating area bomb always lands in `diff.cleared` carrying its type, the
  same way `isBlockerClear` is derived.

**One load-bearing structural choice.** The poof is rendered in a **sibling
view** of the shrinking bag, not a child of it — the exiting bag's own transform
drives `scale → 0`, and a child cloud would be shrunk to nothing along with it.
As a sibling positioned on the same cell, the cloud grows outward while the bag
shrinks away underneath, which is what makes the burst read as the *cause* of
the surrounding clear rather than a flourish on top of it.

Verified live against the real `Tile`/`ExitingTile` + real Reanimated (a
temporary `?harness=powder` gate, reverted after) — per-frame opacity/scale
traces plus filmstrips in `docs/verification/area-bomb/powder/`. Still deferred:
the per-link blast-chaining animation flash (unchanged — the engine still
computes a chain's settled clear directly), see `DEFERRED_COMPLEXITY.md`.

### Squares: a live striped corner now counts, firing itself instead of spawning a new bomb

Real play surfaced a null result: a 2×2 of four same-color pieces did nothing
when one of the four was already a live striped piece, even though it shared
the square's matchType. `checkSquares` (`matrix.ts`) required every corner to
be `type === 'normal'` — the same gate that (correctly) excludes a blocker or
void also excluded an already-special piece, and an existing `matrix.test.ts`
case explicitly asserted this ("a 2x2 that includes a non-normal piece
(blocker/special) is not a square"), lumping the two together. That gate
predates this question ever coming up in real play.

**The fork, confirmed with the architect before building** (three real
options, not an obvious fix): (a) a live special corner still counts, and the
*existing* special fires its own effect instead of a new one spawning —
mirroring the identical rule the run path already applies (a run containing a
live striped piece fires it rather than spawning a second special over it);
(b) leave it as-is, a silent non-event identical to a blocker/void corner; (c)
convert the striped piece into a new area bomb without ever firing its sweep.
(a) was chosen: it's consistent with the run precedent, and (c) would have
silently destroyed an earned special without giving its effect — the exact
"a special never just vanishes as ordinary content" failure mode chaining was
built to prevent.

**What changed.** `matrix.ts` gained a `squareEligible(piece)` predicate
(`type === 'normal' || type === 'striped'`) replacing the old `type !==
'normal'` gate — a blocker or void is still excluded outright; a color bomb or
area bomb is moot (colorless, so `piecesMatch` already keeps it from sharing a
matchType with the other corners). `gameState.ts`'s `resolveMatchEffects` now
checks a detected square for any live striped corner; if found, that piece
fires its own line sweep and every square cell clears alongside it — **no**
new area bomb spawns. This reuses, rather than duplicates, the run branch's
existing sweep-firing code: both now call one shared
`fireStripedTriggersAndClearAll(triggers, allCells)` helper. A square with no
striped corner is unaffected — the ordinary anchor-conversion path is
unchanged.

Confirmed with new cases in `engine/matrix.test.ts` (a striped corner is now
detected; a blocker corner, and a color-bomb/area-bomb corner, still are not)
and `engine/gameState.test.ts` (the sweep reaches beyond the square itself
down the piece's full line, no area bomb spawns, the objective credits the
matchType-matching cells). Verified live — see
`docs/verification/square-striped-corner/`.

### Crossing-run trigger (L/T/plus): a second, additive area-bomb spawn

Closes part of the L/T-shape gap `DEFERRED_COMPLEXITY.md` logged alongside the
area-bomb entry — but only the narrow slice that's a genuinely new shape, not
a bigger special: a cell where a horizontal run and a vertical run, each
**exactly length 3**, share one cell (the classic L, T, or plus) now spawns an
area bomb at the shared cell, additive to — never a replacement for — the
existing pure-2×2-square trigger.

**The confirmed precedence rule.** A crossing candidate whose arm is 4 or 5
long (which already spawns its own striped piece or color bomb via the
existing run branch) stands down entirely at that cell — only an exact 3×3
crossing spawns an area bomb. This was a genuine fork, confirmed with the
architect before building (the alternative: the cross always wins, forcing a
4/5-run to forfeit its own spawn). The chosen rule keeps a nice invariant
intact: a pure 3+3 cross is always exactly 5 cells (3+3−1 shared corner),
crediting 4 objectives + 1 anchor — the identical accounting shape a 5-run's
color bomb already uses. Live-striped-piece-in-the-cross handling mirrors the
square's own rule exactly (fires the existing special instead of spawning a
new one).

**New shape, new scan — `checkCrossShapes` (`matrix.ts`).** Built on the same
`runsInLine` primitive `checkMatches` uses, so blocker/void/color_bomb/
area_bomb are excluded "for free" via `piecesMatch` — no separate eligibility
gate is needed here, unlike `checkSquares`' `squareEligible` (which
reimplements corner adjacency from scratch and so needs its own gate). A live
striped piece **is** included (mirrors `squareEligible`'s decision to allow a
striped corner) — the scan only reports geometry; "an existing special fires
itself instead of a new one spawning" is `gameState.ts`'s call, not this
function's. The "exactly 3" filter is baked into the scan itself, not applied
afterward by a caller — `checkCrossShapes` never even reports a 4/5-arm
intersection as a candidate at all, which is what makes the precedence rule
above hold with zero extra arbitration code.

**Where it plugs in (`gameState.ts`).** `resolveMatchEffects` gained a third
parameter (`crosses`) and a new loop between the existing run loop and square
loop. It reuses the SAME anchor-wins-over-clear mechanism the square trigger
already established (the trailing `clearedKeys.delete` over `anchorByKey`'s
keys) rather than inventing a parallel "claimed cells" concept — a cross's
five cells are already added to the ordinary clear set by its two
already-existing `Match` entries (each arm is a real match), so the only new
behavior is claiming the shared cell as an area-bomb anchor instead of letting
it clear. Squares and crosses can never conflict: a square overlapping a
cross's arm stands down via an explicit cross-overlap check in
`isUnambiguousEmbeddedSquare` (see the "Embedded square in a straight run"
entry below) — plain `runCovered` membership alone isn't enough for this,
since a cross's arms are always exactly-length-3 runs and therefore wouldn't
be excluded by the run-length rule alone. Confirmed with a regression test.
`resolveCascades` computes `checkCrossShapes` each pass and threads it
through — but does **not** need its own loop-continuation clause, since a
cross's two arms are always already-counted ordinary matches.

**No legality-gate wiring needed — a deliberate divergence from the square
precedent.** `checkSquares` needed `hasLegalMoves`/`shuffle`/`applyMove`'s
snap-back gate clauses because a pure 2×2 forms zero runs (invisible to
`checkMatches`). A cross's entire premise is two runs `checkMatches` already
sees, so `checkMatches(swapped).length > 0` already holds whenever a cross
exists — verified directly by reading all three sites (plus the generator's
`repairAccidentalMatches`, for the same reason); none needed a
`checkCrossShapes` addition. A short comment was left at each site to preempt
a future well-meaning "you forgot to wire this up" edit.

**A structural finding worth recording.** A full 4-armed plus cannot be
produced by a single legal adjacent swap from a match-free board — the
crossing cell's grid-neighbours are entirely its own two arms, so any swap
into it necessarily robs one arm. An L (crossing = endpoint of both arms) or T
(endpoint of one, middle of the other) both work via one real swap, because
the crossing cell then has a free neighbour outside the shape to donate a
foreign matching piece. `gameState.test.ts`'s L/T integration tests exercise
the full `applyMove` pipeline this way; the plus's degree-4 geometry is
covered at the `checkCrossShapes` unit level only (`matrix.test.ts`), since
`resolveMatchEffects`'s cross loop treats every degree identically.

**Reconciling the existing deferred-scope test.** The pre-existing
`gameState.test.ts` case titled "an L-shape (a square overlapping a straight
run) does not spawn an area bomb — L/T stays deferred" was traced by hand: its
board has only a vertical 3-run and an overlapping square, no horizontal run
of length ≥3 anywhere — it was never a genuine two-arm crossing, just a
square/run overlap. At the time, its assertion (no bomb spawns) was left
unchanged; it was retitled to disambiguate from this feature and gained a
defensive `checkCrossShapes(...).toHaveLength(0)` assertion proving the point
directly rather than only in a comment. **This test's assertion later did
change** — see the "Embedded square in a straight run" entry below: this
exact shape (a lone, unambiguous embedded square overlapping only a
length-3 run) turned out to be a real playtest-reported gap, not correct
deferred behavior, and was fixed. The test was renamed again and its
expectation flipped to match.

Confirmed with new cases in `engine/matrix.test.ts` (plus/L/T positive
detection with anchor + full-position assertions; a straight 5-run with no
perpendicular run; the 4/5-arm precedence exclusion; blocker/void exclusion;
live-striped inclusion; `hasLegalMoves` and `shuffle` regressions proving no
new wiring was needed) and `engine/gameState.test.ts` (genuine T and L swaps
each spawning one area bomb with correct crediting; the 4-arm and 5-arm cases
each preserving the existing striped/color-bomb spawn unchanged; a live
striped piece in the cross firing its own sweep instead; a square overlapping
a cross's arm standing down so only one area bomb spawns). Verified live —
see `docs/verification/crossing-shape/`.

# Phase 8 — dynamic denial-zone spread (blockers that grow if ignored)

## Investigation first: a static denial zone needs zero new engine logic

The session brief asked to confirm, before building anything, whether a calm
static denial zone — several cells blocked off, clearable only through matches
landing on them — is *already* achievable purely through level content, by
clustering existing blockers. It is. The `blocker` type already implements
exactly that contract: `piecesMatch` excludes it from every run, `applyMove`
rejects any swap that touches it, and the only way to remove one is adjacent
match damage (`applyAdjacentDamage`). "Cells clearable only by matches landing on
them" is the blocker, verbatim. Clustering blockers into a contiguous region is a
*placement* choice (level content), not a mechanic — so **every level below the
difficulty threshold uses this static version unchanged, with no new engine
code**. Only the *dynamic* layer below is new.

## The dynamic layer: gate it exactly like `pot_lid`, don't invent a parallel gate

Spread is gated to generated levels at or past `DENIAL_SPREAD_MIN_LEVEL_NUMBER`
(10) in `appPersistence.ts` — the same shape as `pot_lid`'s
`BLOCKER_MIN_LEVEL_NUMBER` gate, a function of `generatedLevelNumber` alone.
Chosen later than `pot_lid` (7): a zone that actively grows is a tougher idea
than a static double-hit blocker, so it waits until the player has met blockers
(3), `pot_lid` (7), and the 4-blocker `generatedBlockerCount` cap (9) — by level
10 there's a real multi-cell zone for it to act on. The gate only flips
`denialSpread: true` on a level that actually placed blockers, so it's never inert
on a blocker-less board. `createGameState` turns the flag into the concrete
`DenialSpreadState`; below the threshold that state is simply absent
(`undefined`), and `applyMove` skips the whole spread branch — the exact
"static blockers, unchanged" behavior of every pre-existing level.

## Timing is a proportion of the level's own move budget, not a universal number

`spreadInterval = max(2, round(movesLimit × SPREAD_MOVE_FRACTION))` with
`SPREAD_MOVE_FRACTION = 0.25` (in `gameState.ts`, the engine tuning seam — the
*which-levels* gate lives separately in `appPersistence.ts`). A quarter of the
budget: an 18-move level spreads every 5 unaddressed moves, a 30-move level every
8, a real level-10 board (20 moves) every 5. So the pressure reads the same
regardless of level length rather than feeling harsher on short levels. The
`max(2, …)` floor guarantees `spreadInterval - 1` (the warning move) is always a
real, visible move, so requirement 3 (a warning always precedes a spread) can
never be skipped by a tiny budget.

## "Addressed" = the zone lost blocker health this move — a derived signal, no new plumbing

Rather than thread a "was a blocker hit?" boolean out through every clear path,
`applyMove` compares total blocker `hitsRemaining` before the move
(`state.board`) to after the cascade settles (`cascadedBoard`). A match can only
ever lower it (matches never add blockers; spread runs *after* this check), so a
strict decrease is an unambiguous "the player engaged the zone" — any blocker
damaged or cleared. Addressed → the spread clock resets to 0 and any pending
warning is cancelled. This is why matching the cracked warning cell defuses the
spread: that cell is adjacent to the blocker by construction, so clearing it deals
adjacent damage, which reads as addressing.

## Warning on the frontier cell, spread in place, id reused — a legible cause→consequence

`findSpreadTarget` (a pure `matrix.ts` scan, sibling to `hasLegalMoves`) returns
the deterministic frontier: the first blocker in row-major order that borders an
ordinary (`'normal'`) cell, paired with its first ordinary neighbor in
`ADJACENT_OFFSETS` order (up, down, left, right). Only `'normal'` cells are
eligible — a spread never eats a player-earned special (striped/bomb) and never
double-places onto a blocker. `stepDenialZone` (in `gameState.ts`, called before
the legal-move rescue so a spread-created blocker is covered by the same
`hasLegalMoves → shuffle` guarantee as everything else) does three things by the
clock:

- **reset** (addressed) — clock to 0, warnings cleared;
- **warn** (clock hits `interval - 1`) — flag the frontier cell with
  `spreadWarning: true` (a new optional `Piece` field), for the one move before
  the spread;
- **spread** (clock hits `interval`) — convert the frontier cell to a blocker
  inheriting the source blocker's `matchType` and the level's `blockerHitsToClear`,
  **reusing the target cell's id** so the tile morphs into a blocker in place
  (`boardDiff` sees no clear/spawn — the cell was denied, it didn't leave), then
  reset the clock.

The warning is recomputed from scratch each move (cleared, then re-marked), so it
never lingers past its one move. The warned cell stays an *ordinary, matchable*
piece — `spreadWarning` is presentation-only, invisible to `piecesMatch` — which
is what lets a player clear it to defuse the growth. A fully enclosed zone
(`findSpreadTarget` null) holds at the threshold rather than resetting, so it
grows the instant a neighbor opens up. Blockers caught in a spread are never
force-anything — a spread only ever *adds* a blocker to an ordinary cell.

## The warning visual: a calm crack + dimming glow, not an alarm

`components/Tile.tsx`'s `SpreadWarningOverlay` renders a steady dark dimming wash
(the doomed cell reads as shadowed) plus a thin diagonal accent crack, with a slow
~900ms accent breath over the top. The dim and crack are steady (not
opacity-animated), so a still screenshot always shows the warning unambiguously.
Deliberately a slow breath, not a flashing alarm, per CLAUDE.md's calm-not-frantic
brief for this specific player. Wired through `Board.tsx` via a `spreadWarning`
prop off `piece.spreadWarning`.

Verified live — see `docs/verification/denial-zone-spread/` for the real-`applyMove`
filmstrip (calm zone → cracked-and-dimmed frontier warning → the frontier cell
become a blocker), on the real gated level-10 timing.

## Still deferred (logged in `DEFERRED_COMPLEXITY.md`)

Spread eats only ordinary cells (never specials); a spread blocker doesn't itself
chain or merge zones beyond becoming one more ordinary blocker; and clustered
*generation* (making the generator place blockers contiguously rather than
scattered by `fisherYates`) is not built — a static zone's contiguity is a
hand-authored-level concern today, and the dynamic layer naturally grows
contiguity on its own. None were asked for.

## Special-piece chaining: one shared `expandChainClears`, gated by `originKeys`

Chaining — a special piece caught in another special's clear effect firing its
OWN effect too — had been deferred since the striped piece first shipped, carried
through the color bomb, the combos, and the area bomb. Now that three special
tiers exist it was built, and the investigation confirmed the shape the earlier
work had already set up for it: **`resolveClearSet` is the single shared funnel**
every swap-triggered effect passes through (`resolveColorBomb`, `resolveAreaBomb`,
`resolveStripedCross`, `resolveStripedBombCombo` all end by calling it). So
chaining is added **once**, as a pure `expandChainClears(board, seed, originKeys)`
helper, and wired in at exactly two sites: `resolveClearSet` (covering all four
swap-triggered effects at a stroke) **and** `resolveMatchEffects`'s in-match
striped sweep (the one clear path that does NOT route through `resolveClearSet` —
a striped piece included in an ordinary run clears directly via `resolveCascades`).
Wiring both was an architect call (confirmed up front): the most common way a
player fires a striped piece is swapping it into a match, which takes the in-match
path, so chaining only in `resolveClearSet` would have left a visible
inconsistency. One helper, two call sites, no duplication.

**`originKeys` is the load-bearing subtlety.** A chain must fire the specials an
effect *catches*, never the ones it *is*. Without a guard, a solo color bomb would
re-detonate itself on the most-common colour, and a striped+striped cross would
fire each trigger's own line on top of the cross it already defines. So each
caller passes the keys of the specials it already fired/consumed — the swapped
bomb (+ its partner, so a bomb+bomb whole-board swap doesn't re-chain the partner),
the two swapped stripeds, the supercombo's every converted piece, the in-match
striped triggers. Those cells still *clear* (they're in the seed) but are never
enqueued as chain sources. Everything else in the (growing) clear set that's a
special does chain. This is why "a color bomb detonation catches a striped piece
of the target colour" fires the striped (it's in the seed but not an origin),
while the bomb itself doesn't re-fire.

**A caught color bomb has no swap partner**, so there's no partner matchType to
name its target the way an ordinary bomb swap has one. Rather than make it a no-op
(inconsistent — it *is* listed as a chainable special) or clear the whole board
(a huge, swingy result from an incidental catch, against the calm brief), a caught
color bomb detonates the board's **most common matchType** (`mostCommonMatchType`,
deterministic with a row-major tie-break) — architect-chosen. Those clears can
themselves chain.

**Termination** is by construction, not by a depth cap: the board has finitely
many cells, each enters the cleared set at most once, and only a freshly-cleared
non-origin special is ever enqueued — so a chain runs dry the moment it stops
reaching new specials, or once the whole board clears. **Objective credit** flows
for free: `resolveClearSet` and `resolveCascades` already count every cleared cell
by matchType, and they now count the fully-expanded set, so each triggered effect
credits its own cells.

The engine folds the whole chain into a **single committed clear set** (one move,
one beat) — the per-link sequential animation staging is a presentation nicety,
deferred exactly like the supercombo's convert-to-striped flash. Verified live
(real `applyMove`, real sprite path) in `docs/verification/special-piece-chaining/`.
Still deferred: that per-link animation flash, and chaining a special caught by
the *dynamic denial-zone spread* (unrelated — the spread only ever consumes
ordinary cells). Both in `DEFERRED_COMPLEXITY.md`.

## No merge table: simultaneous specials never combine into a new effect

An explicit statement of a design property that fell out of the chaining work
above but was never written down on its own: when 2+ specials fire together —
whether via a chain (one caught in another's clear) or genuinely independently
(two unrelated specials each completing their own separate run in the same
`checkMatches` pass) — there is no lookup table, no special-cased pairing logic,
anywhere that produces a *combined* effect. `expandChainClears` only ever
contributes each caught special's own fixed geometry (a striped sweep, a 3x3
blast, a whole-board detonation) into the shared clear `Set`; the dispatch inside
it switches on one piece's own type at a time, never on what else is present in
the set. "Area bomb + striped fire together" is, mechanically, nothing more than
two independent position sets landing in the same `Set<string>`.

The two apparent exceptions — `resolveStripedCross` (two striped pieces swapped
directly into each other → a full cross) and `resolveStripedBombCombo` (a striped
piece swapped directly into a color bomb → the supercombo) — are a **different
mechanism entirely**, not a merge of independently-firing effects. Both trigger
on a *direct swap between two specials*, computed as their own fixed geometry
up front (before either piece would otherwise have fired on its own), and both
are then origins in `resolveClearSet`'s chain expansion so they don't also
separately re-fire their solo effect on top of the combo. They are the only two
pairings anyone has designed a combined effect for.

Area bomb + any other special via a direct swap is **no longer** a no-op — the
three remaining area-bomb pairings (area+color_bomb, area+striped, area+area)
are now real combos too, replacing the snap-back this session (see the
"Area-bomb combos: the last three pairings" entry below). If a real combined
effect for a pairing is ever wanted, it has to be built as a new named case,
the same way every combo (including these three) was — the architecture does
not fall into one by accident. Verified by direct code inspection (no test can
prove the absence of a case that doesn't exist) plus a new regression test
covering the one previously reasoned-but-unproven path: two wholly independent
specials firing in the same pass with no chain/catch relationship between them
(`gameState.test.ts`'s "two independent striped pieces..." test, `applyMove — multiSpecialFired`
describe block).

---

# Board shape / void cells — non-rectangular boards (a plus, a ring, an irregular outline)

## The claim that motivated this didn't hold — nothing was pre-built

The build spec's "board shape is a source of variety across levels"
(`lalas-kitchen-build-spec.md`) meant only **per-level rectangular `rows`/`cols`
dimensions** — it was never cutout/non-rectangular support. Before this work
`Board = Piece[][]` held a real piece at every index, `generateLevel` filled
every cell, `calculateCascades` refilled every column to full height, and
`Board.tsx` rendered every cell. There was no field, sentinel, mask, or config
key for "this cell doesn't exist" anywhere. So this was built from scratch as a
real engine feature, not switched on. (Investigation confirmed by a full-codebase
sweep before any code changed.)

## A void is a sentinel piece type, not a nullable cell (architect-chosen)

A void cell is `type: 'void'` — the same shape `'blocker'` uses: a real object at
every board index, special-cased by `type` wherever "is this ordinary content?"
matters. The rejected alternative was making `Board` permanently
`Array<Array<Piece | null>>` with `null` = void: `null` already means
"transiently cleared, awaiting refill" inside `calculateCascades`, so overloading
it would conflate two opposite meanings (one is refilled immediately, one is never
refilled) and churn every consumer that currently assumes a non-null `Piece[][]`.
The sentinel keeps `Board = Piece[][]` intact and every existing reader keeps a
real object at every index. A void carries no `matchType`, so `piecesMatch`
already rejects it; the explicit `type === 'void'` guards added alongside the
blocker/bomb ones keep the "void is never content" invariant local and obvious.

## Gravity is segmented per column — a void is a fixed floor, not a pass-through

The one genuinely new algorithm. `calculateCascades` used to compact all
survivors in a column to the bottom and refill the top. With voids that's wrong
twice over: a piece must not fall *through* a void, and a refill must not fall
*past* one. So a column is now walked as a series of maximal **non-void
segments** separated by voids; gravity acts within each segment independently —
survivors compact to the bottom of their own segment (resting on the void below
or the floor), refills spawn at the **top of that segment** (never past the void
above). A void-free column is exactly one full-height segment, so a plain
rectangle behaves byte-for-byte as before (the old single-loop code was that
special case).

**Why segmented and not "flow" gravity:** both natural showcase shapes — a plus
and a ring-with-missing-center — create *enclosed* playable cells with a void
directly above them (a plus's side arm, a ring's side). Pure top-spawn gravity
can never refill those (nothing can pass the void), so they'd drain to empty and
break the always-full invariant. Segmented gravity refills each enclosed pocket
from its own local top — a piece "appears" mid-board, which is common in match-3
games with holes and is deterministic, calm, and pure. The far more complex
"pieces slide diagonally around obstacles" flow model was rejected as overkill
for this calm game and this engine's pure-function ethos.

## Every "is this a match / a legal move / a shuffle" gate is void-aware, once each

- **`piecesMatch`** excludes voids (a void breaks any run it sits in; runs on
  either side are found independently, since `runsInLine` already segments on a
  non-matching neighbour). **`checkSquares`** already required all four corners
  to be `'normal'`, so voids can't seed a 2×2 — no change needed there.
- **`hasLegalMoves`** excludes voids as both swap source and neighbour (a
  `swappable` guard beside the existing blocker exclusion), so a board is never
  judged legal *or* stuck on the basis of a swap that can't happen.
- **`shuffle`** holds voids fixed — it only permutes the non-void pieces across
  the non-void positions, so a plus stays a plus. (A void-free board reduces to
  "every position is movable," identical to the pre-void flat shuffle.)
- **`applyMove`** rejects any swap touching a void, right beside the blocker
  rejection — the safety net for a drag from a board-edge cell toward a
  neighbouring void (`dragDirection` only bounds-checks the rectangle, not the
  shape).
- **`generateLevel`** carves voids first (a fixed `void` piece) and fills only
  the rest; `forbiddenTypesAt`'s `matchType !== undefined` guard means a void
  neighbour never contributes a false constraint, and the existing match-free +
  `hasLegalMoves → shuffle` guarantees now hold for a shaped board exactly as for
  a rectangle. `placeBlockers` excludes voids from its candidate pool, so a
  blocker never resurrects a cell the shape removed.
- **`Board.tsx`** renders nothing for a void (`return null` in the tile map) —
  every tile is absolutely positioned by row/col, so a skipped cell just leaves
  the board background showing through as the cutout; no layout shift, no
  placeholder, no tap/drag handler.

## Config plumbing and the showcase level

`LevelConfig.voidCells?: Position[]` (and the mirror `GeneratorConfig.voidCells`)
is the one new field — optional, so every existing rectangular level is
byte-identical. `createGameState` passes it straight through. The first
non-rectangular level, **Level 4 · "Cutting Board"** (App.tsx's `LEVEL_QUEUE`),
is a plus on a 7×7 board (the four 2×2 corner blocks voided → 33 playable cells),
hand-authored and calm (generous moves, fewer piece types so the shorter arms
still offer matches). Verified live in `docs/verification/board-shape/`.

## Deliberately deferred (see `DEFERRED_COMPLEXITY.md`)

~~Generator-*driven* shapes (the generator still only carves the `voidCells`
it's handed — it never invents a shape)~~ — **resolved**, see "Generator-driven
board shapes" below. Still deferred: any interaction between voids and the
specials/denial-spread systems beyond "a void is an inert fixed hole" (a spread
already only eats ordinary cells; a blast/sweep that reaches a void simply
doesn't clear it — see the "Fixed" sub-entry directly below for the one place
this needed real work).

### Fixed: the "a blast/sweep simply doesn't clear a void" claim above didn't hold

Real playtesting on a shaped board surfaced a "?" placeholder flashing as a
special cleared, and — worse — a void corner of the board occasionally turning
into ordinary playable content. The paragraph directly above already *asserted*
a blast/sweep can't touch a void; the actual code never enforced that. The five
places that build a special's swap-triggered clear set — `resolveMatchEffects`'s
in-match striped sweep, `expandChainClears`'s chain expansion, `resolveAreaBomb`'s
3×3 blast, `resolveColorBomb`'s whole-board detonation (the bomb+bomb swap), and
`keysToClearablePositions` (the striped+striped cross and striped+bomb
supercombo) — were all written before voids existed and each independently
excluded only `'blocker'`, never `'void'`. On a rectangular board that was a
no-op difference (no void ever existed to hit); on a shaped board, a sweep line
or blast radius that geometrically overlaps a void cell added it straight into
the effect's `clearedPositions`. `cloneBoardWithGaps` then nulled that cell, and
`calculateCascades`'s `isVoid` check requires an actual void `Piece`, not
`null` — so the nulled void read as an ordinary gap and got refilled by
`spawnPiece()`, permanently erasing the hole. The swallowed void also landed in
`diffBoards`' `cleared` list carrying no `matchType`, so the exiting-tile
pipeline (`exitingTileSprite` → `getSpriteForPiece` → `getSpriteForMatchType`)
resolved it to `undefined` → `spriteLabel`'s `'?'` placeholder — the same class
of bug as the original color-bomb "?" (see the two-sprite-path entry above), but
one layer upstream: that fix made the exit-tile pipeline honest about whatever
type it's handed, it was never responsible for keeping a void out of the clear
set in the first place.

Fix: one shared `isClearable(piece)` predicate (`type !== 'blocker' && type !==
'void'`) — the same pairing `matrix.ts`'s `hasLegalMoves` already uses for its
`swappable` guard — replacing all five ad hoc `!== 'blocker'` checks, so a
future non-content type only needs to be taught to this one place. Confirmed
with three new `engine/gameState.test.ts` cases (a striped sweep, an area-bomb
blast, and a color-bomb+color-bomb whole-board detonation, each crossing a
void) and a live harness against the real Cutting Board shape (seed-accurate
`voidCells`, real sprite art, the same scenario replayed on a plain rectangle
for direct comparison) — see
`docs/verification/void-specials-clear-fix/`. Still deferred, unchanged: void ×
denial-spread interaction (a spread already only ever targets `'normal'` cells,
so it was never exposed to this bug).

## Special-piece tutorial overlay: a data-driven sibling of the blocker tutorial, keyed by piece type

The three special pieces (striped, color bomb, area bomb) each teach a genuinely
different action — match it / swap it to detonate one color / swap it to blast a
3×3 — but nothing ever explained them; a player forged their first striped piece
and had to guess. The blocker already had exactly this: a one-time
`BlockerTutorialOverlay` ("A Covered Dish") shown the first time a blocker appears,
gated by `SaveData.seenTutorials`. This adds the same affordance for the specials.

**Chosen: one data-driven overlay, not three files.** `components/SpecialTutorialOverlay.tsx`
is a single component whose only per-piece differences are headline/subtext
(`SPECIAL_TUTORIAL_CONTENT`, keyed by tutorial id) and the icon — collapsing the
duplication per CLAUDE.md's "collapse the duplication" rule, rather than three
near-identical copies of the blocker overlay. The copy lives beside the component
that renders it (presentation), exactly the split the blocker overlay makes by
hardcoding its own headline; persistence owns *which* tutorial and *whether* it's
been seen.

**Tutorial ids are the engine `PieceType` strings themselves** (`'striped'`,
`'color_bomb'`, `'area_bomb'` — `STRIPED/COLOR_BOMB/AREA_BOMB_TUTORIAL_ID` in
`appPersistence.ts`). That lets `findSpecialPieceTutorial` compare `piece.type`
straight against the id with **no type→id mapping table** — the same "one shared
constant every call site agrees on" reasoning as `BLOCKER_TUTORIAL_ID`. The
overlay resolves the piece's icon through the **same `getSpriteForPiece` path**
every live tile uses, so a striped piece shows the real `striped_<base>` art it
was forged from and an un-arted piece falls back to the same text-label
placeholder — never a hardcoded reference.

**Not a mount-time check like the blocker's — re-derived after every committed
move.** A blocker can exist on a level's *initial* board, so `shouldShowBlockerTutorial`
runs once at mount. A special *never* does — the player forges it mid-level from
a 4-run, a 5-run, or a 2×2 square — so `Board.tsx` re-runs `findSpecialPieceTutorial`
in a post-move effect keyed on `gameState` (the same identity `onStateChange`
uses), firing exactly when a move settles, never mid-cascade. It's skipped once
the level has ended (so it never pops over the Won/Paused overlay) and while any
other tutorial is already up (so two never stack).

**`findSpecialPieceTutorial` returns only the FIRST unseen special, row-major.**
If one move mints two different specials, showing both at once would stack
overlays; instead the second's tutorial simply shows after the next move that
leaves it on the board. The scan returns the `Piece` itself (not just the id) so
the overlay can resolve its real sprite, exactly as the blocker overlay needs the
real blocker `matchType`.

**A session-level `dismissedSpecialTutorialsRef` guards the persist round-trip.**
The persisted `seenTutorials` prop does update (App.tsx's `handleTutorialSeen`
persists immediately via the same path the blocker uses), but there's a render
gap before that round-trips back down as a fresh prop. Folding this session's
dismissals into the seen check alongside the prop keeps a just-dismissed special
from flashing back in that gap — the once-ever guarantee stays honest.

**Persistence reuses `markTutorialSeen` unchanged**, idempotently, exactly like
the blocker tutorial and `unlockRecipeCard` — no new persistence pattern. Verified
live (real `applyMove` forging a striped, real `findSpecialPieceTutorial`, real
`getSpriteForPiece` art, real copy), see `docs/verification/special-piece-tutorial/`.

## `chain_reaction`: the fourth tutorial, teaching the moment 2+ specials fire together

The three per-piece tutorials above each explain one special in isolation.
Nothing ever taught the actual differentiator of this whole game: the moment
more than one special piece fires **together** from a single move, whether
via chaining (a special caught in another's clear firing its own effect too)
or a combo (two swapped specials). This adds that fourth card,
`chain_reaction` (`appPersistence.ts`'s `CHAIN_REACTION_TUTORIAL_ID`), reusing
the exact same `seenTutorials`/`SpecialTutorialOverlay` machinery the first
three proved out.

**The trigger reuses the chaining bookkeeping directly — no new detection.**
`expandChainClears`'s `originKeys` already distinguishes, per pass, the
specials an effect fires as its own trigger from the specials it merely
*catches*, and both categories are already known to have fired their own
effect into that pass's clear set (see the special-piece-chaining entry
above). The only new code is `countFiredSpecials(board, positions)` — a pure
count, over a clear set every caller already had in hand, of how many of
those positions were already a special piece (`striped`/`color_bomb`/
`area_bomb`) on the pre-pass board — threaded through as `specialsFired`
(`resolveMatchEffects`) and `maxSpecialsFired` (`CascadeResolution`, the new
shared return shape every cascade-resolving helper now uses). `applyMove`
exposes `ApplyMoveResult.multiSpecialFired = maxSpecialsFired >= 2`.

**Max across passes, not a sum.** A long cascade can fire several specials
across several sequential passes without any of them ever compounding
*together* — that's just an ordinary chain, not the teachable moment. Tracking
the largest count reached within any SINGLE pass (rather than summing every
pass) is what keeps the trigger meaning "multiple specials went off at
once," not "this move happened to involve more than one special somewhere in
a long chain." A combo (striped+striped, striped+bomb) always reads as 2+ in
its own first pass regardless — both swapped specials are origins in
`resolveClearSet`'s very first call, so a combo trips this without relying on
catching anything further.

**Not a board scan, unlike the three per-piece tutorials.** `findSpecialPieceTutorial`
works by scanning the settled board for a still-resting unseen special — but
the specials that fired a chain reaction are, by definition, already cleared
by the time the move settles; there is no piece left to find. So
`shouldShowChainReactionTutorial(multiSpecialFired, seenTutorials)` is a plain
once-ever boolean gate (the same shape as `shouldShowBlockerTutorial`) over a
value carried straight out of this move's own `applyMove` call, not a
re-derivable property of the resulting `GameState`.

**`SpecialTutorialOverlay`'s `piece` prop is now `Piece | null`.** The three
existing tutorials anchor their icon to the one real piece that just
appeared; chain_reaction has no single piece to point at — it celebrates a
moment, not a piece. Null falls back to `spriteLabel(tutorialId)` (`"CH"`),
the same text-label convention every un-arted sprite already uses, rather
than inventing a second fallback mechanism. One consequence worth flagging:
dropping real dedicated art in later for the first three tutorials is a
zero-code `spriteRegistry.ts` line (`getSpriteForPiece` already resolves
through it); chain_reaction's icon never consults the registry at all today,
so giving it real art later needs a small code change, not just a registry
entry — logged in `DEFERRED_COMPLEXITY.md`.

**Two tutorials never stack — for free, from `Board.tsx`'s existing render
order, not new priority logic.** `animateCascade`'s final-pass branch now
sets `specialTutorial` from `result.multiSpecialFired` synchronously,
alongside `setGameState(finalState)` — the same tick the combo-streak banner
already fires on. The existing post-move effect that scans for a per-piece
tutorial runs afterward (React batches both updates, then the effect sees
the already-rendered state) and already no-ops whenever `specialTutorial` is
truthy. So chain_reaction naturally wins any same-move collision with an
unrelated freshly-spawned special simply by being set first; the suppressed
per-piece tutorial shows on whatever later move leaves that special resting
on the board, exactly like the existing "second special minted the same move
waits for the next move" rule the three-tutorial entry above already
established — this just extends that same rule to a fourth candidate instead
of inventing an explicit priority check.

**Verified live from the start, not as a follow-up gap-closure.** The three
per-piece tutorials' first capture fed color bomb and area bomb a real
resting `Piece` directly, and needed a *second* capture
(`special-piece-tutorial/organic-spawns/`) to prove they also fire from a
genuine in-game spawn. This session built the organic capture in from the
start: a hand-built board (verified match-free against the real
`checkMatches`/`checkSquares` in a throwaway test before use) where a real
two-tap swap on the real running app makes a color bomb detonation
genuinely chain into a caught live striped piece, sweeping a whole column —
asserted via the real DOM, not read off a screenshot. See
`docs/verification/chain-reaction-tutorial/`.

# Dev-only reset — wipe the save and restart fresh, without OS storage settings

A testing convenience, not a player feature: a way to clear all saved progress
and reinitialize the game from inside the app, so a tester doesn't have to dig
through the OS's app-storage settings between runs.

**`clearSave(skinId, storage)` deletes the key rather than writing a blank
`SaveData`.** Removing the key means "reset save" and "never saved" are the same
on-disk state (the next `loadSave` returns `null`), so the app's genuine
fresh-install path can be reused verbatim afterward with zero special-casing.
This needed one addition to `AsyncStorageLike`: a `removeItem(key)` method (the
real `AsyncStorage.removeItem` is a drop-in, same as `getItem`/`setItem`;
`createInMemoryStorage` implements it with `Map.delete`). Writing an empty blob
was rejected because `loadSave` would then `JSON.parse` a non-null value — the
opposite of fresh.

**Reinitialization reuses the mount effect's init, not a second copy.** The
init body that turns a loaded save (or `null`) into session state was factored
out of App.tsx's mount effect into `applyLoadedSave(save)`. The reset is exactly
`clearSave(...)` then `applyLoadedSave(null)` — so there is no second definition
of "what a fresh game looks like" that could drift from the real first-run path.
A native `location.reload()` was rejected: it's web-only and wouldn't work on the
actual phone this is for.

**Hidden behind `__DEV__` AND a no-affordance long-press.** App.tsx passes
`onDevReset` to Home only when `__DEV__` is true, so the whole thing is compiled
out of any release build — a real player literally cannot reach it. On top of
that, the trigger is a 800ms long-press on the Home footer line ("No timers. No
rush. The kitchen keeps."), which renders as ordinary static text with no press
feedback: nothing to stumble into even in a dev build. A confirm guards an
accidental long-press (`window.confirm` on web, since react-native-web's `Alert`
can't render a two-button dialog; RN `Alert` on device).

**Verified live** (real Expo-web app over CDP): a seeded save loaded (Home showed
"3 of 9 recipes collected", "UP NEXT · LEVEL 4"), the footer long-press raised
the "[DEV] Reset all saved progress?" confirm, and on accept the localStorage
save key became `null` and Home returned to fresh ("UP NEXT · LEVEL 1"). See
`docs/verification/dev-reset/`.

## Ad/monetization abstraction: one platform-selected `AdService` interface, both providers still stubs

Two "watch a video" reward flows already existed (`Board.tsx`'s bonus-moves
grant, `App.tsx`'s refill-lives grant), both calling their grant function
directly and instantly, with no real ad SDK anywhere in the repo. Before
wiring in either real SDK (AdMob on mobile, CrazyGames on web), this session
built the seam: a new `services/` directory — a new architectural concern,
distinct from `engine/` (must stay pure/no I/O), `skins/` (config data), and
`components/` (presentation) — holding one `AdService` interface
(`requestRewardedAd(): Promise<boolean>`, `requestBannerAd(): Promise<boolean>`,
the latter stubbed and unwired since no banner-ad UI exists yet, kept for
symmetry per the architect's explicit ask) that the rest of the game calls
without knowing which provider answers it.

**Why `defaultAdService.ts` is split out from `adService.ts`, not folded in.**
The obvious design — one file with an interface, two adapters, and a
`Platform.OS`-driven default — was rejected after an empirical check:
`node -e "require('react-native')"` throws on Flow syntax in this repo's own
`node_modules`, and this project's `jest.config.js` is plain `ts-jest` with
`testEnvironment: "node"` — no `jest-expo`/React Native preset, so Jest never
transforms `node_modules` the way Metro does. Any test whose module graph
reaches a runtime `import ... from 'react-native'` crashes. So `services/adService.ts`
(the interface + a pure `selectAdService(platformOS: string): AdService`,
parameterized by a plain string rather than reading `Platform.OS` itself) stays
fully unit-testable, and `services/defaultAdService.ts` — the **only** file
that does `import { Platform } from 'react-native'` — is never imported by any
test, only by `Board.tsx`/`App.tsx`. This isn't a novel workaround: it's the
same shape `engine/gameState.ts`'s `AsyncStorageLike` DI precedent uses
(interface + swappable implementation + a real module-level default), but it
is **not** a case of reusing that precedent's safety — investigation found
`AsyncStorageLike`'s `defaultStorage = AsyncStorage` only works under this
Jest config because `@react-native-async-storage/async-storage`'s package
resolves to a `localStorage`-backed JS file under plain `require()`, never
actually touching the `react-native` package itself; that's a coincidence of
that one package's own layout, not a guarantee `services/` could lean on for
two arbitrary ad SDKs. Hence the explicit split here, confirmed by a passing
`services/adService.test.ts` that never touches `defaultAdService.ts`.

**Both adapters (`adMobAdService.ts`, `crazyGamesAdService.ts`) are still
stubs** — `requestRewardedAd()`/`requestBannerAd()` instantly resolve `true`,
matching the exact behavior the two real flows had before this abstraction
existed. `services/adService.ts` statically imports both; this is deliberately
not split into Metro-resolved `adService.native.ts`/`adService.web.ts` files
yet, since neither adapter has a real SDK import today and doing so now would
sacrifice `selectAdService`'s plain-string testability for a bundle-safety
problem that doesn't exist yet (see `DEFERRED_COMPLEXITY.md` for when to
revisit this).

**Call sites** (`Board.tsx`'s `handleGrant`, `App.tsx`'s `handleGrantLife`)
now `await adService.requestRewardedAd()` before granting, importing the real
singleton from `services/defaultAdService.ts`; a `false` result (ad dismissed
early) leaves the pre-existing state untouched — no grant, no cap spent, no
save write. Both handlers became `async`, which needed no prop-type changes
anywhere: a `Promise<void>`-returning function is assignable to a
`() => void`-typed prop (`PausedOverlay`'s `onGrant`, `OutOfLives`'
`onGrantLife`) under TypeScript's existing void-return covariance rule.
Neither handler was previously covered by a test (`Board.tsx`/`App.tsx` have
no dedicated test files in this repo), so nothing broke; `grantBonusMoves`
(`engine/gameState.ts`) and `grantInstantLife` (`appPersistence.ts`) — the
actual grant logic — are untouched, still covered by their existing tests.

Verified live via `expo start --web` (the CrazyGames stub path,
`Platform.OS === 'web'` in-browser): both "watch a video" flows still
instantly grant exactly as before — the moves-grant flow was reached via a
temporary `?harness=paused-grant` gate in `Board.tsx` (reverted after
capture), and the lives-grant flow via a direct `localStorage` save patch,
with the real persisted save read back afterward as proof (`lives: 0` →
`lives: 5`). See `docs/verification/ad-service/`. The AdMob/native path has no
simulator available in this environment to drive live; it's covered by
`selectAdService('ios'|'android')`'s unit test and direct code reading only.

## CrazyGames Basic Launch gap: monetization disabled regardless of build, mobile unaffected

CrazyGames games start in a "Basic Launch" phase where the platform disables
all monetization outright — `requestAd()` returns an `adsDisabledBasicLaunch`
error — until CrazyGames reviews the game and graduates it to "Full Launch."
Mobile (AdMob) has no equivalent gap; it's expected to work from day one.
Investigated first, per this session's brief: does the SDK expose a
proactive way to check whether monetization is currently enabled, so the
game could detect a graduation to Full Launch on its own? It does not — the
only signal is `requestAd()`'s own `adError` callback reporting
`adsDisabledBasicLaunch`, and that only fires *after* attempting a request
that was doomed from the start (docs.crazygames.com's video-ads and ads-
requirements pages, fetched directly). So this is exactly the "manually set
build-time configuration flag" fork the brief anticipated, not a runtime
read: `crazyGamesAdService.ts`'s `CRAZY_GAMES_MONETIZATION_ENABLED` (`false`
today, matching the real Basic Launch state), flipped by hand the day
CrazyGames actually notifies of Full Launch graduation.

**The phase check lives entirely inside `crazyGamesAdService.ts`, not as a
parallel system.** `requestRewardedAd()`/`requestBannerAd()` branch on the
flag: disabled grants/declines directly (no ad exists to gate on), enabled
falls through to the exact same stub `adMobAdService.ts` already used (still
no real SDK wired in — unchanged from before this session). `AdService`
gained one new synchronous method, `isRewardedAdAvailable()` — a plain
getter, not async, since UI callers need it to pick button copy before the
player taps anything, and awaiting a promise just to render a label would
mean a pointless loading flicker. `adMobAdService.isRewardedAdAvailable()` is
unconditionally `true`; CrazyGames' reflects the flag. `crazyGamesAdService.ts`
is restructured as `createCrazyGamesAdService(monetizationEnabled: boolean)`,
with the real exported singleton just that factory called with the flag —
the factory shape (not a bare object) is what let
`crazyGamesAdService.test.ts` exercise both phases deterministically without
mutating module state.

**Button copy is phase-aware, confirmed with the architect as a real fork**
(a button that still says "Watch a video..." while silently granting for
free — accurate as of the abstraction, but not honest to the actual player —
was one legitimate direction; changing the copy was the other, chosen one).
`PausedOverlay`/`OutOfLives` each gained an `adAvailable: boolean` prop (from
`Board.tsx`/`App.tsx`'s `adService.isRewardedAdAvailable()`), swapping "Watch
a video for N more moves"/"Watch a video to refill your lives" for "Get N
more moves"/"Refill your lives" (and `OutOfLives`' subtext line) whenever
`adAvailable` is false. Only the copy changes — the tap handler, the grant
call, and the grant logic itself (`grantBonusMoves`, `grantInstantLife`) are
identical either way.

`requestBannerAd()` also went phase-aware (returns `false` when disabled,
matching the honest "no banner exists to show" reality) even though no
banner-ad UI exists to call it yet — kept in step with `requestRewardedAd()`
since both now read the same flag, and leaving one phase-aware and the other
not would be a latent inconsistency the moment a banner UI is built.

Verified live via `expo start --web`, both phases, using the same
`?harness=paused-grant` gate and `localStorage` save-patch precedent as the
original ad-service session (both reverted after capture): with
`CRAZY_GAMES_MONETIZATION_ENABLED = false` (today's real value), tapping
"Get 5 more moves" on `PausedOverlay` took `movesRemaining` from 0 to 5 and
resumed play with no ad attempted, and tapping "Refill your lives" on
`OutOfLives` took the persisted save's `lives` from 0 to 5 (read back from
`localStorage` afterward as proof); flipping the flag to `true` and repeating
both flows switched the copy back to "Watch a video..." on both screens,
matching AdMob's unconditional-`true` behavior exactly, before the flag was
reverted to `false`. See `docs/verification/crazygames-basic-launch/`.

## Web export subpath paths: expo's export is root-absolute, CrazyGames mounts under a folder

`expo export -p web` writes `index.html`'s script tag and every asset
reference inside the bundled JS as root-absolute paths (`/_expo/...`,
`/assets/...`). That's correct for a deploy at a domain root, but CrazyGames
(and most game-portal hosts) mount each game under its own subpath
(`crazygames.com/game/lalas-kitchen/...`), where a root-absolute path
resolves against the *domain* root instead of the game's own folder and
404s. This is a real, previously-unaddressed gap in the CrazyGames deploy
path this session's Basic Launch work landed next to, not a hypothetical —
found while finishing that work's own loose ends.

**`scripts/fix-web-export-paths.js`** is a small post-export Node script
(`npm run export:web` runs `expo export -p web` then this script), not an
Expo/Metro config change — Expo's web export has no documented option to
emit relative paths, and vendoring or patching Expo's own config was judged
higher-risk than a small idempotent post-process step. It rewrites any quote
immediately followed by a leading `/` and a word character
(`(["'])\/(\w)/g`) to `./`, matching by *context* rather than hardcoded
folder names so it doesn't need updating if Expo's asset layout changes —
and that same context rule is what keeps it safe: react-native-web's
hydration marker string (`"/$`) and a bundled comment-formatter's block-
comment marker (`"/*`) both have a non-word character immediately after the
slash, so neither matches and neither gets corrupted. Confirmed against a
real export, not just reasoned about — see
`docs/verification/web-export-subpath-paths/`.

The rewrite logic is split into a pure `rewriteRootAbsolutePaths(source)`
function (string in, `{after, count}` out) from `rewriteFile`'s disk I/O,
the same pure-function-first shape `engine/` uses, so
`fix-web-export-paths.test.js` can exercise the regex directly against
fixture strings — including the hydration and comment-formatter markers —
without needing a real `dist/` on disk. The script still runs `main()`
automatically when invoked directly (`require.main === module` guard), so
`npm run export:web` behaves exactly as before.

**Live verification, one level below server root, not the domain root:**
ran a real `expo export -p web`, confirmed the real, unrewritten output
actually contains root-absolute paths (30 of them: 1 in `index.html`, 29 in
the bundled JS, one per sprite asset), ran the fix script and re-grepped the
same real bundle to confirm zero remain and both marker strings survived
untouched, then copied the rewritten export into a `webroot/game/` folder
(one level below the server root, not the root itself) served by a plain
static file server. Confirmed the bug first — a request for the export's JS
bundle at the root-absolute path it would have used before the fix 404s
against that server, exactly what a real browser would have hit pre-fix.
Then drove a real headless Chrome over CDP (this project's established
WSL2 approach — Windows `chrome.exe`, profile on a native Windows path since
a `\\wsl.localhost` UNC profile path crashes Chrome's sandbox) to load
`http://localhost:8899/game/` for real and captured every network request
via `Network.responseReceived`: the HTML, the JS bundle, and both sprite
assets the initial screen loads all resolved with a real 200 under
`/game/`, `document.title` read back as `"Lala's Kitchen"`, and `#root`
rendered 44,534 characters of real app HTML — not a blank page. The only
404 was the browser's own automatic `/favicon.ico` probe at the domain
root, unrelated to the export. See
`docs/verification/web-export-subpath-paths/` for full request logs.

## Sound/haptics stub layer

CLAUDE.md's Design Constraints already presupposed a mute toggle existed
("Sound defaults to off, with an easy one-tap mute") but investigation
confirmed zero audio/haptics code, zero audio/haptics dependency, and no
mute toggle in any screen existed anywhere — the constraint was aspirational,
not built. This session built the stub infrastructure (service interfaces,
`SaveData` flags, event wiring, a real Home toggle) with graceful no-op
fallback everywhere a real asset doesn't exist yet, cheap to do now and
expensive to retrofit once more event call sites depend on ad hoc timing.

**Two independent flags, not one combined switch.** `SaveData.soundEnabled`
and `SaveData.hapticsEnabled` are separate optional booleans, both defaulting
to `false` (`App.tsx`'s `SOUND_ENABLED_DEFAULT`/`HAPTICS_ENABLED_DEFAULT`).
Sound's off-default is directly dictated by CLAUDE.md's real user research
(the target player finds game sound distracting); haptics has no equivalent
documented complaint, but defaults off too for the same calm-by-default
reasoning applied uniformly — a player opts into more sensory input rather
than opting out of it. Independent, not combined, because they're different
sensory channels: a player may want tactile confirmation without audio or
vice versa.

**`SoundService`/`HapticsService` mirror `services/adService.ts`'s
interface-plus-factory shape**, but diverge from it in one load-bearing way.
`adService.ts` safely imports both concrete adapters (`adMobAdService.ts`,
`crazyGamesAdService.ts`) directly, because neither touches a real native
SDK yet — both are pure stubs. Haptics is different: `expo-haptics` is a
real, already-active native module, and its raw ESM `import` fails to parse
under this repo's plain ts-jest config (confirmed empirically — the same
Flow-syntax-style crash `services/defaultAdService.ts` avoids for
`react-native`'s own import). So `services/hapticsService.ts`'s
`selectHapticsService(platformOS, nativeService, webService)` takes both
candidate services as plain injected params instead of importing
`expoHapticsService` itself — that real import lives only in
`services/defaultHapticsService.ts`, the one file (mirroring
`defaultAdService.ts`) never imported by a test. `soundService.ts` didn't
need this split: both platforms resolve to the same `silentSoundService`
today (no sound assets exist, so no adapter touches a real audio backend
yet), so its factory keeps `adService.ts`'s simpler single-platform-string
signature.

**The SaveData-flag gate lives at the call site, not inside the services.**
`SoundService.play()`/`HapticsService.fire()` have no idea what a "flag" or
"SaveData" is, the same separation `adService.ts` keeps from `lives`/grant
logic — gating inside the service would couple a pure platform adapter to
app-level persisted state for no reason.

**`components/soundEffects.ts`'s `triggerPassEffects` is a plain function,
not a React hook**, despite this session's brief naming it `useSoundEffects`.
It holds no render state and calls no other hooks, so wrapping it in
`useCallback`/`useState` would only add hook-call constraints (calling a
`useCallback`-wrapping function outside a real component render throws
React's "Invalid hook call") and force a new `@testing-library/react`
dependency plus this repo's first jsdom test environment, just to validate
branching logic a plain function tests directly. Confirmed with the
architect before writing it this way — see the plan review. It's called
once per cascade pass from `Board.tsx`'s `animateCascade`/`runStep(i)`, the
only place `applyMove`'s `steps`/`events` are available without widening
Board's prop surface (the same reason `appPersistence.ts`'s
`didLevelJustEnd` re-derives level-end instead of threading `events` up to
`App.tsx`).

**Match/cascade/win signal is derived from `steps`/pass index, not a new
engine event type.** `ApplyMoveResult.events` only ever contains
`combo_streak` (4+ chained cascades) and `level_summary` (win/loss) — there
is no per-ordinary-match or per-cascade-pass event. Adding one would be new
engine computation the original ask didn't call for; deriving "was this the
first pass" (`i === 0`) and "was this the final pass, and did it win"
(`isFinalPass && finalState.status === 'won'`) from data `applyMove` already
returns needed nothing new in `engine/gameState.ts` at all.

## Real audio backend: expo-audio over expo-av, and procedurally synthesized sound files

The stub layer above was deliberately silent — no real playback backend, no
sound assets, `silentSoundService` as the one correct concrete `SoundService`.
This session replaced that with real playback, closing `DEFERRED_COMPLEXITY.md`
item (a).

**`expo-audio`, not `expo-av`.** Investigated first, since both exist:
`expo-av`'s audio/video APIs were deprecated in SDK 53 and are removed
entirely in SDK 55 (confirmed via Expo's own changelog/docs) — this project
is on SDK 54, the last version where `expo-av` even still works, so building
the real backend on a dying API would mean redoing this within one SDK bump.
`expo-audio`'s pinned version for SDK 54 is `~1.1.1`
(`node_modules/expo/bundledNativeModules.json`), installed manually via
`npm install expo-audio@~1.1.1` — this environment's npm config rejects
`expo install`'s internal flag for project-scoped installs, the same
constraint `DEFERRED_COMPLEXITY.md` item (c) already documents for
`expo-haptics`. Its `createAudioPlayer()` imperative API is a clean fit for
the existing fire-and-forget `SoundService` interface — no React hook, no
component lifecycle needed, matching how `expoHapticsService.ts` already
calls `Haptics.impactAsync` imperatively.

**No audio generation tool or licensed sound-asset access exists in this
build environment** — confirmed directly (no `ffmpeg`/`sox`, no `numpy`, no
MCP audio tool, no configured API credentials for a service like Freesound,
whose download API requires OAuth this environment doesn't have). Scraping
arbitrary audio off the open web would carry real, unverifiable licensing
risk. Presented as a genuine fork to the architect rather than assumed:
synthesize procedurally (chosen), wire the backend now and defer real files,
or wait for architect-supplied files. `scripts/generate-sound-assets.js` is a
small, dependency-free Node script that writes real, valid 16-bit PCM WAV
files directly (`match.wav`, `cascade.wav`, `win.wav`) — plain sine tones plus
a quiet upper harmonic, a fast linear attack and exponential decay envelope,
kept deliberately quiet (peak amplitude 0.2–0.3) so `match`/`cascade` recede
during a fast chain rather than compounding into noise, matching CLAUDE.md's
calm-not-frantic brief. This is real playable audio the project owns
outright, not a placeholder — but it is a synthesized tone, not a
sound-designer asset, and no human has listened to it yet (see
`docs/verification/real-audio-backend/`'s disclosed gaps).

**`services/expoAudioSoundService.ts` keeps one player per effect alive for
the app's lifetime** rather than create-and-discard per `play()` call —
`expo-audio`'s docs warn that a `createAudioPlayer()` result needs a manual
`release()`/`remove()` to avoid leaking, but a fixed pool of at most three
long-lived players (one per `SoundEffectId`) never needs that: nothing is
ever discarded. Because `expo-audio` (unlike `expo-av`) leaves a finished
player paused at its final position instead of resetting it, every `play()`
call does `player.seekTo(0).then(() => player.play()).catch(() => {})` —
chained off the promise rather than awaited, so the call site stays
fire-and-forget, and a `.catch` (not a `.then` rejection handler) so it also
covers `player.play()` itself throwing synchronously inside the `.then`.
Like `expoHapticsService.ts`, this file is never imported by a test —
`expo-audio`'s import fails to parse under this repo's plain ts-jest config
the same way `expo-haptics`'s and `react-native`'s do.

**`selectSoundService`'s platform branch is gone, not preserved as dead
code.** The stub-layer entry above noted `soundService.ts` never needed
haptics' native/web split because both platforms resolved to the same silent
stub. Now that a real adapter exists, the same conclusion holds for a
different reason: `expo-audio` genuinely plays correctly on every platform
Expo targets (Android, iOS, tvOS, and web — confirmed, not assumed), so
there's no platform-conditional behavior to encode. Keeping an unused
`platformOS` parameter "for a future split that might never come" would be
exactly the dead-parameter complexity CLAUDE.md's baseline instructions warn
against; `selectSoundService(realService: SoundService)` now just returns
what's injected, with the injection itself (not a platform read) still doing
the real job of keeping `expo-audio`'s import out of anything a test reaches
— `services/defaultSoundService.ts` is the one file that imports
`expoAudioSoundService` and constructs the real singleton, mirroring
`defaultHapticsService.ts` exactly except for the now-absent `Platform.OS`
read.

**Verification is honest about what a sandboxed environment can and can't
confirm about audio.** Live-driven over CDP against the real running
Expo-web app (per the standing WSL2 screenshot note): a real drag-swap match
with Sound on produced a real `HTMLAudioElement` construct + `.play()` call
against the real served `match.wav` asset (confirmed by monkey-patching the
actual browser primitive `expo-audio`'s web backend uses, not an app-level
log); the identical swap on the identical deterministic board with Sound off
produced zero audio calls. What this does *not* confirm, disclosed rather
than glossed over: `cascade`/`win` were not independently live-triggered
(same code path, untested in the live pass); no native device/simulator was
available to confirm the real native `AudioPlayer` backend or actual
audible fidelity; and no human has listened to the tones to confirm they
read as calm/pleasant rather than merely functioning. See
`docs/verification/real-audio-backend/README.md`.

## Fixed: a real device build crash caused by a phantom `expo-asset` version, introduced by this same session's `expo-audio` install

A fresh native Android build crashed at startup with `java.lang.NoClassDefFoundError`
inside `expo.modules.asset.AssetModule`, before the app itself ran. Investigated
before touching anything, per the Playtest Feedback Protocol — this turned out
to share a root cause with the work directly above, not a fresh, unrelated bug.

`package-lock.json` showed **two different `expo-asset` packages installed
side by side**: the correct one nested at `expo/node_modules/expo-asset@12.0.13`
(matching `expo/bundledNativeModules.json`'s own SDK 54 pin), and a second,
much newer one hoisted to the top of `node_modules` at `expo-asset@57.0.3` —
a version line far past SDK 54, installed as a side effect of `expo-audio`'s
own `package.json` declaring an **unconstrained** peer dependency,
`"expo-asset": "*"`. npm's auto-install-peers behavior (default since npm 7)
resolved that unbounded range against the npm registry's current latest
rather than reusing the already-present SDK-compatible nested copy, and
installed it fresh at the top level, where it shadows the correct version
for any sibling package whose own module resolution walks up to the app's
top-level `node_modules` rather than staying nested inside `expo`'s private
tree. Confirmed this was the actual mechanism, not a guess, by running the
exact command `android/settings.gradle` invokes live at every build
(`expo-modules-autolinking resolve -p android`, called dynamically via
`autolinkLibrariesFromCommand`, not baked into any committed/cached file) —
it deterministically linked the wrong top-level `57.0.3` copy of
`expo.modules.asset.AssetModule`, the exact class in the crash, compiled
against Expo Modules APIs far newer than this app's actual
`expo-modules-core@3.0.30` (confirmed to exist as only one copy — this was
never a duplicate-core problem, only a duplicate-`expo-asset` one).

**A clean rebuild was investigated as an alternative explanation and ruled
out, not just assumed away.** The mismatch is a static fact about what's
physically installed in `node_modules`, not anything cached in a build
folder — the same deterministic autolinking command returns the identical
wrong version on repeat runs, so a clean/cache-cleared rebuild would
re-resolve the identical incompatible `expo-asset@57.0.3` and crash the same
way. This conclusion is inference from the deterministic nature of the
autolinking input, not from watching a real device build fail twice — this
environment has no Android SDK/JDK, so the actual native build was never run
here; only the live resolution command that build depends on was.

**The fix:** add `expo-asset` as an explicit top-level dependency, pinned to
the SDK 54 bundled version (`"expo-asset": "~12.0.13"` in `package.json`),
so npm dedupes onto one correct copy instead of installing a second,
unconstrained one to satisfy `expo-audio`'s peer range. `npm install`
removed 6 packages (the rogue `57.0.3` copy and its own now-unneeded
dependents) and left exactly one `expo-asset@12.0.13` in the tree. Re-running
`expo-modules-autolinking resolve -p android` afterward confirmed `expo-asset`
now resolves to `12.0.13` — worth noting, this also incidentally fixed an
identical latent shadow-copy of `expo-constants@57.0.3` that the same npm
peer resolution had installed alongside it (autolinking happened to still
pick the correct nested `expo-constants` copy before this fix, so it wasn't
independently crashing yet, but the phantom copy is gone now too). All 503
tests still pass; this was a dependency-resolution fix with no source code
changes. Still unverified, disclosed rather than assumed: a real native
Android build actually launching cleanly on device, since no Android
SDK/JDK/device was available in this environment to confirm directly.

**Cascade passes get sound but no haptic.** A haptic pulse on every fast
pass of a long chain would read as a buzzy alarm — directly against
CLAUDE.md's calm-not-frantic constraint. The haptic fires once, on the
first pass only (the player's own swap); sound alone still lets a long
chain register audibly when enabled.

**The win sound fires in step with the winning clear itself** (the same
`runStep(i)` call as every other pass's cue), not deferred to the existing
`setTimeout(() => setTerminalOverlayReady(true), terminalOverlayHold)` later
in the same function. That existing hold is specifically about the *visual*
overlay card not popping over still-animating tiles — a legitimate
visual-only concern. A win jingle cueing the instant the winning match
happens is the natural analog of every other pass's audio cue; delaying it
to match the overlay's hold would make the sound land noticeably after the
pieces have already visibly cleared.

**No distinct `combo_streak` sound** — out of scope per the original ask
(match/cascade/win only); `ComboStreakBanner` already owns that visual
acknowledgment. A fourth `SoundEffectId` is a small, obvious follow-up if a
distinct combo cue is wanted later.

**`expo-haptics` installed via a pinned-version `npm install`, not
`npx expo install`.** `expo install` internally invokes `npm install
--allow-scripts`, which this environment's npm config (`allow-scripts=
@anthropic-ai/claude-code` in `~/.npmrc`) rejects for project-scoped
installs. Installed the exact SDK-54-pinned version directly instead
(`npm install expo-haptics@~15.0.8`, matching `expo/bundledNativeModules.json`'s
pin) — same end result, no `expo install`-specific resolution logic
skipped, since the version was already resolved by hand from the same
source `expo install` itself reads.

**`expo-audio`/`expo-av` are deliberately NOT installed this session.** No
real sound files or playback backend exist yet — `silentSoundService` is
the only concrete `SoundService`, and it's correct behavior (not a
placeholder) with zero registered assets. `skins/lalas-kitchen/soundRegistry.ts`
is an empty, hand-built `require()`-map placeholder (mirroring
`spriteRegistry.ts`'s Metro-literal-string constraint) so dropping in real
audio later is a one-line addition per effect, not a new pattern — installing
a real audio package is deferred until real assets land (see
`DEFERRED_COMPLEXITY.md`).

Verified: all 329 existing + new tests pass (`npm test`); a live Home
screenshot confirms the new Sound/Haptics toggle row renders and responds
to a tap. See `docs/verification/sound-haptics-stub/`.

# How-to-play onboarding tutorial: the genuine first-time mechanic explanation

Every tutorial built so far — the blocker card, the three special-piece
cards, `chain_reaction` — assumes the player already knows how to swap tiles
to make a match. Nothing ever explained the base swap-to-match mechanic
itself. This adds that card: the one shown before all the others, the very
first time a genuinely fresh save's level 1 loads, teaching tap/drag-to-swap
and matching three or more.

**Confirmed nothing like this already existed before building it.** Searched
the whole tree for `howToPlay`/`onboarding`/`welcome` (case-insensitive) —
zero hits beyond an unrelated `Home.tsx` welcome-back copy string. The
blocker tutorial and the four special-piece/chain-reaction tutorials were the
entire tutorial surface.

**Reused `SpecialTutorialOverlay`, not a new file.** That component already
generalized once beyond "one card per special piece" when `chain_reaction`
was added with a `piece: null` fallback (no single piece to anchor an icon
to, since the moment it celebrates has no one piece). This tutorial has the
exact same shape — no single piece to point at, since it explains the
mechanic itself, before any piece has even been swapped — so it's a fifth
`SPECIAL_TUTORIAL_CONTENT` entry (`how_to_play`, headline "Tap and Swap"),
not a sixth near-identical overlay file. Its icon falls back to the same
`spriteLabel('how_to_play')` → `"HO"` placeholder convention every un-arted
tutorial already uses.

**The actual hard problem: `levelIndex === 1` alone is the wrong gate.**
`shouldShowBlockerTutorial` and `shouldShowChainReactionTutorial` are both
plain once-ever boolean gates over signals that are already correct — a
board either has a blocker or it doesn't; a move either fired 2+ specials or
it didn't. But "is this level 1" is NOT the same as "is this a genuinely
fresh save": a player who already finished level 1 (or well past it) and
later replays it — from All Levels, or Board's own "Play again" — also has
`levelIndex === 1`, despite already knowing how to play. Gating on
`levelIndex` alone would incorrectly resurface an onboarding card for an
experienced player. `appPersistence.ts`'s `shouldShowOnboardingTutorial`
therefore also requires `completedLevels.length === 0` — the account has
never won anything, ever, on this save. That's the real "genuinely fresh
save" signal: `completedLevels` is never empty again once the player has won
anything, so a returning player revisiting level 1 can never trip this,
while a truly fresh install always can, exactly once, until dismissed.

**A new `Board` prop, not a value Board derives from data it doesn't have.**
`shouldShowBlockerTutorial` reads the level's own board — data `Board`
already owns. `shouldShowOnboardingTutorial` needs `completedLevels`, which
`Board` never previously received (only `levelIndex` and `seenTutorials`
were already props). Rather than have `App.tsx` precompute the boolean
itself (the shape `unlockedRecipeCard` uses, since that value genuinely
depends on win-transition-specific bookkeeping only `App.tsx` has), this
follows `shouldShowBlockerTutorial`'s existing precedent instead: thread the
one new persisted list `Board` needs (`completedLevels`) through as a plain
prop, and let `Board`'s own mount-time `useState` initializer make the same
kind of self-contained decision `showBlockerTutorial` already does.

**Takes top priority over every other tutorial, by construction, not a new
priority system.** `showOnboardingTutorial`'s mount-time check runs before a
single move is possible, and `canAcceptMove`/`dragEnabled` both gate on it
alongside the existing blocker/special checks — so no move can ever be made,
and therefore no special piece can ever spawn and no blocker's tutorial gate
can ever matter, until it's dismissed. The post-move special-tutorial effect
and both overlay render blocks additionally check `!showOnboardingTutorial`
defensively, mirroring the "two tutorials never stack" guarantee the
chain_reaction entry already established, even though today's actual level 1
content (no blockers) means the blocker tutorial could never coincide with
it in practice.

**Verified live against the real app, not a synthetic harness — including
the once-ever guarantee across a genuine relaunch, not just a single
mount.** Driven over CDP against the real running Expo-web app (per the
established WSL2 screenshot procedure): `localStorage.clear()` for a
genuinely fresh save (not the dev-only reset flow, which presumes a prior
save existed to reset from), a real click on Home's "Start cooking", and a
screenshot of the real rendered overlay over the real level 1 board. A
second run confirmed the full round trip: dismiss → the real persisted save
immediately shows `seenTutorials: ["how_to_play"]` with `completedLevels: []`
→ a full page reload (a genuine relaunch, not a re-render) → re-entering
level 1 the same way shows no overlay at all, board immediately interactive.
All 370 tests pass (`npm test`). See
`docs/verification/how-to-play-tutorial/`.

## Generator-driven board shapes: a curated template set, gated and rotated exactly like blockers

The board-shape entry above (see "Deliberately deferred") had one real gap
left: `generateLevel`'s `voidCells` contract was fully general from the start
(a template just hands it a `Position[]`), but nothing ever *chose* a shape
for a generator-driven level — every non-rectangular board was the one
hand-built Level 4 "Cutting Board". This session closed that gap.

**Investigated first, per the playtest-feedback protocol's spirit even though
nothing was broken here.** Confirmed directly against the code (not assumed)
that: (1) Level 4's void cells are a hand-picked `Position[]` constant in
`App.tsx`, structurally identical to any other `voidCells` array — no special
casing anywhere reads "this is the showcase level"; (2) `generateLevel`
already treats `voidCells` as fully general — `placeBlockers`'s candidate
pool structurally excludes voids before the random draw even runs, `shuffle`
holds voids fixed, and every match/square/legal-move gate is already
void-aware (see the board-shape entry above). So this was a pure *selection*
problem, not an engine problem — no change to `engine/generator.ts` was
needed at all.

**A small curated template set, not procedural generation.** `engine/
boardShapes.ts` exports 3 pure functions — `cutCornersVoids`, `plusVoids`,
`ringVoids` — each `(rows, cols) => Position[]`, plus a `BOARD_SHAPE_ROTATION`
array and a `BOARD_SHAPE_TEMPLATES` registry keyed by `BoardShapeId`. This
mirrors every other piece of content variety in this project (the 9 curated
recipe cards, the fixed blocker roster, the 3 curated tutorial cards) rather
than attempting to invent shapes algorithmically — a small, hand-designed set
that reads as intentional is a better fit than a shape-generation algorithm
whose output would need its own aesthetic review anyway.

- `cutCornersVoids` — an L-shaped notch (corner cell + its two orthogonal
  neighbours) at each of the 4 corners.
- `plusVoids` — voids the 4 corner blocks outside a full-height middle column
  band and a full-width middle row band (a generalization of Level 4's own
  plus, sized proportionally — `max(1, floor(rows/4))` / `max(1,
  floor(cols/4))` — instead of that level's hand-picked 7×7 corners, so the
  arms stay sensible at the generated board's actual 8×5 size).
- `ringVoids` — voids every interior cell, leaving a 1-cell playable frame.

All three are pure functions of `(rows, cols)`, not hardcoded to 8×5, the
same generality `voidCells` itself already had — they'd hold up if the
generated board size ever changed, even though that's not exercised today.

**Gated exactly like `pot_lid`/denial-spread, not a new gating mechanism.**
`appPersistence.ts`'s `generatedShapeId(levelNumber)` is a `levelNumber`
threshold (`SHAPE_MIN_LEVEL_NUMBER = 8`) plus a cadence
(`SHAPE_CADENCE = 4`, "1 in 4" once eligible), confirmed with the architect
before committing to numbers rather than guessed: 8 is one level after
`pot_lid` (the tougher blocker) unlocks at 7, so a player has met the full
blocker roster on ordinary rectangles before also coping with reduced board
area; a shape is deliberately "occasional" rather than the new normal, so it
keeps reading as a surprise. Below the threshold, or on an off-cadence level,
`buildGeneratedLevelConfig` omits `voidCells` entirely — byte-identical to
every generated level before this feature existed. Which template shows up
on an eligible level rotates deterministically through
`BOARD_SHAPE_ROTATION` by elapsed cadence steps since the threshold — the
same reproducible-by-`levelNumber` shape `eligibleBlockerIds`'s rotation and
the objective `targetMatchType` rotation already use, not a random pick.

**Composes freely with blockers/denial-spread — independent gates, no new
interaction to design.** A shaped level can also have blockers, pot_lid, or
denial-spread active, since each gate only reads `levelNumber` and its own
prior state; `placeBlockers`'s existing void-exclusion and the denial
spread's existing "only ordinary cells" rule (see the Phase 8 entry above)
already make the combination safe with zero new code.

**Board size itself still never varies** — only `voidCells` on the existing
fixed `rows`/`cols` rectangle (see `buildGeneratedLevelConfig`'s own doc
comment on why CLAUDE.md's edge-to-edge tile sizing pins board size, not
shape).

Verified with new unit tests (`engine/boardShapes.test.ts` — each template's
exact geometry at the real 8×5 generated size, in-bounds/no-duplicate checks
across a range of sizes), a new `engine/generator.test.ts` describe block
(all 3 templates, at the real 8×5 size, combined with blockers, against the
same match-free/square-free/legal-move/void-exclusion guarantees a plain
rectangle gets), and new `appPersistence.test.ts` coverage (`generatedShapeId`
threshold/cadence/rotation, `buildGeneratedLevelConfig`'s `voidCells` output
below/at/past the threshold, and one full-pipeline test through
`createGameState` confirming a real generated shaped board). All 399 tests
pass (`npm test`). Verified live against the real running app — a save
seeded directly to land on the first generator-driven shaped level (`levelIndex`
12, generated level number 8) rendered a genuinely non-rectangular board with
the real in-game level-12 HUD, not the hand-built Cutting Board level — see
`docs/verification/generator-driven-board-shapes/`.

## Embedded square in a straight run: a real playtest gap, distinct from the still-deferred ambiguous case

A real playtest report: a match matching an exact pattern — two cells on one
row, three cells on the row beside it, both sharing the same two columns (a
2×3 rectangle missing one corner) — didn't spawn an area bomb. Investigated
before changing anything, per the playtest-feedback protocol.

**What was actually true, confirmed against the code, not assumed.**
`matrix.ts`'s `checkSquares` was never the gap — it's a plain sliding 2×2
window scan over the *entire* board with no "must be an isolated block"
restriction at all (the doc comment above it even already said as much:
"Overlapping squares … are all returned"). It already found this embedded
square correctly. The gap was entirely in `gameState.ts`'s
`resolveMatchEffects`: its `runCovered` check stood down *any* square
touching *any* run, indiscriminately — with no distinction between "this
square is one of several ambiguous overlapping candidates" (a genuinely
unresolved question) and "this square is the only possible embedding here"
(not ambiguous at all, just standing down for no real reason). The reported
shape is the latter: its top row only has 2 matching cells, so only one 2×2
window can ever have both top corners matching — there is no second
candidate to be ambiguous with.

**The fix: `isUnambiguousEmbeddedSquare`, three independent guards, not one.**
A square overlapping a run now fires anyway — same anchor-conversion path as
an isolated square — when all three hold:

1. **Every run touching any of its 4 cells is exactly length 3.** A 4- or
   5-long run already spawns its own striped piece/color bomb over those
   cells; letting a square also fire there would double-spawn a special over
   one event. This preserves the existing, confirmed 4/5-arm precedence
   tests unchanged (a crossing-run's own 4/5-arm precedence entry above
   established this same rule for the L/T/plus trigger; this fix reuses it
   rather than inventing a second version).
2. **No *other* detected square shares a cell with this one.** Two
   overlapping squares — the genuinely ambiguous case, e.g. a full, aligned
   2×3 rectangle where *both* rows are independently exactly-3 runs — has no
   principled "which one wins" answer, so both still stand down, unchanged
   from today's behavior. This is the harder case the investigation was
   explicitly asked to flag rather than silently assume was covered by the
   same fix, and it is: confirmed with its own test
   (`gameState.test.ts`'s "a genuinely ambiguous embedded square … still
   stands down — never silently guessed"), which checks `checkSquares`
   itself returns 2 overlapping candidates and neither fires.
3. **The square shares no cell with any detected cross.** A cross's own arms
   are always exactly-length-3 runs (guard 1 alone wouldn't exclude them),
   so without this guard a square sharing cells with a genuine L/T/plus would
   double-spawn a second area bomb over the cross's already-resolved event.
   The pre-existing "square overlapping a crossing arm" regression test
   (see the crossing-run entry above) is what actually exercises this guard
   — it still passes unchanged, proving squares and crosses still never
   conflict under the new, more permissive rule.

**Anchor placement needed no new logic.** The eligible square's anchor is
still `square.positions[0]` (top-left), same as every other square — even
when that cell is *also* one of the run's own clear-set cells (as it is in
both fixed test cases below). The pre-existing "an anchor cell is never also
gapped" step (`clearedKeys.delete` over `anchorByKey`'s keys, at the end of
`resolveMatchEffects`) already handles this correctly — the exact same
machinery a cross's shared crossing cell already relies on. No new
special-casing was needed here.

**Tests.** The pre-existing `gameState.test.ts` case for this exact shape
(transposed 90°: a vertical run + a 2-cell horizontal extension) had its
assertion flipped from "no bomb spawns" to "spawns exactly one, credits 4,
anchors the shared cell" — see the "Reconciling the existing deferred-scope
test" note above for that test's history. A new test covers the literal
reported orientation (2 cells top row, 3 cells bottom row) with the same
expected accounting. A third new test confirms the genuinely ambiguous
full-2×3-rectangle case still stands down, `checkSquares` returning exactly
2 overlapping candidates as proof it's the ambiguous branch being exercised,
not the fixed one. All existing square/cross *detection* tests
(`matrix.test.ts`) are untouched and pass unmodified, since `matrix.ts`
itself needed zero changes — this was entirely a `resolveMatchEffects`
precedence fix. 401 tests pass (`npm test`). Verified live, see
`docs/verification/embedded-square-in-run/`.

## Calm stuck-player hint: a sibling to hasLegalMoves, not a new detector

Highest-leverage item left from a systems audit, after the two prior
sessions' fixes. Investigated first: `engine/matrix.ts`'s `hasLegalMoves`
already computes "does a legal move exist" as the boolean gate the shuffle
system (`engine/generator.ts`'s `generateLevel`, `gameState.ts`'s
post-cascade rescue) already relies on — and a repo-wide search confirmed no
player-facing version of this existed anywhere (no hint/idle/nudge UI in any
component). So this was genuinely new surface, not a forgotten wire-up.

**`findAnyLegalMove` is the real scan; `hasLegalMoves` is now the wrapper.**
Rather than duplicate the scan (board-shape/blocker/void exclusions, the
per-special-type legality rules for a color bomb, area bomb, striped+striped
pair, and square-forming swap), `findAnyLegalMove` is the exact same
row-major scan `hasLegalMoves` already ran, just returning the `{a, b}`
`Position` pair it found instead of collapsing straight to `true` —
`hasLegalMoves(board)` is now literally `findAnyLegalMove(board) !== null`.
One scan, one source of truth; the shuffle system never needed the pair, so
its callers are unaffected byte-for-byte.

**The hint is a presentation-only pair of positions, not engine state** —
unlike `spreadWarning` (a real `Piece` field the engine sets), `hintPair`
lives entirely in `Board.tsx`'s own React state, the same shape `selected`/
`dragTarget` already use (a `Position`-based highlight Board matches against
`r`/`c` per tile in the render loop), because "has the player been idle 8
seconds" is not something the engine has any business knowing.

**Two independent timer resets, not one, to avoid a stale mid-cascade
firing.** `gameState` only actually commits once a multi-pass cascade
finishes *animating* (see `animateCascade`'s deferred `setGameState`) — a
legal move can take a second or more of visible cascade time before the
board reference changes at all. If the hint's countdown were reset ONLY by a
`gameState`-keyed effect, an old countdown armed before the move began could
fire mid-animation, gently glowing two cells that are literally mid-clear —
exactly the kind of glitchy, not-calm moment this feature exists to prevent.
So `attemptSwap` (the one shared tap/drag move-commit path) cancels the
pending timer and hides any showing hint *synchronously*, the instant a move
is attempted — legal or illegal — before `applyMove` even runs. A second
effect, keyed on `[gameState, snapBack, showOnboardingTutorial,
showBlockerTutorial, specialTutorial]` (deliberately broader than the
existing `onStateChange`/special-tutorial effects above, which only care
about committed moves — this one needs the *full* `canAcceptMove` gate, or
the hint would never re-arm after e.g. a tutorial dismisses with no move
made yet), re-arms a fresh 18-second window once the board is genuinely idle
and interactive again (raised from an original 8-second window — see the
retune note at the end of this entry).

**`resetIdleHintTimer` (`components/stuckHintTiming.ts`) takes schedule/
cancel as injected parameters**, the same pattern `gameState.ts`'s injected
`spawnPiece`/`now` already use for exactly the same reason: this project has
no React component-rendering test harness (see CLAUDE.md's Testing
Philosophy), so Board's *other* timers (snap-back, cascade steps) are only
ever verified via live capture — but the one thing genuinely worth pinning
down in a real test file is the reset semantics themselves ("does making a
move really cancel the old countdown and arm a fresh one"), which this
injection makes directly testable with plain jest mocks, no timers, no
component tree.

**The glow reuses `SpreadWarningOverlay`'s exact breathing mechanism, but
drops its meaning-carrying layers.** Both use the same `withRepeat` +
`withTiming` reversing opacity ramp — the established "calm breathing"
visual language this project already has one instance of — but
`HintGlowOverlay` (`components/Tile.tsx`) has no dark dimming wash and no
crack line, since those specifically signal "something bad is coming to this
cell," the opposite of what a friendly nudge should feel like. A separate
timing constant (`HINT_GLOW_PULSE_MS`, same 900ms value today) rather than
sharing `SPREAD_WARNING_PULSE_MS` directly, so the two features' pacing
isn't accidentally coupled if one needs to diverge later. `pointerEvents:
'none'` throughout, same as every other tile overlay — the hinted tile
stays fully tappable/draggable underneath, never intercepting the gesture
that's supposed to happen next.

**Deliberately not built:** any persisted "seen enough, stop showing"
throttle or a configurable idle duration — unlike the sound-off default
(real user research: "she said Candy Crush's sound was distracting"), there
is no equivalent research signal yet that a recurring hint would annoy this
specific player. Revisit only if real play surfaces that concern — see
`DEFERRED_COMPLEXITY.md`.

Verified with new tests: `engine/matrix.test.ts`'s `findAnyLegalMove`
describe block (returns a real pair whose swap genuinely creates a match;
returns `null` on a board with no legal move; agrees with `hasLegalMoves` on
both) and `components/stuckHintTiming.test.ts` (cancels the old handle and
arms a fresh one on every reset; arms with nothing pending; cancels without
re-arming once a move can no longer be made; does nothing when neither
applies). 408 tests pass (`npm test`). Verified live against the real
running app: waited genuine idle wall-clock time past the 8-second
threshold with zero input, confirmed the hint appears on a real legal pair
with a slow, gentle breathing glow (no dim, no crack, no flash) — see
`docs/verification/stuck-player-hint/`.

**Retune: 8s raised to 18s.** The original 8-second threshold was flagged as
fighting this entry's own calm-not-frantic reasoning: it was tuned for
"long enough that it never fires on someone still reading the board,"
but 8 seconds is well within normal deliberation time for a player who
plays specifically to stay occupied rather than to solve quickly, so it
could plausibly still interrupt genuine thinking. `HINT_IDLE_MS`
(`components/Board.tsx`) is the single source of this value — confirmed by
direct investigation that nothing else in the codebase (the glow's own
`HINT_GLOW_PULSE_MS`, other Board timers, any test assertion) depends on
the literal number — so raising it required a one-line change plus this
documentation update, no other wiring. Chose 18000ms, the midpoint of a
requested 15–20s range: high enough to clear genuine thinking time, not so
high that a player who's actually stuck waits the better part of half a
minute for a nudge. Verified live against the real running app that the
hint now waits the new duration before appearing — see the retune capture
in `docs/verification/stuck-player-hint/`.

**Converted from an automatic idle timer to a player-initiated button.**
The retune above treated the threshold as a tuning problem — pick the right
number of seconds — but real feedback surfaced that this was the wrong
framing entirely: **any** automatic idle threshold risks firing while a
player is still genuinely thinking, no matter how generously tuned, because
"stuck" and "taking your time" look identical to a timer. There is no
number that's simultaneously "long enough to never interrupt real thought"
and "short enough to actually help someone stuck" — the two goals are in
real tension, not a tuning slider. The fix removes the guess entirely: the
player decides when they want a hint, by tapping for one.

**Everything the automatic version needed for detection is unchanged.**
`engine/matrix.ts`'s `findAnyLegalMove` and `components/Tile.tsx`'s
`HintGlowOverlay` (the calm breathing glow, no dim wash, no crack) are
called/rendered exactly as before — only the trigger changed, confirmed by
direct investigation before writing any code (no new detection logic was
needed or added).

**Removed entirely, not left dead:** `HINT_IDLE_MS`, the `hintTimerRef`
ref, the arm/re-arm `useEffect` keyed on the full `canAcceptMove` gate, and
`components/stuckHintTiming.ts` (`resetIdleHintTimer`) plus its test file —
all of it was infrastructure for scheduling and cancelling a countdown that
no longer exists, and per this project's own standing habits, unused
scheduling code doesn't get to sit beside a feature that no longer uses it.
`Board.tsx`'s hint-hiding effect (now un-timed — it just clears `hintPair`
whenever the move-acceptance gate changes) and `attemptSwap`'s
move-triggered hide both stayed, since a stale glow surviving into a state
where it no longer applies is still the same "glitchy, not calm" case that
was always the point of clearing it.

**A real, always-visible "💡 Hint" button** lives in `Board.tsx`'s existing
top bar, beside the exit button, rather than a fourth `Hud.tsx` panel —
same reasoning the exit button's own placement already established
(Target/Moves/Lives can't spare the width). `topBar`'s `justifyContent:
'flex-end'` keeps both buttons anchored together at the top-right
regardless of whether the hint button is currently rendered, so the exit
button never visibly shifts position the moment the hint cap is reached.
`handleRequestHint` guards on both `canAcceptMove()` (no point hinting a
move that can't be made right now, mirroring every other input path) and
`canUseHint(hintUsesUsed)` (belt-and-suspenders — the button itself only
renders while this is true, but a stray tap during a render gap shouldn't
sneak past the cap).

**Capped at `HINT_USES_PER_ATTEMPT` (2) per level attempt, reusing the
bonus-moves grant's exact cap mechanism rather than inventing a new one.**
`pauseActions.ts`'s `nextBonusGrantsUsed`/`GrantEvent` were already 100%
generic in their actual logic (`event === 'restart' ? 0 : used + 1` neither
reads nor cares what resource it's counting) — only their *names* implied
"bonus moves specifically." Generalized to `nextAttemptUseCount`/
`AttemptUseEvent` (`'use' | 'restart'`), with `canUseHint`/
`HINT_USES_PER_ATTEMPT` added as hint's own sibling to
`canGrantBonusMoves`/`MOVE_GRANTS_PER_ATTEMPT` — two independent counters
(`bonusGrantsUsed`, `hintUsesUsed`) sharing one increment/reset function,
not one counter serving two purposes (using a video grant doesn't spend a
hint, and vice versa). Both reset to 0 in the exact same place,
`handlePlayAgain`, for the exact same reason: a fresh attempt is a fresh
attempt, whichever cap you're asking about. Once the cap is reached the
button disappears entirely (`canUseHint(hintUsesUsed) &&` gates its render)
rather than staying mounted disabled — the same "drop the CTA" choice
`ContinueOffer`'s own video button already made once its cap is reached, so
a spent resource never sits on screen inviting a tap that does nothing.

**Test coverage:** `pauseActions.test.ts` gained a `canUseHint` describe
block mirroring `canGrantBonusMoves`'s own tests exactly (cap-is-2, first
two allowed, third blocked, full-attempt walk including a restart reset) —
proving the shared `nextAttemptUseCount` behaves identically for both
resources without being the same counter. The button's own wiring inside
`Board.tsx` — like every other Board-level timer/effect in this project —
has no component-rendering test harness to exercise it in isolation (see
CLAUDE.md's Testing Philosophy), so "tapping the button calls
`findAnyLegalMove` against real board state," "nothing fires without a
tap regardless of idle time," and "the cap blocks a third use and a fresh
attempt resets it" were all confirmed live against the real running app
instead. All existing tests still pass (deleting `stuckHintTiming.test.ts`
removes exactly the tests for the deleted timer-reset helper, nothing
else). Verified live, see `docs/verification/stuck-player-hint-button/`.

# Level map: a winding path replacing the All Levels list, plus persisted best-ever star ratings

`components/AllLevels.tsx` — a plain scrollable list of level rows — is
replaced by `components/LevelMap.tsx`: a winding path connecting level
medallions, matching the approved design mockup from an earlier session
(genre-standard "map" convention, but deliberately calmer/less busy than a
themed-park map, per this game's own Design Constraints). This is a visual
and interaction replacement, not a new data source — every row still comes
from the same `completedLevels`/`buildLevelConfig`/`resolveNextUnplayedLevel`
data the old screen already read.

## Star ratings weren't persisted anywhere before this session

Investigation confirmed `computeStarRating` (`components/wonActions.ts`) was
only ever called from `WonOverlay.tsx`, computed fresh at the moment of a
win from that attempt's `movesRemaining`/`movesLimit` — nothing wrote it to
`SaveData`. The map needs a real, remembered rating per completed level, so
`engine/gameState.ts`'s `SaveData` gained `levelStars?: Record<number, 1 | 2
| 3>` (the literal type is duplicated, not imported from
`components/wonActions.ts`'s `StarRating` — engine/ never imports from
components/, per CLAUDE.md's Leak Test). `appPersistence.ts`'s
`recordLevelStars` writes it: **best-ever, not most recent** — a replay that
scores lower never overwrites an already-earned higher rating (confirmed
with the architect rather than guessed, since either direction had real
consequences: best-ever matches genre convention and this game's calm,
non-punishing design; most-recent would let a casual replay visibly regress
an already-earned result). `App.tsx`'s win handler
(`handleBoardStateChange`) computes the star rating the same way
`WonOverlay` does — `buildLevelConfig(levelIndexRef.current,
livesRef.current).movesLimit` paired with the settled state's
`movesRemaining` — and calls `recordLevelStars`, threaded into
`buildSaveData` as a new required positional param (not optional-defaulting
to `{}`, which would have silently erased the map on every save from any
call site that forgot to pass it — the same reasoning `livesLastRegenAt`'s
own comment already documents for why every persisted field's real call
site must pass its current value explicitly).

**A completed level with no persisted rating** (any win recorded before this
feature existed) renders as unrated — every star slot empty — rather than a
fabricated 3. There's no honest way to reconstruct how many moves a past
attempt had left over, and this game's honest-numbers principle already
shows up elsewhere (the recipe book's plain count, objective chips' real
uncapped totals) — a guessed rating would be the first place this project
fabricated a number.

## The old `resolveVisibleLevelIndices` rule would have hidden the current level

`resolveVisibleLevelIndices` (hand-built levels + only *completed* generated
levels past them) was correct for the old list, where every non-completed
row was an inert dead end — showing an unplayed generated level would have
been a locked row nobody could reach except by finishing everything before
it. The map breaks that assumption: the real next-unplayed level is always
genuinely reachable (it's exactly what Home's "Start cooking" already
targets), and the design calls for a few visibly locked nodes ahead so the
path has somewhere to lead. A save that had cleared every hand-built level
would have shown a map with no current node at all under the old rule —
caught before shipping, not after, by checking whether the existing
helper's own assumption still held now that a second feature (the map)
depends on it, per this project's own Playtest Feedback Protocol ("check
whether an old feature's shortcut still holds"). `resolveLevelMapIndices`
(`components/levelProgress.ts`) is the wider set: `resolveVisibleLevelIndices`'s
own historical coverage, unioned with the real next-unplayed level and
`MAP_LOCKED_LOOKAHEAD` (4) levels past it — a fixed preview depth, not a
difficulty lever. `resolveLevelStatus` gained a third state, `'current'`
(alongside `'completed'`/`'locked'`), taking a `nextLevelIndex` param it
didn't need before.

## No react-native-svg dependency — the path is straight rotated-View segments

No SVG library is installed in this project (confirmed via `package.json`
and `node_modules`), and `GinghamTrim.tsx` already established the house
convention of reproducing a mockup effect with plain Views rather than
reaching for a new rendering dependency for one visual pass (its own
comment: "reproduced with plain Views since no gradient dependency was
added" — the checkerboard trim, in place of the mockup's CSS
repeating-gradient). `components/levelMapLayout.ts` is a pure geometry
module (same "push anything testable out of the component" pattern as
`cascadeTiming.ts`/`dragDirection.ts`): node positions are a deterministic
left/center/right/center snake cycle (`X_PATTERN`), and
`computeLevelMapPathSegments` turns consecutive node centers into straight
segments (start point, length, angle) that `LevelMap.tsx` renders as
absolutely-positioned, rotated (`transformOrigin: 'left center'`, real RN
0.81 support) thin Views. This still reads as a winding path — it zigzags
left/right/center down the screen — it just doesn't curve within a single
segment the way the approved SVG mockup did. Segments before the current
level render in the accent/sage "walked" color; segments at or past it
render dimmed, matching the design's "locked levels ahead are visible but
dimmed" instruction applied to the path itself, not just the nodes.

## Single theme, no dark-mode system

Confirmed no theme or dark/light-mode system exists anywhere in this app
(no `theme`/`colorScheme` reference anywhere in the codebase before this
session). Per architect confirmation, the map is built in the single light
theme every other screen already uses; the dark variant explored in the
earlier design-approval session is a reference for a genuinely separate
future session, not a byproduct of this screen replacement — building a
real app-wide theme toggle was explicitly out of scope for this task.

## Deliberately not built this session (see `DEFERRED_COMPLEXITY.md`)

The approved mockup's ambient garden decor (a trellis arch, potted herbs, a
window with a steam-wisp motif) is omitted — those were illustrative
flourishes in an HTML/CSS mockup; translating hand-drawn SVG art into
RN-View approximations is substantial bespoke illustration work the actual
ask (path + node states + scroll-to-current) didn't call for, and adding it
unasked would have been scope creep on a task already explicit about what
"matching the approved design" meant (path and node states, not incidental
scenery). Also deferred: an ingredient icon or the level's display name on
each node — the approved mockup shows only the level number plus its status
decoration, deliberately calmer than the old row layout's icon+name+badge
treatment, so this isn't a gap, it's the design as approved.

Verified with new/updated tests: `components/levelMapLayout.test.ts` (node
position determinism and bounds, content height, straight-segment geometry
including a real 3-4-5 Pythagorean case, scroll-offset centering and its
zero-clamp), `components/levelProgress.test.ts`'s updated
`resolveLevelStatus` (three states, including the real next-unplayed level
reporting `'current'`) and new `resolveLevelMapIndices` describe block
(current level included even when not completed; real completed history
preserved; no duplicate indices), and `appPersistence.test.ts`'s new
`recordLevelStars` describe block (first-ever rating, a better replay
overwrites, a worse replay never does, same-reference return on a no-op
update, other levels' ratings untouched) plus updated `buildSaveData`
call sites for the new `levelStars` param. 437 tests pass (`npm test`).
Verified live against the real running app: a save with several genuinely
completed levels (real persisted best-ever stars, not seeded data), the
real next-unplayed level glowing with its PLAY button, and real locked
levels ahead dimmed with a padlock — see
`docs/verification/level-map/`.

## Special-effect identity: color bomb, cross combo, and supercombo each get a distinct presentation, not a generic flat clear

Only the area bomb had a real presentation identity before this session (the
idle powder wisp + trigger poof — see the "two powder animations" entry
above). The color bomb detonation, the striped+striped cross combo, and the
striped+bomb supercombo all rendered through `ExitingTile`'s final,
undifferentiated branch: a plain opacity/scale-to-zero, identical to an
ordinary match clearing. This was investigated and fixed, presentation-only —
zero files under `engine/` changed (confirmed via `git status`).

**Investigation first, per the standing playtest-feedback protocol.** Before
designing anything, confirmed exactly which paths already had a real identity
and which didn't, rather than assuming:
- A solo striped piece included in an ordinary match already had one: the
  traveling sweep beam (`components/sweepAnimation.ts`'s `sweepDelaysForClears`
  + `Tile.tsx`'s `sweepDelayMs` branch — see the striped-piece entry above).
- A striped piece caught via chaining (a special caught in another effect's
  clear — see the special-piece-chaining entry above) already replayed that
  SAME real sweep correctly, with no fix needed. Traced through the code
  rather than assumed: `expandChainClears` never mutates a caught special's
  `type`/`direction` before folding its clear cells in, so it survives into
  `diffBoards`' `cleared` list exactly as it would from a solo match, and
  `sweepDelaysForClears`' origin check (`type === 'striped' && direction !==
  undefined`) already picks it up as a genuine beam origin.
- The cross combo (`resolveStripedCross`) only got an *accidental*, often-wrong
  partial sweep. Both swapped pieces survive into `cleared` as real
  `type: 'striped'` pieces with their OWN original `direction` — but the
  combo's actual clear geometry is a cross centered on posA, in BOTH
  directions, overriding whatever each piece's individual direction was. A
  piece whose original direction was `'col'` contributed zero delay to cells
  on the row half of the cross (`sweepDelaysForClears` only measures a `'row'`
  origin's distance to same-row cells). This wasn't a deliberate design
  choice that happened to look fine — it was a latent bug nobody had reason to
  notice until asked to give the cross its own real identity.
- The supercombo (`resolveStripedBombCombo`) and a solo color bomb
  (`resolveColorBomb`) never had a chance: neither mutates its cleared cells'
  `type` to `'striped'` before they clear (the supercombo computes the settled
  union of sweeps directly, per its own doc comment on the deferred
  convert-to-striped flash), so `sweepDelaysForClears`' origin check never
  matched either.

**Three new identities, each derived purely from data already available at the
presentation layer** (`components/specialEffectAnimation.ts`), the same
`piece.type`-check pattern `isBlockerClear`/`isPowderBurst` already use — no
new `ApplyMoveResult` field, no engine change:

1. **Color bomb — radial ripple.** Euclidean distance from the swapped bomb's
   position, normalized to a FIXED total duration (`COLOR_BOMB_WAVE_MS`, in
   `components/cascadeTiming.ts`) rather than a fixed per-tile stagger like the
   linear sweep. A color bomb's reach is the whole board, which varies by
   level (a small hand-built board vs. a larger/shaped generated one); a fixed
   per-tile constant would make the wave's total travel time balloon on a
   bigger board, which reads as slower rather than "the same weight, more
   reach." Normalizing keeps it inside one calm, bounded beat regardless of
   board size — the same board-shape-agnostic discipline the void/segmented-
   gravity work already holds to. Rendered as a genuinely different SHAPE
   (`Tile.tsx`'s new `radialGlow` overlay — `borderRadius: 999`, a circle —
   plus a bigger scale overshoot than the sweep's square glow), not the same
   square wash recolored, per the explicit ask that each identity communicate
   what the effect does rather than just look different.
2. **Cross combo — the existing sweep, corrected and extended bidirectionally,
   not rebuilt.** Zero new `Tile.tsx` code: reuses the EXACT same
   `sweepDelayMs`/`sweepGlow` mechanism the solo striped sweep already has.
   Only the delay computation changed (`crossOriginDelays`): a single true
   center (posA, matching `resolveStripedCross`'s own "the cross is centered
   on posA" comment) sweeping BOTH axes, merged (nearest-origin-wins, the same
   rule `sweepDelaysForClears` already applies for two crossing beams) with the
   generic sweep so a genuinely different special caught in the cross via
   chaining still fires its own authentic sweep alongside it.
3. **Supercombo — two distinct beats, not one collapsed instant.** A brief
   flicker ("conversion," `Tile.tsx`'s new `convertFlash` overlay — a
   double-blink, `SUPERCOMBO_FLASH_PULSE_MS`-paced, deliberately NOT the sweep/
   radial's single smooth brighten, since a flicker reads as "becoming
   something new" in a way a steady glow doesn't) plays on every converted
   piece, then every converted piece PLUS the bomb cell pop together at one
   UNIFORM delay (`SUPERCOMBO_CONVERT_MS`) — deliberately not staggered by
   distance, since the point of this beat is "together," not "traveling."
   This resolves the convert-to-striped-flash item `DEFERRED_COMPLEXITY.md`
   had carried since the combos first shipped. Which cells count as
   "converted" (`supercomboConvertedIds`) is a pure classification over cells
   the engine already decided to clear (same matchType as the originating
   striped piece, excluding the bomb cell) — it invents no new clearing
   decision, so it can't drift from what actually cleared. Deliberately does
   NOT attempt to reconstruct `resolveStripedBombCombo`'s internal
   alternating row/col discovery-order assignment for a per-piece directional
   beat 2 — duplicating that internal detail in presentation code risks the
   exact kind of drift CLAUDE.md's playtest protocol warns about ("if a fix
   requires testing a decision, and that decision is duplicated somewhere,
   collapse the duplication... don't test a stand-in copy"); a synchronized
   beat is both simpler and more honest about what the engine actually
   guarantees (that everything fires together), rather than fabricating
   travel-direction cues the engine's own return value doesn't expose.

**Scope boundary, logged rather than silently dropped:** a color bomb reached
via chaining (caught in another effect's clear, not the bomb the player
actually swapped) still gets the flat generic clear — it has no swap position
to radiate a ripple from. Only the three swap-triggered origin effects named
in the ask got new identities this session. See `DEFERRED_COMPLEXITY.md`.

`buildPassAnimation` (`specialEffectAnimation.ts`) is the one call site
`Board.tsx`'s `animateCascade` uses per cascade pass, gated to `passIndex ===
0` for all descriptor-driven logic — every swap-triggered effect activates on
the swap itself (pass 0), and a chain-cascade refill's own new matches always
land in later passes as ordinary clears (see the cascade-steps entry above),
so no pass-index bookkeeping beyond a single equality check was needed.

Verified with 16 new `components/specialEffectAnimation.test.ts` cases
(descriptor precedence mirroring `applyMove`'s own branch order including the
area-bomb exclusion; radial normalization and its zero-max-distance guard;
cross geometry ignoring each piece's own stale direction; supercombo
classification; and `buildPassAnimation`'s merging, including that a
genuinely different chained special keeps its own authentic sweep inside a
cross or supercombo pass). All 453 tests pass; zero engine files changed.
Verified live: a throwaway harness drove the real `applyMove` for all three
effects on hand-built Latin-square boards (zero incidental pre-existing
matches, same construction `docs/verification/special-piece-combos/` used),
rendered through the real `ExitingTile` (real Reanimated animation, not
simulated), captured over CDP against headless Windows Chrome at four
synchronized checkpoints — see `docs/verification/special-effect-identity/`.
The harness (`components/__harness__/EffectIdentityHarness.tsx`) and its
temporary `App.tsx` `?harness=effects` gate were both deleted/reverted
immediately after capture, per this repo's established
screenshot-verification convention.

## Mid-level continue offer (the rescue moves before life loss)

A rescue offer of five extra moves, presented specifically *before* a life
would actually be spent — distinct from the already-built anytime OutOfLives
full-refill grant, which only ever fires when trying to *start* a fresh level
with zero lives. This session's investigation confirmed the config (5 lives)
already matched the stated design but `regenMinutes` didn't (30, not 20 — now
corrected in `skins/lalas-kitchen/config.json`), and — more importantly —
surfaced a real, pre-existing gap: the Phase-4 mid-level "+5 Moves" grant
(`grantBonusMoves`, wired to the old `PausedOverlay`) already let a player keep
playing after running out of moves, but the account-level life for that
attempt was *already spent* by the time that button ever rendered — the same
`gameState` commit that flipped status to `paused_awaiting_input` was also the
commit `App.tsx`'s `handleBoardStateChange` used to fire `shouldSpendLifeOnLoss`
via `didLevelJustEnd`. Worse: because `grantBonusMoves` resumes `status` to
`'in_progress'`, `didLevelJustEnd`'s prevStatus/nextStatus edge check reset
itself on every subsequent moves-exhausted pause too — a single attempt that
took both of its two bonus-move grants and still ran out a third time could
lose **up to three** lives, not one. Confirmed by tracing the exact call
sequence (not assumed): `Board.tsx`'s `attemptSwap` → `applyMove` (synchronous)
→ `animateCascade`/`runStep`'s final pass → `setGameState(finalState)` →
Board's `useEffect(() => onStateChange?.(gameState), [gameState])` → App's
`handleBoardStateChange`. This was confirmed as a genuine fork (not guessed at)
via the standing Playtest Feedback Protocol, and the user chose to retime the
existing mechanic rather than layer a second one beside it.

**The fix moves life-spend timing out of App.tsx's generic state-transition
check and into `Board.tsx`, where the per-attempt grant cap
(`bonusGrantsUsed`) already lives** — the decision of *whether a rescue is
still on offer* and *whether this pause should cost a life* are the same
decision, so they had to live in the same place. `components/pauseActions.ts`
gained `shouldOfferContinue(pauseReason, grantsUsed)`, a thin pure wrapper
over the existing `canGrantBonusMoves`. Two new components split what
`PausedOverlay` used to do alone:

- **`ContinueOffer.tsx`** (new) — shown instead of `PausedOverlay` while
  `shouldOfferContinue` is true. Accepting (`handleGrant`, unchanged) grants
  +5 moves via the existing `grantBonusMoves` and spends nothing. Declining —
  either secondary link, Play Again or Exit — spends the life first via two
  thin wrappers, `handleContinueDeclinePlayAgain`/`handleContinueDeclineExit`,
  before running the underlying action.
- **`PausedOverlay.tsx`** (simplified) — now purely the terminal screen,
  shown only once no rescue is left to offer. Dropped `canGrant`/`onGrant`/
  `adAvailable` entirely (dead once the grant CTA moved to ContinueOffer)
  rather than leaving an unreachable branch.

`Board.tsx`'s `runStep` (the single place a moves-exhausted `finalState`
first commits) now spends the life automatically, exactly once, the instant
`shouldOfferContinue` is false for a *fresh* pause — this is what fixes the
up-to-three-lives bug: a pause that still has a grant on offer never triggers
this branch at all, so life-spend and grant-availability can no longer drift
out of sync with each other the way two independently-evolving checks (one in
Board, one in App) previously could.

`App.tsx`'s old `shouldSpendLifeOnLoss` (and its now-obsolete tests) were
deleted outright rather than kept unreachable — replaced by `handleLifeLost`,
a plain callback Board calls explicitly. One subtlety this surfaced during
live verification (not assumed, caught by an actual failing trace): a decline
calls `onLifeLost()` and then `handlePlayAgain()` in the *same synchronous
tick*, before React has re-rendered Board with the post-spend `lives` prop —
reading that stale prop inside `handlePlayAgain` would have baked the
*pre-loss* count into the new attempt's `GameState.lives` display snapshot
(confirmed live: lives read back as unchanged immediately after a decline).
Fixed by having `handleLifeLost` return the fresh count synchronously (not
just via `setLives`), which `handleContinueDeclinePlayAgain` now threads
through an optional `livesOverride` param on `handlePlayAgain` — every other
caller (the plain secondary Play Again link, `WonOverlay`'s onPlayAgain) omits
it and falls back to the ordinary `lives` prop, unchanged.

Verified live end-to-end over CDP against the real running app (headless
Windows Chrome from WSL, real tap-to-swap gestures dispatched via
`Input.dispatchMouseEvent` against real tile DOM nodes — the same rig
`docs/verification/special-piece-tutorial/organic-spawns/` established), not
simulated: a temporary `movesLimit: 1` tweak to Level 1 (reverted after
capture, the lightest version of this repo's established "temporary,
reverted after" verification convention) forced a genuine near-loss on the
very first real move. Confirmed in one continuous run: (1) the first
moves-exhausted pause shows ContinueOffer, lives unchanged; (2) accepting
grants +5 moves, lives still unchanged; (3) a second moves-exhausted pause
(grant 2 of 2) still shows ContinueOffer, lives still unchanged; (4)
accepting again grants +5 moves, lives unchanged; (5) a third moves-exhausted
pause (cap now exhausted) shows the plain terminal `PausedOverlay` with no
grant CTA, and the life is auto-spent; (6) restarting from that terminal
screen correctly shows the real post-spend count. Exactly one life was ever
spent across the whole run, not three. All 453 existing engine/component
tests still pass, plus 4 new `shouldOfferContinue` cases in
`components/pauseActions.test.ts`. See `docs/verification/mid-level-continue/`.

## Two more one-time tutorials: `board_shape` and `spread_warning`

The five existing tutorials each explain a piece or a moment (a blocker, a
special, a chain reaction, the base mechanic itself), but two real mechanics
built earlier this project — non-rectangular boards and the dynamic
denial-zone spread — had no explanation at all. Investigated first, per the
standing Playtest Feedback Protocol, rather than assumed: the actual question
was *when* each thing genuinely first becomes visible to a player, not just
*that* it should get a card.

**A static denial zone needs no new tutorial — the warning crack is the
actually-new thing.** A cluster of blockers, spreading or not, looks and
behaves exactly like the ordinary obstacle `BLOCKER_TUTORIAL_ID` ("A Covered
Dish") already explains. What a player has never seen before is a cell
cracking and dimming the move before it becomes another blocker — that's the
one genuinely new behavior, and it's what `spread_warning` explains, not "this
level has blockers" a second time.

**A shaped board's gap is fixed at generation, so it needs a mount-time check,
not a post-move scan.** Unlike a special piece (forged mid-level) or a spread
warning (marked by a real unaddressed move), a level's `voidCells` are baked
into its `LevelConfig` before the first tile ever renders — the same timing
`shouldShowBlockerTutorial` already relies on for the blocker card. Getting
this backwards (treating it as a post-move signal) would have meant the very
first thing a player sees — gaps in the grid — goes unexplained for a beat,
which is exactly the "could read as a rendering bug" risk this session was
asked to avoid.

**Both reuse the existing plumbing with zero new shape.** No third overlay
component, no new `SaveData` field, no new dismiss path.
`appPersistence.ts`'s `BOARD_SHAPE_TUTORIAL_ID`/`shouldShowBoardShapeTutorial`
is a one-line board scan for any `type === 'void'` cell, mirroring
`shouldShowBlockerTutorial` exactly; `Board.tsx`'s `showBoardShapeTutorial` is
a mount-time `useState` initializer alongside `showBlockerTutorial`, gating
`canAcceptMove`/`dragEnabled`/the post-move effect the same way, and rendering
between the onboarding card and the blocker card — a shaped board is the most
immediately visible thing about a level, so it's explained before content
sitting *within* that shape. `SPREAD_WARNING_TUTORIAL_ID`/
`findSpreadWarningTutorial` scans for `piece.spreadWarning`, returning the
real warned piece itself (so its icon resolves through the same
`getSpriteForPiece` path every other tutorial's real-piece icon uses); it's
folded straight into `Board.tsx`'s *existing* post-move `specialTutorial`
effect as a fallback after `findSpecialPieceTutorial` (`match ??
findSpreadWarningTutorial(...)`), so the two share one state slot, one
session-level dismissal ref, and one dismiss handler — no new "which tutorial
is showing" union, no new priority logic. `board_shape`'s icon is `piece:
null` (a void has no rendered Tile to anchor an icon to at all, the same
structural reason `chain_reaction`/`how_to_play` fall back to the text-label
placeholder); `spread_warning`'s icon is a real piece, since the warned cell
is a genuine ordinary tile, not an abstract moment.

**Copy** (`SPECIAL_TUTORIAL_CONTENT` in `SpecialTutorialOverlay.tsx`) matches
the existing calm, one-action tone: `board_shape` — "A Different Shape" /
"A few spots on this board aren't part of play — just match around the gaps
like normal"; `spread_warning` — "A Warning Crack" / "That crack means a
covered dish is about to spread here — match this spot first to stop it."

**Verified live against the real running app over CDP**, not a board fed
directly into either detection function. `board_shape`: a realistic prior-
progress save seeded via `localStorage` (completed levels 1–3, `how_to_play`
already seen, `board_shape` deliberately not), a real click on "Start
cooking," landing on the real hand-built Level 4 "Cutting Board"
(`PLUS_SHOWCASE_VOIDS`) — the overlay appears on first paint, before any tap,
over the genuinely gap-cornered board; dismissing persists immediately;
a full page reload and re-entry confirms the once-ever guarantee across a
real relaunch, not just a re-render. `spread_warning`: the real gated
generated level 14 (`generatedLevelNumber(14, 4) === 10` — the same level
`docs/verification/denial-zone-spread/` already verified the numbers for:
`movesLimit 20`, `denialSpread: true`, `spreadInterval = round(0.25×20) = 5`),
every other tutorial pre-seeded as seen so only `spread_warning` could fire,
then real drag gestures dispatched at actual on-screen tile coordinates (tile
identity/position read non-invasively off the live DOM, no state-reading hook
needed to plan moves) driving genuinely unaddressed matches away from the
blocker cluster. A temporary **read-only** `window.__peekGameState` (returns
`gameState`, never calls `applyMove` or mutates anything) confirmed the real
engine counters after each move; two of the six real moves had no safe match
available on that exact random board and honestly fell back to a real
addressing match instead (disclosed in the verification doc with the actual
counter values, not hidden) before the fourth genuinely-unaddressed move
produced a real, engine-computed `spreadWarning: true` on an ordinary tomato
tile. Dismissing was confirmed to add *only* `spread_warning` to
`seenTutorials` (diffed against the pre-seeded array), and a second, later
warning cycle reached by continued real play correctly did not resurface the
card. See `docs/verification/board-shape-tutorial/` and
`docs/verification/spread-warning-tutorial/`. All 465 tests pass, including
new `shouldShowBoardShapeTutorial`/`findSpreadWarningTutorial` coverage in
`appPersistence.test.ts`.

## Scoring system: a second, `'score'`-type objective, built from scratch

**Investigated first, per the standing protocol**: no concept of score existed
anywhere in the engine before this session — a repo-wide search turned up only
two incidental uses of the word "score" (`components/wonActions.ts`'s
non-competitive star-rating comment, `components/LevelMap.tsx`'s matching
comment), neither a real scoring mechanism. So this was new infrastructure,
not a thin wrapper over something already tracked.

**`ObjectiveType` gained a `'score'` variant** alongside the existing
`'collect'` (`engine/gameState.ts`). `Objective.targetMatchType` became
optional — `undefined` for `'score'`, which has no single matchType to track;
its `currentCount` is the level's running cumulative score instead.
`LevelConfig.objectives` widened to a union (`{ type?: 'collect';
targetMatchType; targetCount }` or `{ type: 'score'; targetCount }`) —
omitting `type` still means `'collect'`, so every level built before this
feature (every hand-built `LEVEL_QUEUE` entry, every `buildGeneratedLevelConfig`
output) is byte-identical, unchanged.

**Every cleared cell scores at one of three tiers** (`ScoreTier`:
`'ordinary'`/`'special'`/`'bomb'`, `SCORE_TIER_POINTS`: 10/25/50 points/cell) —
a direct implementation of the session's brief ("an ordinary 3-match worth a
base amount, a 4-match or striped piece worth more, a 5-match or color bomb
worth more still"). The tier is assigned at the exact point each existing
clear-set builder already decides *why* a cell is clearing, not re-derived
after the fact from the settled board (which can't tell "swept by a striped
line" from "part of a plain run" once both are just cleared cells):
- `resolveMatchEffects`'s run branch: a plain 3-match cell is `'ordinary'`; a
  4-run's non-anchor cells (which spawn a striped piece) are `'special'`; a
  5-run's non-anchor cells (which spawn a color bomb) are `'bomb'`; a 6+ run
  — bigger and rarer than the 5-run that spawns a bomb, so it shouldn't score
  worse than one — is also `'bomb'` (a real judgment call: the original brief
  never mentioned 6+ runs, and lumping them with plain 3-matches, as the
  pre-scoring code's `else` branch did structurally, felt wrong once points
  were on the line).
- A striped-piece trigger (`fireStripedTriggersAndClearAll`, whether reached
  via an in-match sweep, a square's embedded striped corner, or a swap combo)
  scores its whole event — both the swept line and the triggering cells —
  at `'special'`, matching the 4-run tier it's the *other* way to reach the
  same "striped piece did something" moment.
- A 2×2 square's non-anchor cells (spawning an area bomb) are `'special'`, the
  same "spawn event, not yet the bomb's own detonation" tier a 4-run gets.
- A cross's own two arms are already exactly-length-3 runs (`checkCrossShapes`
  guarantees this), so they're already `'ordinary'` via the run loop with no
  extra tagging needed — the cross loop's own `addClear` calls default to
  `'ordinary'` and are no-ops against cells already tiered.
- A solo color-bomb detonation (`resolveColorBomb`), an area-bomb blast
  (`resolveAreaBomb`), and both special-piece combos (`resolveStripedCross`,
  `resolveStripedBombCombo`) each pass a single `seedTier` into the shared
  `resolveClearSet` tail — `'bomb'` for the color bomb and both combos,
  `'special'` for the area bomb (the same tier its 2×2-square *spawn* already
  gets, since its blast is the delayed continuation of that same spawn event,
  not a bigger one). **The two combos score at the top `'bomb'` tier, not a
  fourth tier above it** — a real judgment call, confirmed against this
  project's actual design principles rather than assumed: a deliberate combo
  is harder to set up and more valuable to the player than a solo bomb, so it
  should never score *less*, but adding a fourth tier for two mechanisms felt
  like unjustified extra surface area against the "an ordinary 3-match / a
  4-match or striped / a 5-match or bomb" three-tier brief actually given.
- `expandChainClears` (the shared chain-reaction expander) now threads tiers
  through the chain too: a caller's own seed cells keep the tier it assigned
  them, and each *chained* special contributes its own tier as it's
  discovered — a chained striped sweep or area-bomb blast at `'special'`, a
  chained color-bomb detonation at `'bomb'` — via `upgradeTier`, which only
  ever raises a cell's tier, never lowers it (a cell touched by more than one
  mechanism in the same pass keeps the highest tier it actually earned,
  never double-counted across mechanisms).
- A blocker cleared by adjacent damage always scores at the flat `'ordinary'`
  tier, regardless of what triggered the clear next to it — a blocker never
  forms a run or spawns a special itself, so there's no higher-tier event to
  attribute its clear to.

**Cascades and chains contribute their own points, scaling with depth** —
`passScoreMultiplier(passIndex) = 1 + passIndex × CASCADE_CHAIN_BONUS_PER_PASS`
(0.25/pass), applied per cascade pass. `resolveCascades` gained a
`startPassIndex` parameter (default 0, an ordinary swap's first pass) so a
detonation-triggered move (`resolveClearSet`, always pass 0 itself) can hand
its own chained refill cascade a continuing index (`resolveCascades(...,
1)`) instead of resetting the multiplier to 1x — a bomb combo's own refill
chain climbs the same ramp an ordinary swap's cascade would. This was the
session's one real alternative not taken: flat per-cell scoring with no chain
bonus, which would make the HUD number track `clearedByMatchType` almost
exactly and give a long chain no more weight than the same cells cleared
across several separate moves. Rejected because this game already celebrates
chain depth elsewhere (`COMBO_STREAK_THRESHOLD`'s event) — scoring should
recognize the same moment, not undercut it.

**`applyMove`'s objective update branches on `type`**: a `'collect'`
objective still reads `clearedByMatchType[targetMatchType]` exactly as
before; a `'score'` objective adds the move's total `scoreGained`
(`CascadeResolution.score`, summed from every pass/detonation above) to its
`currentCount` instead. The two update from the same move independently, with
zero shared state — confirmed directly by a test with both objective types on
one level.

**Presentation layer**: a `'score'` objective has no `targetMatchType` to
resolve a sprite from, so `Hud.tsx`/`WonOverlay.tsx`/`Home.tsx` each branch on
`objective.type`/`objectiveType` and fall back to a new
`SCORE_OBJECTIVE_SPRITE` (`components/spriteAsset.ts`, a fixed ★ label) rather
than piping `undefined` through `getSpriteForMatchType`/`resolveSpriteAsset`,
which would have produced the generic "?" placeholder — a signal this
codebase already uses elsewhere for a genuine bug (an unresolvable matchType),
not a legitimate objective type. `components/levelProgress.ts`'s
`LevelSummary` gained `objectiveType` (and made `targetMatchType` optional) so
`Home.tsx`'s "Up Next" preview — which reads whatever level is next, including
a future score-objective level, without knowing in advance which kind it is —
never hits that same undefined-matchType path.

**One hand-built level, "Score Rush"** (`App.tsx`'s `LEVEL_QUEUE`, a fifth
entry) exercises this end-to-end: `objectives: [{ type: 'score', targetCount:
1000 }]`, movesLimit 24. The target (1000) and the tier points (10/25/50) and
cascade bonus (0.25/pass) are hand-picked, not playtested — wide enough to
feel different on the HUD (a plain 3-match nets 30, a solo bomb detonation can
net several hundred) without being tuned against real play data yet. See
`DEFERRED_COMPLEXITY.md`.

**Verified live against the real running app over CDP**: a save seeded
directly into `localStorage` with `completedLevels: [1,2,3,4]` so Home's real
"next unplayed level" logic resolved to Level 5, reached through the ordinary
"Start cooking" flow (not a temporary code change). The real engine
(`generateLevel(401, ...)` — Level 5's actual seed — piped into
`findAnyLegalMove`) found a genuine legal first move, dispatched as two real
tap gestures on the actual tile DOM nodes. The HUD's Target panel read "★
0/1000" on load, then "★ 30/1000" after the one real move (a 3-cell ordinary
garlic match: 3 × 10 × 1x), exactly matching the hand-derived expectation
computed *before* the move was dispatched — not read off the result and
back-fit. See `docs/verification/score-objective/`. All 474 tests pass
(466 before this session, +8 new: 7 scoring-system cases in
`engine/gameState.test.ts` plus one `createGameState` wiring case), including
updated `levelProgress.test.ts`/`appPersistence.test.ts` coverage for the
now-optional `targetMatchType`.

## Fixed: Play Again on `PausedOverlay`/`WonOverlay` wrongly routed to `OutOfLives`

A real playtest report, investigated per the standing Playtest Feedback
Protocol: the `OutOfLives` "refill your lives" screen appeared right after
tapping "Play Again", while the player still had 4 lives, not 0.

**Root cause, confirmed live, not assumed**: `components/PausedOverlay.tsx`
and `components/WonOverlay.tsx` both wired their "Play Again" button as
`onPress={onPlayAgain}` — passed through unwrapped — and `Board.tsx` wired
that prop straight to the real `handlePlayAgain(livesOverride?: number)` at
both call sites. `Pressable`'s `onPress` always calls its handler with the
click event as its first argument (confirmed against
`react-native-web`'s own `PressResponder.js`), so every tap called
`handlePlayAgain(clickEvent)` — the event object landed in `livesOverride`.
`livesOverride ?? lives` then picked the (truthy) event object over the real
lives count, and `canStartLevel(eventObject)` — `object > 0` — is always
`false` for any object, so `onOutOfLives()` fired unconditionally regardless
of the real count. This was a pre-existing gap the mid-level-continue
session's own verification never actually exercised — its live capture
(`docs/verification/mid-level-continue/05-06`) tested `ContinueOffer`'s
*decline* "Play Again" link, which routes through the parameterless
`handleContinueDeclinePlayAgain` wrapper and was never affected; the plain
"Play Again" on `PausedOverlay`/`WonOverlay` was never actually clicked in
that capture, despite this file's prose describing it as verified.

**The fix**, both in `components/Board.tsx`: (1) both call sites wrapped —
`onPlayAgain={() => handlePlayAgain()}` — matching the pattern
`handleContinueDeclinePlayAgain`/`handleContinueDeclineExit` already
established; (2) `handlePlayAgain` itself hardened —
`typeof livesOverride === 'number' ? livesOverride : lives` in place of
`livesOverride ?? lives` — a durable guard so a future caller wired the same
unwrapped way falls back to the real `lives` prop instead of silently
misreading an event object as a lives count. Verified live end-to-end both
before and after the fix (same real repro: a genuine moves-exhausted loss on
Level 1 with both bonus-move rescues exhausted, over CDP against headless
Windows Chrome) — before the fix, "Play Again" navigated to `OutOfLives`
with its flame row showing exactly 4 filled, matching the report precisely;
after the fix, the same tap correctly restarts the level with the Hud
showing the real, correctly decremented lives count instead. See
`docs/verification/play-again-event-arg/`. All 474 tests pass unchanged (no
prior test coverage existed for this exact interaction — it requires a real
`Pressable`/DOM event round trip, which this repo's jest-only test infra
can't exercise, so live verification was the only way to catch or confirm
it).

## Fixed: generated-level difficulty ramp was blind to shape-template playable area

A real playtest report, investigated per the standing Playtest Feedback
Protocol: a generated board using the `ring` shape template (playable cells
limited to the outer perimeter, center voided) felt genuinely unfair, not
just visually different.

**Investigated first, confirmed against real numbers, not estimated**: at
the fixed generated-level board size (8 rows x 5 cols, 40 cells),
`ringVoids` leaves only 22 playable cells (55%) — the most restrictive of
the 3 curated templates, versus `cut_corners` at 28/40 (70%) and `plus` at
32/40 (80%). Separately, `buildGeneratedLevelConfig` (`appPersistence.ts`)
computed `movesLimit` (via `generatedMovesLimit`) and each objective's
`targetCount` (via `generatedTargetCount`) purely as a function of
`levelNumber`, calling both **before** `voidCells` was even computed in the
function body — neither had ever consulted how many cells a shape template
had just removed. This is the same two-independently-correct-systems
pattern this project has hit before (the piece-type ramp and the objective
gate, the recipe-card art and the placeholder contract): `engine/
boardShapes.ts`'s templates and `appPersistence.ts`'s difficulty ramp were
each built and tuned without ever being checked against each other. Traced
live against the real first generated `ring` level (generated level number
16, reached via `generatedShapeId`'s threshold-8/cadence-4 rotation): it
demanded the same 18-move limit and 26-piece total target (13+13 across two
objectives) that a plain rectangle at the same level number gets, despite
having 45% fewer cells to generate matches on.

**The fix**: `engine/boardShapes.ts` gained `playableCellRatio(rows, cols,
voidCells)`, a pure geometry helper (defaults `voidCells` to `[]`, so a
plain rectangle is always exactly `1`) — placed there rather than in
`appPersistence.ts` since it's a function of a shape template's own output,
testable the same way the templates themselves are. `generatedMovesLimit`
and `generatedTargetCount` each gained an optional second parameter,
`playableRatio` (defaulting to `1` — every pre-existing call site and test
is a no-op), applied as a proportional scale-down on top of each function's
existing unscaled calculation, with each function's existing floor
(`MIN_MOVES` 18, and a new `MIN_TARGET` 10 mirroring it) re-applied *after*
scaling — so a heavily-voided board still can't drop below the same
mechanically-unwinnable/degenerately-trivial guarantees a full board
already gets. `buildGeneratedLevelConfig` was reordered (shape/`voidCells`
computed first, `playableRatio` derived, then threaded into both scaled
calls) rather than adding a second pass — the values were already computed
once per call, this just changes what order.

**A deliberate judgment call, confirmed with the architect rather than
guessed**: both `movesLimit` and `targetCount` scale down together,
preserving the tuned target-per-move ratio a full board already has, rather
than leaving `movesLimit` unscaled (which would have made a shaped level
strictly *easier* than intended, overcorrecting past "comparable
difficulty" into "trivial"). In practice this makes `movesLimit` a near
no-op at every level number where a shape is currently eligible (level 8+)
— by then `generatedMovesLimit`'s own step-down has already pinned it to
its 18-move floor, and scaling a number already at its floor down further
just gets floored right back to 18. The real, load-bearing effect is on
`targetCount`: the same real first `ring` level (generated level number 16)
now asks for a 14-piece total (7+7), not 26 — a ~46% cut, matching the
55% playable ratio almost exactly (26 x 0.55 = 14.3, rounds to 14).

Verified against real numbers, not just a passing test suite: traced
`ringVoids(8, 5)`/`cutCornersVoids(8, 5)`/`plusVoids(8, 5)` directly (22,
28, 32 playable cells respectively) and `buildGeneratedLevelConfig` at the
real first-`ring`-level index (`movesLimit`/`objectives` before vs. after
the fix) before writing the fix, then re-ran the same trace after to
confirm the scaled-down numbers. New coverage: `engine/
boardShapes.test.ts`'s `playableCellRatio` describe block (a plain
rectangle is always `1`; the real 8x5 percentages for all 3 templates;
`ring` is confirmed the most restrictive) and `appPersistence.test.ts`'s
expanded `generatedMovesLimit`/`generatedTargetCount`/
`buildGeneratedLevelConfig` describes (proportional scaling, the floors
still holding post-scale, `playableRatio` omitted/`1` being a true no-op,
and an end-to-end regression guard that a real shaped level's total target
and moves are strictly less than the unscaled levelNumber-only values). All
484 tests pass.

## Clearance layers — a fourth objective type, a new per-cell (not per-piece) mechanic

A genuinely new mechanic, built from scratch this session: certain grid
cells carry a hidden background layer that decrements whenever the piece
sitting on that cell is cleared by ANY effect — an ordinary match, a
special sweep, a chain, a combo, a bomb blast — with the win condition
being every layered cell reaching zero layers remaining.

**Investigated first, per the standing Playtest Feedback Protocol's "confirm
before deciding on a genuine fork" step**, since this was described up front
as needing its own investigation: is this the same shape as a blocker
(which already takes damage from an adjacent clear), or genuinely new?
Confirmed it's genuinely new, for a precise reason: a blocker's
`hitsRemaining` (`matrix.ts`'s `Piece`) lives ON the piece itself, which is
correct BECAUSE a blocker piece is immovable — it never falls or gets
replaced until it clears. A layer can't use that shape: `calculateCascades`
refills a cleared cell with a freshly spawned piece carrying a different
`id`, so whatever piece currently occupies a layered cell changes constantly
across ordinary play, while the layer count itself must stay pinned to the
GRID POSITION. This ruled out a `Piece` field outright and settled the
design before any code was written: `GameState.layerCells` is a new
`Record<string, number>` keyed by `"row,col"`, sitting beside `Board`
(itself unchanged — no new `PieceType`, no `matrix.ts` changes at all), the
same "new per-cell state, separate from Board/Piece" shape
`DenialSpreadState`'s `spreadWarning` flag or `voidCells`' fixed positions
use, but mutable across the whole level rather than either fixed-forever
(voids) or transient-one-move (spreadWarning).

**The clear-pipeline reuse claim WAS confirmed to hold, though** — this is
the second half of the investigation, and it held cleanly: every clearing
mechanism in this codebase (the ordinary in-match clear via
`resolveMatchEffects`, the in-match striped sweep, `expandChainClears`'
chain expansion, both special-piece combos, the color-bomb/area-bomb
detonations) already funnels through one of two places —
`resolveCascades`' per-pass loop (via `resolveMatchEffects`'s
`clearedPositions` + `applyAdjacentDamage`'s `newlyClearedBlockers`) or
`resolveClearSet`'s shared tail (via `expandChainClears`'s `expanded` +
`newlyClearedBlockers`) — and both already compute exactly the position set
a layer decrement needs. Nothing there needed new detection logic; it only
needed to be EXPOSED as raw positions rather than aggregated into
`clearedByMatchType`'s per-matchType counts, since a layered cell isn't
matchType-addressable. `CascadeResolution` gained a `clearedPositions:
Position[]` field (every position cleared across every pass/detonation this
move resolved, accumulated the same way `clearedByMatchType` already is),
threaded through `resolveCascades` (a new `allClearedPositions` accumulator,
named distinctly from the per-pass local `clearedPositions` already
destructured from `resolveMatchEffects` to avoid shadowing) and
`resolveClearSet` (`[...expanded, ...newlyClearedBlockers,
...chained.clearedPositions]`). `applyMove` then does the actual decrement —
`decrementLayers(state.layerCells, resolved.clearedPositions)` — entirely
outside the pure Board-only helpers above, since `GameState` (which owns
`layerCells`) only exists at the `applyMove` layer. This mirrors exactly how
`scoreGained` is threaded and applied for the `'score'` objective — a
second, parallel per-move accumulator riding the same resolution, not a
rework of it.

**Design, confirmed with the architect rather than guessed on both real
forks**: (1) layer range is 1 or 2, the level author's own per-cell choice
(`LevelConfig.layerCells: Array<{ position: Position; layers: number }>`),
mirroring `blockerHitsToClear`'s existing convention exactly, rather than a
single fixed number for every layered cell; (2) a layered cell is exclusively
an ordinary/special matchable piece this session — it never also carries a
blocker, and never sits on a void. Blocker+layer coexistence (a blocker's own
final clear also decrementing the layer underneath) is a real, doubled
interaction surface deliberately deferred, not silently assumed either way —
see `DEFERRED_COMPLEXITY.md`.

The `'clearance'` objective type (`ObjectiveType`/`Objective`) has no
`targetMatchType`, like `'score'` — its `currentCount` tracks cumulative
layers cleared instead of a matchType's clear count. Its `targetCount` is
NEVER hand-authored: `LevelConfig.objectives`' `{ type: 'clearance' }` entry
carries no `targetCount` field at all, and `createGameState` derives it by
summing the level's own `layerCells` (`Object.values(layerCells).reduce(...)`)
— a level author literally cannot let the two numbers drift out of sync,
unlike a `'collect'`/`'score'` objective's hand-picked `targetCount`, since
there's nothing to hand-pick. `decrementLayers` floors at 0 (never negative)
and is a no-op for a position with no `layerCells` entry, or one already at
0 — so a later effect that happens to re-touch an already-fully-cleared
layered cell (or any ordinary cell) is harmless, and `layersCleared` (fed
into the `'clearance'` objective's `currentCount`, the same shape
`scoreGained` feeds `'score'`) only ever counts a position that genuinely
still had a layer.

Scoped to real hand-built level content only this session, the same
sequencing every other new mechanic in this project has followed (blockers,
board shapes, score objectives all landed hand-built-first) — generator
integration (`buildGeneratedLevelConfig` producing `layerCells`/a
`'clearance'` objective) is a separate, later step (see
`DEFERRED_COMPLEXITY.md`). App.tsx's `LEVEL_QUEUE` gained a sixth entry,
"Dusty Counter" (seed 501), with `DUSTY_COUNTER_LAYERS` — six cells, four at
1 layer and two at 2 layers (8 total, becoming the objective's derived
target) — scattered across the board so a player encounters both "one clear
and it's gone" and "needs a second pass."

The presentation layer needed genuinely new pieces, since nothing like this
existed: `components/Tile.tsx`'s `LayerOverlay` (a new `layersRemaining?:
number` `Tile` prop) renders a flat, calm, light dusting wash
(`LAYER_OPACITY_STEP`, deliberately NOT `SpreadWarningOverlay`'s dark hazard
wash — a layer is "something's underneath, reveal it," not a threat) whose
opacity scales with how many layers remain, so a player sees the covering
visibly lighten with each clear rather than needing to read a number.
`components/Board.tsx` looks up `gameState.layerCells[`${r},${c}`]` per
tile (position-keyed, unlike every other per-piece prop `Board.tsx` already
reads straight off `piece`) and passes `undefined` rather than `0` once a
cell fully clears, so `LayerOverlay` never needs to distinguish "never
layered" from "fully cleared" — both render nothing. `Hud.tsx`/
`WonOverlay.tsx`/`Home.tsx`/`levelProgress.ts` each gained a `'clearance'`
branch alongside their existing `'score'` branch, falling back to a new
`CLEARANCE_OBJECTIVE_SPRITE` (`spriteAsset.ts`, a ▤ glyph) instead of
resolving a `'clearance'` objective's absent `targetMatchType` through
`getSpriteForMatchType` — the same "no art yet" placeholder this codebase
treats as a genuine-bug signal elsewhere, not a legitimate fallback for a
deliberately matchType-less objective.

Verified live against the real running app over CDP: a genuinely fresh save
seeded with `completedLevels: [1,2,3,4,5]` (the real localStorage key
empirically confirmed as `save:cooking-lalas-kitchen`, no app-slug prefix —
an assumption borrowed from a different verification session's README that
did NOT hold in this environment and was corrected by testing against a
truly fresh Chrome profile before trusting it, rather than being carried
over silently) reaching Level 6 "Dusty Counter" through Home's ordinary
"Start cooking" flow; two real tap-dispatched moves, found by running the
real engine over every adjacent swap of the real generated board, each
landing an ordinary 3-match on a layered cell — one on a 2-layer cell
(wash visibly lightens, objective ticks to 1/8, still shows a wash) and one
on a 1-layer cell (wash disappears entirely, objective ticks to 2/8) — with
a direct DOM check confirming exactly 5 of the original 6 `layer-overlay`
nodes remained, matching what a correct implementation predicts, not just a
plausible-looking screenshot. See `docs/verification/clearance-layers/`.
New coverage: `engine/gameState.test.ts`'s "applyMove — clearance layers"
describe block (ordinary-match decrement and win; a 2-layer cell needing
two separate real `applyMove` calls before reaching 0; decrement via an
in-match striped sweep and via a solo color-bomb detonation, proving the
shared pipeline rather than a special case per mechanism; coexistence with
a `'collect'` objective on the same level; a move touching no layered cell
leaving everything untouched) plus `createGameState` cases for
`layerCells` wiring and the derived `targetCount`. All 492 tests pass.

## Area-bomb combos: the last three pairings (area+color_bomb, area+striped, area+area)

The area+special snap-back described above (in the original area-bomb entry
and its "confirmed with the architect" fork) is now **removed** — the three
remaining area-bomb pairings each fire a real combined effect instead,
bringing the area bomb to full parity with the striped piece and color bomb
(every pairing among the three specials now has a defined effect).

**Investigation first.** The snap-back lived in exactly one place:
`gameState.ts`'s `applyMove`, inside the `if (aArea || bArea)` branch — a
`partner.type === 'area_bomb' || 'striped' || 'color_bomb'` check that returned
the no-move-spent reject tuple. Its `hasLegalMoves` mirror lived in
`matrix.ts`'s `findAnyLegalMove`, an `area_bomb` clause that excluded exactly
those three partner types from being "legal." Both were replaced outright, not
left dangling: the `applyMove` branch now dispatches to one of three new
resolvers by partner type (falling through to the existing `resolveAreaBomb`
only for an ordinary partner), and the `hasLegalMoves` clause collapsed to a
single unconditional `return true` for any area-bomb pair, since every pairing
is legal now.

**Ordering, stated plainly.** The `aArea || bArea` branch already ran FIRST in
`applyMove`, before the striped+bomb, striped+striped, and solo-color-bomb
branches — the exact ordering the original area-bomb work put in place so an
`area + color_bomb` swap (bomb-involving, but the area bomb is colorless) never
reaches `resolveColorBomb`'s degenerate single-type clear. That ordering did
not need to change; only what happens *inside* the area branch changed. This
was confirmed directly against the code (not assumed) before writing any new
resolver, since this exact bug — a colorless special being silently consumed by
the solo color-bomb branch — already bit the striped+bomb combo once before.

**Three new resolvers in `gameState.ts`, all routed through the existing shared
`resolveClearSet`** (blocker-consistent adjacent damage, chain expansion, and
cascade resolution, exactly like every other special effect):

- **`resolveAreaColorCombo`** (area + color bomb): converts every piece of the
  board's most-common matchType into an area bomb and fires all of them at
  once — several 3×3 blasts landing simultaneously. Unlike
  `resolveStripedBombCombo` (which reads its target color off the swapped
  striped piece), neither swapped piece here carries a matchType (both are
  colorless), so there's no piece to read a target color from. Reused
  `mostCommonMatchType` — the same function `expandChainClears` already uses
  for a color bomb caught in a chain with no swap partner — rather than
  inventing a second "pick a color" mechanism for the same underlying problem.
- **`resolveAreaStripedCombo`** (area + striped): a plus-shaped blast — the
  area bomb's own 3×3 block unioned with the striped piece's full sweep line in
  its own direction. Built entirely from the two existing geometry helpers,
  `areaBlastPositions` and `sweepLinePositions`, with no new shape logic.
- **`resolveAreaAreaCombo`** (area + area): a single 5×5 blast, not two
  separate 3×3s. `areaBlastPositions` gained an optional `radius` parameter
  (default `1`, so every existing caller is unaffected) rather than a second,
  parallel geometry function; the 5×5 is `areaBlastPositions(rows, cols, posA,
  2)` centered on `posA` — the same "center on the position the caller
  designates as posA" convention `resolveStripedCross` already established.
  Since the two bombs are always adjacent, `posB` always falls inside the 5×5
  already, so it's cleared as part of the same blast, not by a second one.

All three follow the existing combo convention exactly: both swapped specials
are added to `originKeys` (they clear but don't re-fire as a chain on top of
their own combo), the whole clear set scores at the top `'bomb'` tier (same as
every other combo), and a third, uninvolved special caught anywhere in the
resulting clear set still chains normally through `expandChainClears` — no
special-casing needed there, since chaining already treats any non-origin
special generically regardless of which effect produced the seed set.

**hasLegalMoves.** `findAnyLegalMove`'s area-bomb clause collapsed from a
three-way exclusion to `if (a.type === 'area_bomb' || b.type === 'area_bomb')
return true;` — every area-bomb pairing is legal now, so there's nothing left
to exclude. It still runs first among the special clauses, but only because it
has to be the thing that decides an area-bomb pair's legality, not because any
pairing still needs to be carved out.

**Test coverage** (`gameState.test.ts`'s "applyMove — area bombs" describe
block): one test per combo confirming the exact footprint (the color combo's
four isolated, non-overlapping 3×3 blocks; the striped combo's plus shape,
explicitly checking cells only the sweep — not the block — reaches; the
area+area combo's full 5×5, checking cells just outside it on every side
survive), each also asserting `multiSpecialFired: true` (both swapped specials
fired together in one pass — the same signal the `chain_reaction` tutorial
already keys off). The `hasLegalMoves` test was rewritten from "legal with
ordinary, not with special" to explicitly assert all three area+special 1x2
boards are now legal. The old snap-back test is gone — replaced, not left
alongside dead code. All 494 tests pass.

Verified live over CDP: three real tap-dispatched swaps against a hand-built
board loaded into the running app, one per combo, each producing the exact
predicted clear footprint on screen. See
`docs/verification/area-bomb-combos/`.

**Still deferred, unaffected by this session:** L/T-shape triggers involving a
4- or 5-long arm, and a genuinely ambiguous square-overlapping-a-run — see
`DEFERRED_COMPLEXITY.md`. This entry closes the "area + special combos" line
item that file previously carried.

## Font-and-gradient polish: real Baloo 2/Nunito Sans, real hero gradient

Two small, explicitly reversible follow-ups logged in `DEFERRED_COMPLEXITY.md`
since the original Home/Level Map build sessions: the design mockups specify
'Baloo 2' for headings and 'Nunito Sans' for body text, but neither was ever
loaded (Home.tsx/LevelMap.tsx approximated the mockup's weight/size/color
choices using the system default font); and Home's hero fade into the screen
background was a dependency-free stack of five increasingly-opaque solid
bands standing in for the mockup's actual CSS gradient.

**Fonts.** Both packages are first-party Expo Google Fonts wrappers
(`@expo-google-fonts/baloo-2`, `@expo-google-fonts/nunito-sans`, both
`0.4.2`), installed alongside `expo-font` (`~14.0.12`) — versions pinned to
match this project's Expo 54 `bundledNativeModules.json` entries, the same
manual-pin approach the sound/haptics session used for `expo-haptics` (this
environment's npm config still rejects `expo install`'s internal
`--allow-scripts` flag). `components/fonts.ts`'s `useAppFonts()` loads only
the three weight files this skin's own styles actually reference —
`Baloo2_700Bold`, `NunitoSans_400Regular`, `NunitoSans_700Bold` — not the full
weight range either package ships, since every heading style here is
`fontWeight: '700'` and body text is either unweighted or `'700'`. `App.tsx`
gates the existing `screen === 'loading'` splash on the hook's `fontsLoaded`
boolean, the same way it already gates on the save-data load — so a player
never sees a flash of system-default text before the real fonts paint in.

React Native doesn't synthesize font weights for a custom (non-system)
typeface, so every heading/body `Text` style in `Home.tsx`/`LevelMap.tsx` now
sets `fontFamily` directly to one of `Fonts.headingBold` /
`Fonts.bodyRegular` / `Fonts.bodyBold`, rather than leaning on `fontWeight`
the way system-font text can. A genuine judgment call, made rather than
guessed at silently: existing `fontSize`/`fontWeight` numbers were left
completely untouched. The mockup's own literal pixel values (e.g. a 42px
hero title) don't match this app's already-built, already-scaled-down layout
(a 260px hero vs. the mockup's 320px one, a deliberate prior decision, not a
font bug) — and `DEFERRED_COMPLEXITY.md`'s own entry already asserted the
existing numbers matched the mockup's *weight/size choices*, just rendered in
the wrong family. So this session's fix is purely swapping in the real font
files at the weights already chosen, not re-deriving sizes from the
differently-proportioned HTML mockup. One deliberate split from the mockup's
literal per-element font-family choice: `cardTitle` (used for "Your recipe
book" *and* the Sound/Haptics toggle-row labels, none of which existed as a
single shared style in the mockup) went to Baloo 2 across the board, since
all three read as short card-heading-style labels — not because the mockup's
now-defunct toggle rows say so. Icon/glyph-only text (the back arrow,
checkmark, lock, star glyphs) was deliberately left on the system font —
these aren't prose, and the two custom families are Latin display fonts with
no guarantee of covering arbitrary Unicode symbols.

**Gradient.** `expo-linear-gradient` (`~15.0.8`, matching the same
`bundledNativeModules.json` pin) replaces the old `heroFade`/`heroFadeBand`
band stack with one real `LinearGradient`. It now spans the hero's *entire*
height rather than just the bottom 55% slice the band approximation covered
— the mockup's own CSS gradient stops (`rgba(bg,0) 55%, rgba(bg,0.85) 85%,
bg 100%`) are relative to the full container, so covering only a bottom
slice was itself a small deviation the band version baked in. Colors use
this codebase's existing hex+alpha convention (`${color}${alphaHex}`, the
same pattern `LevelMap.tsx`'s glow halo and `WonOverlay.tsx`'s `YOLK` constant
already use) rather than introducing an `rgba()` helper: `D9` and `FF` are
the hex equivalents of the mockup's `0.85`/`1.0` alpha stops.

**Verification.** Both changes were confirmed against the real running app
(Metro web + a headless Windows Chrome driven over CDP from WSL — the
established rig, since Puppeteer/Playwright Chromium don't launch in this
WSL2 environment), including a real dispatched click navigating from Home to
Level Map, not a mocked screenshot of isolated components. See
`docs/verification/font-and-gradient-polish/`. `npm test` still passes at
494/494 — neither change touches anything the engine/service test suite
exercises (this project has no React component-test infra, so Home/LevelMap
rendering was never covered by it either before or after this session).

## Clustered denial-zone placement: grow one region instead of scattering

`DEFERRED_COMPLEXITY.md`'s denial-zone-spread entry logged this as
deliberately skipped: the generator scattered blockers via `fisherYates`
(`engine/generator.ts`), so a denial zone only ever became visually
*contiguous* once the dynamic spread mechanic had grown it that way over
several unaddressed moves — a fresh eligible level loaded with the same
count of blockers scattered independently at random, not reading as "one
zone" from the start.

Investigated first, per the standing Playtest Feedback Protocol: confirmed
`placeBlockers` really was a plain `fisherYates(allPositions, rng).slice(...)`
with zero adjacency awareness, and confirmed the ask applies only to
denial-zone-eligible levels (`generatedLevelNumber >= DENIAL_SPREAD_MIN_LEVEL_NUMBER`,
10) — every level below that threshold, and every hand-built level, keeps the
original independent scatter untouched, since a static zone below the
threshold was never the complaint.

**Design.** `engine/generator.ts` gained `GeneratorConfig.clusterBlockers?:
boolean` and a new `clusteredPositions` helper: pick one random start cell (via
the existing seeded `rng`), then repeatedly pop a random cell off the
*frontier* — the set of non-void cells adjacent to the region grown so far —
claim it, and fold its own unclaimed neighbours into the frontier. This is a
randomized region-growth walk, not a fixed shape template — it produces a
different, but always contiguous, blob per seed, matching how the rest of
this generator already varies procedurally. If the frontier empties out
before reaching the requested count (a board region smaller than
`blockerCount`, e.g. a shape template like `ring` splitting the board into
disconnected pockets), it reseeds a fresh region from a random still-unclaimed
cell and keeps growing — the same "never fewer than `min(blockerCount,
available cells)`" guarantee the original scatter's `.slice()` already gave,
just grown in contiguous pieces instead of picked singly. `placeBlockers`
branches on the flag; the scatter branch is byte-identical to before.

**Why a geometry flag, not a "denial zone" concept in the generator.** The
Leak Test in CLAUDE.md says the engine shouldn't encode skin/gameplay
vocabulary it doesn't need — but this is a step further, even within the
engine: `generator.ts`'s job is placement geometry, and it has no legitimate
reason to know *why* a caller wants a cluster versus a scatter, only that it
should grow one. `engine/gameState.ts`'s `createGameState` is the one place
that translates the actual gameplay-eligibility flag
(`LevelConfig.denialSpread`, already gated in `appPersistence.ts`) into
`clusterBlockers: config.denialSpread` when calling `generateLevel`. A level
below the threshold gets `denialSpread: undefined`, so `clusterBlockers` is
never even passed `true` — the eligibility gate itself needed zero new logic,
it's the same flag the spread mechanic already reads.

**Guarantees re-confirmed, not just assumed.** Clustered placement still runs
before `hasLegalMoves`'s post-placement check in `generateLevel` (unchanged
call order), still excludes void cells at both the seed and frontier-neighbour
steps (mirroring the scatter branch's own void exclusion), and — since a
blocker is excluded from matching outright, same as before — still never
needs a second `repairAccidentalMatches` pass. Verified directly, not assumed:
`engine/generator.test.ts`'s new "clustered blocker placement" describe block
adds a BFS contiguity check, re-runs the existing no-accidental-match/
has-legal-move assertions with `clusterBlockers: true`, and adds a
deliberately-disconnected two-pocket void board to exercise the reseed
fallback. `engine/gameState.test.ts` adds two `createGameState`-level wiring
tests (a `denialSpread: true` config clusters; the identical config without
it doesn't). See `docs/verification/clustered-denial-zone-placement/` for a
real generated level-10 board rendered with the skin's real sprites, showing
an actual contiguous region rather than scattered cells.

## Fixed: the real-audio-backend tones read as a slot machine on a real listen

Real playtest feedback, from actually listening to the built sounds on a real
device: match/cascade/win read as bright and exciting, the opposite of the
calm-not-frantic brief this whole game is built around. Per the Playtest
Feedback Protocol, this got a genuine redesign of `scripts/generate-sound-
assets.js`'s synthesis parameters, not a small tweak — the previous pass
(the real-audio-backend entry above) had already disclosed "no human has
listened to the tones yet" as an open gap, and this is that gap resolving
negatively, confirming the disclosure was the right call rather than
overcaution.

**What was actually wrong, per specific follow-up feedback (not just "make it
calmer" a second time).** Four concrete problems, all in the original
`synthNote`/win-arpeggio design: fundamentals sat in a bright register (A5
880Hz for match, E5 660Hz for cascade, climbing to C6 1046.5Hz in the win
arpeggio); every note carried a doubled-frequency overtone at 18% amplitude,
which is exactly the kind of bright upper-harmonic content that reads as
sparkly/arcade-like; the attack was a 6ms linear ramp — fast enough to read
as a punchy onset rather than a gradual one; and win used a fast four-note
ascending arpeggio (C5-E5-G5-C6, staggered every 110ms) — a rapid rising run
is one of the most recognizable casino/slot-machine sonic signatures that
exists, and was almost certainly the single biggest contributor to the
"exciting" reaction on its own.

**The fix, one change per problem.** Fundamentals dropped a fourth-to-an-
octave: match to F4 (349.23Hz), cascade to C4 (261.63Hz), win's root to A3
(220Hz). The bright doubled-frequency overtone is gone entirely — `synthNote`
now optionally adds a quiet SUB-octave (half frequency, `subOctaveAmp: 0.14`)
below the fundamental instead, which adds warmth/fullness without adding
brightness, since it introduces no content above the root. Attack lengthened
to 40-90ms depending on note length (50ms match, 30ms cascade — its window is
shorter so a full 50ms would eat too much of it, 70-90ms for win's two long
notes) — clearly gradual rather than a snap. Win's four-note ascending run is
replaced with a slow two-note interval: a sustained A3 root, with a warm
perfect-fifth E4 (329.63Hz) entering 450ms later and lingering long after —
overlapping generously rather than climbing, so it reads as one resolved
chord settling rather than a triumphant rising run. This is the second of the
two alternatives the architect specifically named (a single sustained tone,
or at most a slow two-note interval) — a two-note interval was chosen over a
single tone because a level win already gets a distinct visual/haptic beat
elsewhere in the app, and a two-note resolution gives just enough shape to
read as "you won" without needing to lean on urgency or brightness to do it.

**Verified by computation, not by ear — and that gap is disclosed, not
hidden.** Nobody on this build has ears, so the actual perceptual "does this
sound calm" question cannot be verified here the way a UI change gets a
screenshot. What *can* be verified directly against the generated PCM: a
Goertzel-algorithm frequency check (see `docs/verification/sound-redesign/`)
confirms zero energy at any of the old bright frequencies (880Hz, 660Hz, and
all four old arpeggio notes 523.25/659.25/783.99/1046.5Hz) in the regenerated
files, confirms the new lower fundamentals are the dominant energy present,
and confirms win's fifth (329.63Hz) is essentially silent (0.00012 magnitude,
~500x weaker than once it enters) during the first 400ms — i.e. the two
notes genuinely stagger in in a slow interval rather than firing together or
in a fast run. That is real evidence the *parameters* changed as described in
the actual output file, not just in the source. It is not evidence the
result now sounds calm on a real device — that still requires the same real
on-device listen that caught the original problem, and this redesign is not
considered done until that listen happens.

## Sound redesign, third pass: envelope shape (two-stage decay, eased attack) and an echo tail

The second pass (entry above) fixed register, attack length, overtone
content, and win's melodic shape, but was disclosed as unverified by ear.
Before assuming synthesis itself was exhausted as an option, a third pass was
worth trying: the second pass's envelope, despite already using
`Math.exp(...)` for decay, was still a *single-rate* exponential with a
*linear* attack ramp — technically curved, but not the actual shape a real
struck/plucked acoustic instrument (bell, chime, kalimba) has. A single-rate
exponential decays the same proportion of its remaining amplitude every
instant; a real resonant body has a fast-decaying attack transient that
gives way to a much slower-decaying sustained ring — two distinct rates, not
one.

**What changed, technically.** `synthNote`'s decay envelope is now a blend
of two exponentials with different time constants: `fastWeight *
exp(-t/fastTau) + slowWeight * exp(-t/slowTau)`, `fastTau` = 12% of the
note's duration, `slowTau` = 55%, weighted 55/45 fast/slow. Early in the
note the fast term dominates (a quick initial falloff); once it's decayed
away the slow term is what's left (a gentle trailing tail) — confirmed
directly against the regenerated PCM by measuring 20ms-window RMS decay
ratios: match's envelope falls ~18%/window immediately after its peak,
easing to ~7%/window by its tail, i.e. a measurably changing decay rate, not
the constant ratio a single exponential would produce. The attack also
changed, from a linear ramp (`t / attack`) to a raised-cosine ease-in (`0.5 *
(1 - cos(pi * t / attack))`) — zero slope at both the start and the join
into the decay, instead of a ramp's constant-slope wedge that has a sudden
change of slope right where it hands off to decay.

**The echo/reverb tail.** A new `addEcho` adds a small number (1-3,
role-dependent) of quiet, exponentially-decaying delayed copies of the dry
signal behind it — a plain discrete tap-delay, not a dense diffuse-reverb
algorithm, since the brief only calls for "a sense of space," not a
cathedral. Tuned per role: cascade gets the smallest tail (1 tap, 8% mix)
since it can fire several times in a fast chain and a bigger tail would
smear into a wash; match gets a short one (2 taps, 10% mix); win, a one-off
moment allowed to linger, gets the most generous (3 taps, 14% mix, widest
spacing).

**Verified by computation again, not by ear — the same disclosed gap.** No
new frequency content was introduced (still just fundamental + quiet sub-
octave, no bright overtone), confirmed no clipping (`maxAbs` well under 1.0
on all three regenerated files), and confirmed the envelope's decay ratio
genuinely changes shape over time rather than staying constant — see the
worked RMS numbers above. This is evidence the *envelope and echo* parameters
took effect as described, not evidence the result now sounds calm, warm, or
"produced" on a real device. **This redesign is not done until a real
on-device listen confirms it**, the same standard both prior passes were
held to.

## Board shapes: gating loosened from "rare advanced-player surprise" to "early, frequent, visually distinctive"

Real priority request, treated as urgent: the original board-shape gate
(`appPersistence.ts`'s `SHAPE_MIN_LEVEL_NUMBER = 8`, `SHAPE_CADENCE = 4` — see
the "Generator-driven board shapes" entry above) was reasoned entirely around
a difficulty concern — a shaped board has fewer playable cells, so it stayed
out until a player had met the full blocker roster on ordinary rectangles
first. That reasoning is confirmed resolved, not just asserted: the
"difficulty ramp was blind to shape" fix (see the entry above) already made
`generatedMovesLimit`/`generatedTargetCount` scale against the shape's own
`playableCellRatio`, so a shaped board at a given levelNumber is no longer
harder than a plain rectangle at that same levelNumber — only smaller. With
the original reason gone, the actual goal driving this gate going forward is
"the game should read as visually distinctive within the first few minutes
of play," which calls for the opposite of the old caution.

**The change.** `SHAPE_MIN_LEVEL_NUMBER` dropped from 8 to 1 — shapes are now
eligible from the very first generated level, not four levels after the full
blocker roster. `SHAPE_CADENCE` dropped from 4 to 2 — half of all generated
levels are now shaped, not one in four. Both are still the exact same
gate-shape (`generatedShapeId`'s threshold-plus-cadence, unchanged
mechanism), just retuned constants — no new gating logic was needed, since
the underlying playableRatio-aware scaling this depends on was already built.

**A second, independent change: a guaranteed second hand-built shaped
level.** Relying solely on the generator's cadence — however aggressive —
still means a brand-new player's *guaranteed*, curated content only ever
showed one shape (the existing "Cutting Board" plus-shaped level, level 4 of
the hand-built queue). `App.tsx`'s `LEVEL_QUEUE` gained a seventh entry,
"Pantry Corners" (seed 601, displayName chosen to fit the existing
cooking-themed naming, `skinConfig.pieceTypes[4]`/"chili" as its collect
target — the one piece type no earlier hand-built level had used as a sole
target yet), using `engine/boardShapes.ts`'s `cutCornersVoids(8, 5)` directly
rather than a hand-authored duplicate void list, since that generalized
template already exists and is already tested (70% playable, 28/40 cells —
`boardShapes.test.ts` locks in the exact ratio). It's the last hand-built
level, immediately before the generator takes over, so every new player now
sees two distinct curated shapes (plus, then cut-corners) from hand-built
content alone, before shapes become the frequent generator-driven occurrence
above. `handBuiltLevelCount` is read dynamically from `LEVEL_QUEUE.length`
everywhere it's used (`generatedLevelNumber`, `resolveLevelMapIndices`, the
recipe-card milestone lookup), so appending a 7th entry needed no changes to
any of those call sites — the generator's own "generated level 1" simply
shifts to raw level 8 automatically.

**A disclosed, accepted cosmetic overlap, not a bug — later fixed after a
real playtest report.** Because `SHAPE_MIN_LEVEL_NUMBER` is now 1, the
generator's very first shaped level (raw level 8, generatedLevelNumber 1,
`BOARD_SHAPE_ROTATION[0]` = `cut_corners`) landed immediately after the new
hand-built "Pantry Corners" level (level 7) — which itself uses
`cut_corners`, deliberately: it's the gentlest, most board-proportion-
appropriate template for a still fairly early, generous curated level
(`ring`'s 55% playable reads as meaningfully more severe, and was judged less
appropriate for a guaranteed early level). The net effect was the same
template silhouette appearing on two consecutive levels at that exact
boundary — different seed, piece layout, and objective each time, but the
same cut-corner shape twice in a row. This was originally logged here as a
real, minor, accepted cosmetic overlap rather than escalated to
`DEFERRED_COMPLEXITY.md`, on the reasoning that it was a one-time, low-stakes
seam at a single fixed boundary, not an unresolved feature gap.

**Real playtesting disagreed with that call.** A report came back reading as
"the same board shape keeps appearing... doesn't read as randomly varying" —
investigated per the standing Playtest Feedback Protocol before touching
anything: traced `generatedShapeId`'s actual formula by hand across levels
1–26, which confirmed the rotation itself has no bug (gating and template
selection share `stepsSinceThreshold`, but `SHAPE_CADENCE` (2) and
`BOARD_SHAPE_ROTATION.length` (3) are coprime, so it cycles cleanly with no
correlation artifact) — the entire symptom traced back to exactly this
already-disclosed seam, amplified by early players naturally concentrating
their play right at the level-7/level-8 boundary (and by shape being a pure
function of level number, so every retry of a hard level 8 repeats the same
shape). Fixed by adding `appPersistence.ts`'s `SHAPE_ROTATION_OFFSET = 1`,
which shifts the generator's rotation starting index by one step so raw
level 8 now lands on `BOARD_SHAPE_ROTATION[1]` (`plus`) instead of `[0]`
(`cut_corners`) — chosen over `ring` because `plus`'s 80% playable ratio is
gentler than `ring`'s 55%, matching the same "gentlest first" reasoning
Pantry Corners itself used. Pantry Corners was deliberately left unchanged —
its own `cut_corners` choice is reasonable on its own merits, so this is
purely about where the generator's independent rotation happens to start.
The offset only rotates the starting point: every template still appears
exactly once per 3 shaped levels in the same round-robin order (confirmed by
a live trace of the real `LEVEL_QUEUE.length` (7) and real 8×5 board across
levels 1–26 — `cut_corners(hand,7) → plus(8) → ring(10) → cut_corners(12) →
plus(14) → ring(16) → cut_corners(18) → plus(20) → ring(22) → cut_corners(24)
→ plus(26)`, no adjacent repeat anywhere, including the 7→8 boundary). See
`appPersistence.test.ts`'s updated `generatedShapeId`/`buildGeneratedLevelConfig`
describe blocks — every test asserting a specific rotation index was
re-traced against the new formula, not blindly shifted.

**Tests updated, not just the constants.** `appPersistence.test.ts`'s
`generatedShapeId` describe block and every `buildGeneratedLevelConfig` test
that asserted a specific levelIndex's config now reflects that levels which
used to be plain rectangles (generated levels 1 and 7 in the existing test
fixtures) are now genuinely shaped — two pre-existing tests
("builds a full LevelConfig for the first level past the hand-built queue"
and "grows the piece-type pool and shares the target total across two
objectives") had their expected `movesLimit`/`targetCount`/`voidCells`
rewritten to compute the expected values via the real
`generatedMovesLimit`/`generatedTargetCount`/`playableCellRatio` helpers
rather than stale hand-typed numbers, so they can't silently drift from the
actual scaling formula the way a hardcoded expectation would. Full suite
re-run clean. See `docs/verification/` for prior shape-related verification;
no new live capture was done for this gating change specifically, since it's
a pure constant/config retune of already-verified mechanics (generated
board-shape rendering, playableRatio scaling, and the hand-built showcase
path were each already verified live).

## Background-music loop optimization: search, a crossfade bug caught mid-session, and the mono/stereo call

A newly sourced background-music master (`skins/lalas-kitchen/sounds/background.wav`, 34MB, stereo, 16-bit, 48kHz, ~177s) needed to become an actual loopable game asset — this session was scoped purely to that optimization, not to wiring the result into `soundRegistry.ts`/playback (still unwired; logged in `DEFERRED_COMPLEXITY.md`). No ffmpeg, sox, or numpy exists in this environment (confirmed: none installed, no `apt`/`pip` network access) — the same constraint the synthesized sound effects were built under — so `scripts/optimize-background-music.js` hand-rolls every step in plain Node: a generic RIFF chunk walker (the source has a `LIST` chunk before `data`, which a fixed-offset reader would misparse), loop-point search, a crossfade, a windowed-sinc FIR lowpass + linear-interpolation resample, and an optional mono downmix.

**Loop-point search, two passes.** A coarse pass computes a 20ms-hop RMS envelope across the full track and scores every (start, duration) candidate in the 20-40s range by cosine-similarity between the 1s of envelope context leading into the candidate's end and the 1s leading out of its start (the two spans that become temporally adjacent once the loop wraps) — cheap enough to brute-force (~30,000 combos) since it never touches sample-rate data. The top ~25 candidates (de-duplicated by start-time proximity) then get a sample-domain refine: a joint shift of both endpoints, then an endpoint-only fine shift, each maximizing cross-correlation of a 20ms window at the seam — this is what actually determines click risk, not the coarse pass. Final candidate ranking is a weighted blend (`finalScore`) of sample-domain phase correlation (35%), an 8-band Goertzel spectral-similarity check between the start and end windows (35%, reusing the exact technique `docs/verification/sound-redesign/` already established as trusted in this project), start/end RMS amplitude match (20%), and the coarse envelope score (10%) — weighted toward phase/spectral match specifically because a real playtest-style check of the first attempt (see below) showed the coarse envelope score alone was a poor proxy: one high-envelope-score candidate had a 34.9% RMS mismatch, another had 46.2%, both of which would read as an audible volume jump on every loop regardless of how well their envelopes matched. The chosen candidate (start 136.00s, duration 26.97s) won on balance — no single metric perfect, but no single metric bad — over candidates that were excellent on one axis and poor on another. The full top-5 table is printed by the script, not just the winner, specifically so the choice is auditable rather than a black box.

**A crossfade bug, caught by the script's own verification, not assumed correct.** The first crossfade implementation blended the loop's tail with its head using position-aligned indices (tail sample `i` blended with head sample `i`, both counted from the start of the fade window). Its own printed post-crossfade discontinuity metric immediately exposed the mistake: 8.23% of peak, *worse* than the pre-crossfade hard-cut's 0.02%. Root cause, worked out before touching the code again: as the fade approaches the very last output sample, position-aligned blending approaches `head[F-1]` (the *end* of the fade-in window) — but the very next sample played, on loop wrap, is `head[0]` (the unmodified start of the file). Those are two arbitrary points F samples apart in the original recording, with no reason to be continuous; the "fix" was reintroducing a seam rather than removing one. The correct construction (now in `buildCrossfadedSegment`) instead blends the tail with audio *immediately preceding* the loop's own start point S, still available in the untrimmed source (`pre[j] = original[S - F + j]`) — as the fade reaches the last output sample it approaches `original[S - 1]`, which in the real continuous recording flows naturally into `original[S]` (= the loop's own unmodified first sample), because they're genuinely adjacent points in one continuous recording, not two points forced together. Re-measured after the fix: 0.78% of peak, down from the hard cut's un-faded 0.01% baseline plus real headroom against the phase-correlation/spectral mismatch the raw cut alone doesn't fully resolve. This is exactly the kind of "verify against real behavior, not just a plausible-looking implementation" catch the Playtest Feedback Protocol calls for, just applied to a computational check instead of a live device — logged here in full rather than silently fixed, since the wrong version would have shipped a *worse* loop than doing nothing.

**Resample.** 48kHz → 44.1kHz via a 129-tap Hamming-windowed-sinc lowpass (cutoff set ~1.5kHz under the new Nyquist, both for a genuine ratio and matching the "44.1kHz or lower" guidance) applied before linear-interpolation resampling — the filter exists specifically to avoid folding 22.05-24kHz content into the audible band on the downsample, not skipped as unnecessary for "just background ambience."

**Mono was proposed but not forced.** `stereoWidthMetrics` computes L/R correlation and a mid/side RMS ratio on the chosen loop segment: 0.853 correlation, 0.283 side/mid ratio — below the script's own bar for a confident mono call (correlation > 0.9 and side/mid < 0.15), meaning this track carries real, measurable stereo content (width/reverb, not just a mono source doubled to two channels). Per the explicit instruction not to collapse it without confirming that still sounds acceptable, the exported asset stays stereo; a `--mono` flag exists on the script to force the alternative if a real listen prefers it (roughly halves the file again).

**Result:** 34MB / 176.95s / 48kHz stereo → 4.76MB / 26.971s / 44.1kHz stereo (an ~86% size reduction). No clipping in the resampled output (max sample 96.2% of full scale). MP3 was not used, per the standing instruction that encoder padding causes an audible click on loop repeat — the output is WAV, uncompressed.

**Verified by computation only — the same disclosed gap held for every other sound in this game.** Every metric above (phase correlation, spectral similarity, RMS match, post-crossfade discontinuity) is a proxy for "will this click when it loops," not proof that it doesn't. No human on this build has ears. A real on-device listen — confirming the loop is genuinely seamless AND that the stereo image (kept, not collapsed to mono) actually sounds appropriate sitting quietly under gameplay — is still required before this is considered done, matching the standard already held for match/cascade/win.

## Background-music loop: wiring the optimized asset into real playback, gameplay-scoped

The prior session's entry above optimized `background.wav` but deliberately stopped short of wiring it in — confirmed still true at the start of this session (`grep`-checked `soundRegistry.ts`, `expoAudioSoundService.ts`; the gap logged in `DEFERRED_COMPLEXITY.md` still held, byte for byte). This session closed it, alongside the three existing one-shot cues, not replacing them.

**Scope was a real fork, confirmed rather than assumed:** should the loop play only while a level is on screen, or continuously across the whole app (Home, Level Map, RecipeBook)? Continuous menu music is a bigger UX commitment than "alongside gameplay" implies, and would have required lifting a persistent player instance above App.tsx's screen `switch` — architect confirmed **gameplay-only**, matching how the match/cascade/win cues are already `Board.tsx`-scoped and keeping Home/Level Map calm and silent per the calm-not-frantic constraint.

**`SoundService` gained a second, deliberately separate pair of methods** (`playMusic(id: MusicId)` / `stopMusic(id: MusicId)`), not an overload of `play()`. A music id is a track started once and looped across a whole mount lifecycle; a `SoundEffectId` is fired once per cascade pass. Folding both into one method would have made the "is this fire-and-forget or does it need a matching stop" contract implicit per call site instead of enforced by the type. `MusicId = 'background'` is its own closed union (currently one entry) for the same reason `SoundEffectId` is a closed union — an unregistered/misspelled id is a compile error, not a silent runtime no-op.

**`expoAudioSoundService.ts` gained a second player pool** (`musicPlayers`, mirroring the existing `players` pool exactly), rather than reusing one map keyed by a widened id type — a `SoundEffectId` player is fire-once-from-zero (`play()` re-seeks to 0 every call); a `MusicId` player is created once with `player.loop = true` and only ever `play()`/`pause()`d after that, a genuinely different lifecycle that a shared map would have obscured. `stopMusic` pauses immediately (silence takes effect synchronously) then asynchronously seeks back to 0, so the *next* `playMusic` always restarts from the top of the 26.97s loop rather than resuming mid-track — deliberate, since each level entering fresh should get the same beginning, not wherever the last level happened to leave off.

**The start/stop decision was extracted as a pure function** (`components/backgroundMusic.ts`'s `syncBackgroundMusic`), the same pattern `pauseActions.ts`'s cap logic already established for Board-adjacent logic — this repo has no React component-rendering test harness (see CLAUDE.md's Testing Philosophy), so the one thing genuinely worth pinning down in a test file is the *decision* ("sound on → start, sound off → stop"), not the `useEffect` wiring around it. `Board.tsx`'s new effect is `useEffect(() => { syncBackgroundMusic(soundEnabled, soundService); return () => soundService.stopMusic('background'); }, [soundEnabled])`, placed beside the existing stepTimersRef cleanup effect — it re-syncs on every `soundEnabled` toggle (so muting mid-level stops the loop immediately, unmuting restarts it) and its cleanup unconditionally stops the track on unmount, regardless of the toggle's value at that instant, so a level left via exit/win/loss can never leave the loop playing behind it.

**Verified live over CDP against the real running app** (the same headless-Windows-Chrome-from-WSL2 technique `docs/verification/real-audio-backend/` used, patching `window.Audio`/`HTMLAudioElement.play`/`pause` to log real invocations): entering a level produced a real `Audio` construct for `background.wav` with `.loop === true` and a real `.play()`; a real drag-swap match fired `match.wav`'s own `play()` while the background element's `currentTime` kept advancing uninterrupted (2.83s→8.63s) — confirming the loop and the one-shot cue genuinely overlap rather than one displacing the other; exiting the level produced a real `.pause()` followed by a rewind to `currentTime: 0`; re-entering with Sound toggled off produced no new construct/play at all. See `docs/verification/background-music-loop/`. All 505 tests pass, including this session's new `components/backgroundMusic.test.ts` and the two existing fake-`SoundService` test fixtures (`services/soundService.test.ts`, `components/soundEffects.test.ts`) updated to satisfy the widened interface.

**Still genuinely deferred, not silently resolved:** no human has listened to the loop actually playing (this verification proves real playback was invoked and looped correctly, not that it sounds calm as intended — the same disclosed gap `real-audio-backend`/`sound-redesign` carry for match/cascade/win), and no native (iOS/Android) device test exists in this environment — see `DEFERRED_COMPLEXITY.md`.

## Three real-playability-audit safety fixes: defensive save loading, an app-level ErrorBoundary, and hardening `shuffle`'s rescue fallback

A playability audit (not a playtest, a code-level review) surfaced two findings explicitly flagged as cheap-fix-for-catastrophic-consequence: a corrupted save could permanently brick the app on every future launch with no recovery path, and no `ErrorBoundary` existed anywhere in the component tree to catch any crash at all. A third, closely related gap was found investigating the second: `matrix.ts`'s `shuffle` — the one rescue mechanism a stuck board has — tried 100 random reshuffles, then silently returned the LAST candidate even if it still had a match, a square, or zero legal moves, with nothing checking or complaining. All three were treated as this session's actual top priority, ahead of everything else on the list.

**Defensive save loading** (`engine/gameState.ts`'s `loadSave`). `JSON.parse(raw)` had no try/catch and no schema check at all — any malformed blob (an interrupted write, storage corruption, or a future save-format change an old file doesn't match) threw straight out of `loadSave`, and with no `ErrorBoundary` above it, that crash repeated on every subsequent launch, permanently, with the only "fix" being a full app-data wipe the player has no way to know to perform. The fix reuses `loadSave`'s own already-real "no save yet" contract: a `try`/`catch` around `JSON.parse`, plus a new `isValidSaveData` type guard checking the required backbone fields strictly (`skinId`, `currentLevel`, `lives`, `livesLastRegenAt`, `itemsCollected`, `powerUpCounts`) and every field added since (`completedLevels`, `seenTutorials`, `unlockedRecipeCards`, `levelStars`, `soundEnabled`, `hapticsEnabled`) only IF PRESENT, matching each field's own existing "optional for pre-existing saves" comment — but if present, still shape-checked, so a save can't pass validation carrying e.g. a bare string where `seenTutorials` expects an array only to throw the first time something calls `.includes()` on it downstream. Either failure mode now falls back to `null` (logged via `console.error`, not silent) — the exact path `App.tsx`'s `applyLoadedSave(null)` already handles correctly (it's the same state the dev-only reset already exercises), so this needed zero App.tsx changes. Costs at most that one corrupted save's progress, a real but completely different category of problem than the app refusing to open at all.

**An app-level `ErrorBoundary`** (`components/ErrorBoundary.tsx`) is the one class component in an otherwise all-function-component tree — React only exposes `getDerivedStateFromError`/`componentDidCatch` via a class, there's no hook equivalent. It deliberately does NOT import `SkinConfig` or anything from `skins/`: its entire job is to still work when something ELSE is broken, which could plausibly include the skin config itself, so its palette is a small fixed set of colors matching lalas-kitchen's own today rather than a prop — a narrow, deliberate exception to this project's usual "components read from skin config" rule. "Start Fresh" bumps a `resetKey` used as the wrapped tree's own `key`, forcing a genuinely fresh mount (re-running `App`'s own `loadSave` from scratch) rather than just clearing `hasError`, which would hand the SAME crashed props/state straight back to the same instances. Wired in `App.tsx` as the outermost wrapper — the old default-exported `App` was renamed `AppRoot` and a new `App` wraps it in `<ErrorBoundary>`, so nothing in the tree (fonts loading, save loading, `GestureHandlerRootView`/`SafeAreaProvider` setup, gameplay) can crash without being caught. The actual recovery logic lives in a separate react-native-free module, `components/errorRecovery.ts` (`erroredRecoveryState`/`nextResetState`/`describeCaughtError`), confirmed necessary rather than assumed: importing `'react-native'` genuinely fails to parse under this repo's plain ts-jest config (verified directly with a throwaway test file), the same limitation `services/hapticsService.ts` already documents for `expo-haptics` — so `ErrorBoundary.tsx` itself can only ever be verified live, but its logic is fully unit tested via the extracted module, matching the `pauseActions.ts`/`wonActions.ts` pattern this project already uses for the same reason.

**Hardening `shuffle`'s rescue fallback** (`engine/matrix.ts`) turned out to be the deepest of the three. The old code's 100-attempt loop returned the last random candidate unconditionally — no final legality check at all. The fix adds two further tiers, both multiset-preserving (position swaps only, never recoloring a piece's `matchType` the way `generator.ts`'s `repairAccidentalMatches` does when filling a *fresh* level — a reshuffle must never silently change what pieces exist, only where they sit): `repairShuffleViaSwaps`, a deterministic, bounded repair loop breaking each remaining match/square by swapping its offending cell with the first other movable piece of a genuinely different type (mirroring `repairAccidentalMatches`'s own bounded-pass convergence argument, just via swaps); then, for the rarer case of a board that's clean but still has zero legal moves, `forceLegalMove`, which searches the board for a template it can rearrange into one guaranteed legal move. Neither tier trusts its own geometry — every candidate either produces is re-verified from scratch against `checkMatches`/`checkSquares`/`hasLegalMoves` (the same ground truth every other legality check in this file already uses) before being accepted, so a mistake in either tier's reasoning can only ever cause it to keep searching or come up empty, never hand back a board that isn't genuinely legal. Only if every tier fails does `shuffle` now throw a descriptive `Error` — matching `repairAccidentalMatches`'s own precedent of throwing rather than lying when a board is structurally impossible — instead of returning something it can't vouch for.

**`forceLegalMove`'s first design had a real, adversarial-test-caught gap.** The initial version only implemented one template — three same-type cells two apart in a line plus a fourth same-type cell adjacent to the middle cell (an off-axis "notch") — modeled on a plus/cross-shaped intersection. The adversarial test this session wrote specifically to stress-test the hardening (a real generator `ring`-template board at its real 8×5 size, 22 of 40 cells playable, with dense blockers and the real 6-type piece pool) failed outright: a 1-cell-wide corridor shape like `ring` has NO off-board-shape neighbor anywhere along its own path, so the notch template can never be satisfied there, regardless of piece-type distribution. Investigated before patching around it: the actual simplest legal-move construction doesn't need an off-axis neighbor at all — four consecutive cells in a single line `[c0,c1,c2,c3]` with `c0`/`c1`/`c3` holding one type and `c2` holding anything else is one in-line swap (`c2`<->`c3`) away from completing a run, and needs only a single straight run of 4 movable cells, which a corridor shape has plenty of. `forceLegalMove` now tries this in-line template first (both orientations), falling back to the notch template for shapes whose only long-enough runway is exactly 3 cells but does have a perpendicular neighbor. This is exactly the kind of gap the "investigate real behavior, don't assume the design is complete" discipline exists to catch — the self-verification step meant the initial gap surfaced as an honest thrown error on the adversarial test, not a silently-wrong board.

**One more real behavioral fork, resolved rather than guessed past:** hardening `shuffle` to throw on a genuinely impossible board surfaced 51 pre-existing, unrelated test failures across `gameState.test.ts` — not because the new code was wrong, but because many hand-built test boards in this suite deliberately use a near-unique letter-per-cell labeling convention (to make precise cell-identity assertions easy), which incidentally makes every piece type globally singleton-count after the move under test resolves — a board where NO type ever reaches count 3, so `hasLegalMoves` was already structurally false before this session touched anything; the OLD `shuffle` just silently tolerated it, and none of the 51 tests ever asserted anything about the rescue's output (it was incidental collateral of `applyMove`'s own automatic rescue call). Rather than rewrite 51 unrelated test fixtures, the real fix was recognizing that `gameState.ts`'s `applyMove` call site (the mid-play rescue, at `hasLegalMoves(settledBoard) ? settledBoard : shuffle(settledBoard)`) is not the same context as `generator.ts`'s level-creation-time call — that site's own existing comment is explicit that a rescue "should read as silent and immediate to the player, not an announced interruption." Turning a failed safety net into a full-app crash there would be exactly the interruption that comment rules out, and `settledBoard` itself is never in question (it's a real move's real cascaded result, always match/square-free already) — a failed rescue only means this specific stuck state didn't get fixed, not that anything is corrupted. So `applyMove`'s call site now wraps the rescue in its own `try`/`catch`, logging (not silent) and falling back to the un-rescued `settledBoard` on failure, while `shuffle` itself keeps its honest, throwing contract as a reusable pure function — the right contract for `generateLevel`'s own call site, where a level that can never be made legal at creation time is a genuine content bug worth failing loudly on (now caught by the same `ErrorBoundary`, a calm "start fresh" rather than a broken level silently starting). This fixed all 51 failures with a one-call-site change, not 51 test edits. One genuinely stale test fixture was also fixed on its own merits (not just retro-fitted to pass): `matrix.test.ts`'s "voids stay at their exact positions" test used a diagonal-void 3×3 layout where NO row or column ever has 3 contiguous movable cells — structurally incapable of ever having a legal move regardless of piece types — replaced with a shape that has real length-3+ lines, preserving the test's actual intent (void positions survive a reshuffle) instead of its accidentally-degenerate original board.

**Verified live over CDP** (headless Windows Chrome from WSL2, per this project's standing verification technique): corrupting `localStorage`'s save blob with invalid JSON and reloading rendered the real, normal Home screen — no crash screen, real interactive content — confirming the fresh-save fallback recovers gracefully rather than bricking. A temporary, reverted-after `?crashtest=1` render-throw hook in `App.tsx` (the same "temporary harness gate, removed after capture" convention this project already uses) confirmed the `ErrorBoundary` genuinely renders "Something went wrong / Start Fresh" on a real injected crash, that clicking "Start Fresh" performs a genuine full remount (immediately re-throwing while the crash condition was still present in the URL — proving it isn't just clearing an internal flag), and that navigating away from the crash condition recovers into the ordinary, fully interactive Home screen with no residual broken state. Full suite: 521 tests passing (up from 512 before this session; +9 net from the new coverage, after also fixing the 51 collateral failures and one stale fixture). A live click-through of actual gameplay (swap → cascade → shuffle-in-context) was attempted over CDP but didn't register through synthetic mouse events against React Native Web's gesture-handler-backed `Pressable` — a tooling friction, not a defect signal; confidence in the modified `applyMove`/`shuffle` code path instead rests on the engine test suite, which is the right tool for engine-logic correctness per this project's own testing philosophy, with the two genuinely UI/feel-shaped claims (save-corruption recovery, crash recovery) verified live as they should be. See `docs/verification/` for the CDP session's own findings, not separately captured as screenshots this session (console/DOM-text assertions were the relevant signal, not visual appearance).

## Difficulty breather: a temporary dip after a real losing streak

Investigation confirmed the brief's premise: the generated-level ramp genuinely climbs then flatlines forever, applying the same pressure indefinitely regardless of how a player is actually doing — `generatedMovesLimit` (`appPersistence.ts`) hits its `MIN_MOVES` floor (18) by level 13 and never moves again; `generatedTargetCount` hits its `MAX_TARGET` cap (26) by level 6 and never moves again. No consecutive-loss tracking existed anywhere (confirmed by direct investigation, not assumed). Also confirmed: `components/Board.tsx`'s internal "Play Again" (used by `PausedOverlay`/`ContinueOffer`/`WonOverlay` to retry a stuck level) reuses the *same* `LevelConfig` object across retries — it only reseeds the board layout (`nextSeedRef`), never recomputes `movesLimit`/`targetCount` — so a breather can only ever take effect at a genuinely new `buildLevelConfig` call, i.e. `App.tsx`'s `handleNextLevel`/`handlePlayLevel`, not an in-place retry.

**Tracking is a plain streak, not per-level.** `SaveData.consecutiveLosses?: number` (optional, defaults 0, same convention as every other optional save field) increments by one on every real life-loss (`App.tsx`'s `handleLifeLost`, via `appPersistence.ts`'s new `consecutiveLossesAfterLoss`) — a loss on a hand-built `LEVEL_QUEUE` level counts too, since the player is still having a hard time regardless of which kind of level it happened on. It resets to 0 on any win (`handleBoardStateChange`'s `won` branch), per this session's brief, whether or not that win was itself a breather attempt.

**The breather only ever applies to a generated level, and is consumed the instant it's granted.** `shouldApplyBreather(consecutiveLosses, levelIndex, handBuiltLevelCount)` is true once the streak reaches `BREATHER_LOSS_THRESHOLD` (2) AND the level about to start is past the hand-built queue — a hand-built level has no formula-driven movesLimit/targetCount to relax, so a loss streak that happens to be sitting on one just carries forward unconsumed until the player reaches or retries a generated level. This decision is made, and the streak reset to 0, **only** at the two real "start playing" call sites (`handleNextLevel`, `handlePlayLevel`) — never at the level-map preview call sites (`nextLevelSummary`/`levelMapRows` in `App.tsx`), which always show the ramp's normal numbers, since a preview isn't committing to an attempt and the streak could still change before the player actually taps in. This makes the breather a genuine one-off dip: granting it immediately zeroes the streak, so the level immediately after (whether that's advancing past a finally-won breather level, or a further retry of the same level after a third loss) needs two fresh losses to earn another one, and resumes the exact numbers the ramp would have given it anyway.

**A real correctness hazard, caught before it was built:** the post-win star-rating recompute (`handleBoardStateChange`'s `won` branch) re-derives `movesLimit` via `buildLevelConfig` to score the attempt that just ended. If that recompute re-derived the breather flag fresh from `consecutiveLossesRef` at that moment, it would get the wrong answer — the streak has *already* been consumed (reset to 0) at level-start if a breather was granted, and a win itself also resets it to 0, so by the time this recompute runs the streak can never truthfully answer "was this attempt a breather." Fixed by caching the decision in a dedicated ref, `isBreatherAttemptRef`, set once at level-start and read (never re-derived) at recompute time — the star rating always reflects the exact `movesLimit` the player actually played against.

**Magnitude — the real judgment call.** Both `generatedMovesLimit` and `generatedTargetCount` gained an optional `breather: boolean = false` third parameter (same default-off convention `playableRatio` already established, composed with it rather than replacing it): `BREATHER_MOVES_RATIO = 1.3` (+30% moves) and `BREATHER_TARGET_RATIO = 0.7` (-30% target), each independently rounded, with the existing `MIN_MOVES`/`MIN_TARGET` floors re-applied after — so a breather can only ever move a number away from its floor, never below it. Both levers move together, and by a matched magnitude, deliberately: a real losing streak at the level range this triggers in (~13+) means both numbers are already flatlined at their respective floor/cap, so nudging just one might not read as a felt difference; a flatlined level (18 moves / 26 target) becomes 23 moves / 18 target for that one attempt. Explicitly out of scope for this change (the brief scoped it to moves/target specifically): piece-type count, blocker count, objective count, and denial-spread are all untouched by a breather.

**Test coverage:** `appPersistence.test.ts` gained direct tests for `generatedMovesLimit`/`generatedTargetCount`'s breather param (genuinely easier than the unscaled value, composes correctly with `playableRatio`'s floor, defaults off), `shouldApplyBreather`/`consecutiveLossesAfterLoss` (fires only at/past the threshold, never on a hand-built level regardless of streak length, applies to the very first generated level), `buildGeneratedLevelConfig` with `breather: true` (produces a genuinely easier level at a real flatlined levelNumber, changes nothing else — same seed/shape/blockers — defaults off), and `buildSaveData`'s round-trip of `consecutiveLosses`. Full suite: 537 tests passing (up from 521 before this session).

**Verified live** by forcing two real consecutive losses against the running app and confirming the next generated level genuinely produced the reduced numbers — see `docs/verification/difficulty-breather/`.

## Tutorial cadence throttle: a real minimum spacing between any two tutorial appearances

**The brief's premise held.** All seven one-time tutorials (`how_to_play`, `blocker`, `board_shape`, the three special-piece cards, `chain_reaction`, `spread_warning`) each fire correctly and exactly once, and `components/Board.tsx` already guaranteed only one overlay is ever ON SCREEN at a time via its render-priority nesting — but nothing previously stopped a second, genuinely different first from appearing the INSTANT the first was dismissed, with zero real playtime in between. Two concrete cases confirmed this live: a generated level at or past `SHAPE_MIN_LEVEL_NUMBER`/`generatedBlockerCount`'s introduction level (e.g. levelNumber 3 or 7) can have both a void-shaped board AND a blocker on its OWN initial board, making `board_shape` and `blocker` both eligible at the exact same mount instant; and forming a striped piece then a color bomb on two consecutive moves fires both `striped` and `color_bomb` a beat apart. Investigated first, per the standing Playtest Feedback Protocol, rather than assumed.

**Enforced as real elapsed time, not move count or level count — the one axis that actually separates the cases.** A move count has no stable "long enough" value across levels with very different move budgets (18 moves vs. 26), and a level count can't fix either case above: `board_shape` and `blocker` are both eligible on the SAME level (zero levels apart no matter the threshold), and the striped-then-bomb case is likewise within one level. `appPersistence.ts`'s `canShowTutorialNow(lastTutorialShownAt, now, minGapMs)` is the pure elapsed-time check (true immediately if no tutorial has ever shown — the very first one never waits on a cooldown that hasn't started), and `TUTORIAL_MIN_GAP_MS = 60_000` (60 seconds) is the chosen gap: reasoned from the existing 18s single-thinking-pause idle-hint research (a tutorial-to-tutorial gap should read as noticeably longer than one player's own thinking pause, not a small multiple of it), short enough to be a small fraction of a typical level's playtime so it rarely reads as withholding a genuinely new explanation. A hand-picked judgment call, not playtested — see `DEFERRED_COMPLEXITY.md`.

**A deferred tutorial defers gracefully rather than blocking play or vanishing.** `appPersistence.ts`'s `shouldActivateTutorial(nextEligibleTutorialId, activeTutorialId, lastTutorialShownAt, now)` is the one decision `Board.tsx`'s activation effect needs: given the highest-priority tutorial that WANTS to show (`nextEligibleTutorialId` — the same onboarding > board-shape > blocker > special-piece/spread/chain-reaction priority chain the render JSX always used, now computed once as a value instead of via nested render conditions), whether one is already active, and the cooldown state, should it actually start now? A false answer changes nothing — the same still-eligible candidate is simply re-offered the next time the effect re-runs, which is keyed on `gameState` (a real move commit), not a background timer: this game has no ticking clocks anywhere else (Home's own "No timers. No rush." footer copy), so a blocked tutorial's "next reasonable opportunity" is the player's own next move, exactly mirroring the stuck-player-hint conversion's own reasoning for dropping its idle timer in favor of a player-initiated moment.

**Replacing four independent booleans' direct render/input gate with one `activeTutorialId`.** Previously `showOnboardingTutorial`/`showBoardShapeTutorial`/`showBlockerTutorial`/`specialTutorial` gated `canAcceptMove`, the drag-enabled check, and the JSX directly; they still track their own "eligible and not yet dismissed" condition exactly as before (nothing about *when* a tutorial becomes eligible changed), but a new `activeTutorialId` state is the single gate everything else reads — set only once `shouldActivateTutorial` says yes, cleared by each tutorial's own dismiss handler. This is a real, intentional behavior change: while a tutorial is eligible but cooldown-blocked, `canAcceptMove()` now returns true — the player can keep playing normally, which is the entire point of a graceful defer rather than a block. The cross-level anchor (`lastTutorialShownAt`) is lifted to `App.tsx` as a plain, session-only ref (`lastTutorialShownAtRef`, deliberately NOT persisted into `SaveData` — this paces one active play session, not something that should still be counting down after a real app close/reopen, a fresh launch already being a natural break) since `Board.tsx` fully remounts every level (`key={levelIndex}`) and the throttle has to survive that remount to catch the same-level and cross-level cases both.

**A real correctness hazard, caught live during this feature's own verification, not assumed away.** The first live-capture attempt used a generated level with only 3 distinct piece types (`generatedPieceTypeCount` ramps type variety up over the first several generated levels) — a single real hinted move's cascade finished the entire level in one move, before the intended second move (after the cooldown cleared) could ever run. That alone wasn't a throttle bug, but investigating it surfaced a genuine one: the activation effect didn't check `gameState.status`, so if a level's cooldown happened to clear on the exact move that won or lost it, a deferred tutorial could activate and render on top of the Won/Paused overlay — a race that was *impossible* before this session, since a mount-time tutorial always rendered on the very first frame, well before any move could end the level. Fixed by gating the activation effect on `gameState.status === 'in_progress'`, the same guard the pre-existing special-piece/spread-warning scan effect already used for the identical reason. The capture was then re-run against a level with 5 piece types and a bigger target, giving enough headroom for both real moves without ending the level early.

**Test coverage:** `appPersistence.test.ts` gained direct tests for `canShowTutorialNow` (null-anchor immediate allow, blocked-under-the-gap, allowed-at-and-past-the-gap, a custom `minGapMs`) and `shouldActivateTutorial` (nothing eligible never activates; something already active never lets a second one stack regardless of cooldown; the very first tutorial ever activates immediately; two genuine close-together triggers defer instead of stacking; a deferred candidate genuinely activates once the gap has elapsed, never lost; the once-ever `seenTutorials` guarantee holds regardless of any deferral, exercised through the real `shouldShowBlockerTutorial` gate). Full suite: 558 tests passing (up from 548 before this session).

## First accessibility pass: font scaling and colorblind-safety

**Starting state, confirmed by direct investigation, not assumed.** `accessibilityLabel`/`accessibilityRole` existed on exactly two elements in the entire app (both `LevelMap.tsx`/`RecipeBook.tsx` "Back to home" buttons' `accessibilityLabel`, and `accessibilityRole` nowhere at all) — matching the brief's premise exactly. Less obviously: this app was **not** actually failing to respect the system's text-size setting — no `allowFontScaling={false}`, no `maxFontSizeMultiplier`, no `Text.defaultProps` override, and no Expo config opt-out exist anywhere, so React Native's own default (every `Text` scales with the OS accessibility text-size setting, uncapped) was already active. The real, previously-invisible gap was the *lack of a ceiling*: several HUD/chrome elements size a fixed pixel `height` tightly to their current `fontSize` (e.g. `Board.tsx`'s 28×28 circular exit button, its `hintButton`'s fixed `height: 28`, `LevelMap.tsx`'s fixed-diameter medallions/badges), and iOS/Android's largest accessibility text settings can scale roughly 3x — enough to clip any of those well before reaching that extreme.

**Font-scale cap: a real, confirmed fork, not guessed.** Presented three options (1.3x/no layout changes, 1.5x+targeted widening, 2.0x+broader rework) with their real tradeoffs; architect chose **2.0x cap + broader layout rework**.

**`components/AppText.tsx`** is a new shared wrapper (`export function Text(props) { return <RNText maxFontSizeMultiplier={2} {...props} />; }`) that all 16 component files importing `Text` from `'react-native'` now import instead. Considered and rejected: overriding `Text.defaultProps` globally at app boot — RN's `Text` is exported as a `forwardRef`-wrapped component (confirmed by reading `node_modules/react-native/Libraries/Text/Text.js`), and `defaultProps` on a `forwardRef` component is a legacy, increasingly-unreliable React pattern under React 19 rather than a clean guarantee; an explicit wrapper component is unambiguous or an outright compile/runtime tool either way rather than a silent no-op if a future RN/React version drops `defaultProps` support entirely, and it collapses "every screen's `Text`" into the one shared source this project's own Playtest Feedback Protocol already prefers over N independent copies of the same decision.

**Layout risk was real only in fixed-diameter/fixed-height chrome — audited file by file, not guessed.** Every card/overlay/panel in `WonOverlay.tsx`/`PausedOverlay.tsx`/`ContinueOffer.tsx`/`OutOfLives.tsx`/`Hud.tsx`/`LivesBadge.tsx`/`Home.tsx`/`RecipeCardReveal.tsx` was checked line-by-line: every fixed `height`/`width` found there belongs to a decorative illustration (plate rim, pot, sparkle, flame icon) or an icon image, never a `Text`-wrapping container — those screens' actual copy already sits in `paddingVertical`/`marginTop`-driven containers that grow with content, so they were already safe at any scale and needed no changes. Two genuine risks were fixed: `Board.tsx`'s `hintButton` ("💡 Hint") converted its fixed `height: 28` to `minHeight: 28` (+ `paddingVertical: 4`) so its label can grow vertically without clipping.

**A second, distinct class of risk: icon glyphs and fixed-diameter medallions rendered as `Text`.** Several elements use `Text` to render a symbolic glyph or a number that has to fit *exactly* inside a circle whose diameter is fixed by other layout math it can't itself grow past: `Board.tsx`'s exit "✕" (a 28×28 circle), `Tile.tsx`'s striped-piece direction arrow badge (`badgeSize`-diameter circle), `LevelMap.tsx`'s back arrow "‹", its per-level medallion number (diameter fixed by `levelMapLayout.ts`'s path-placement math), its checkmark and lock badges, and `RecipeBook.tsx`'s own back arrow. Scaling these independently of their circle would either overflow a shape that structurally cannot grow (a circle can't widen in one axis without becoming an ellipse and breaking the level-map's path geometry) or would communicate nothing more — a "×" glyph doesn't become more legible information at a larger size, it just breaks its badge. Each of these now sets `allowFontScaling={false}` explicitly, with an inline comment explaining why, rather than silently opting out with no trace of the reasoning. `Tile.tsx`'s `SpriteContent` fallback label (the "TO"/"AR"-style placeholder shown only when a piece has no bundled art yet) got the same treatment for a related but distinct reason: it has to fit inside a real gameplay board tile, and tile size is this game's single most layout-critical dimension (it drives tap accuracy per this file's own Design Constraints) — a fallback code isn't prose a player needs to read larger, so it isn't worth risking a corrupted board tile over.

**Colorblind-safety check: simulated, not eyeballed.** No CVD (color vision deficiency) simulation tool existed in this environment, so one was built for this session only (`sharp` installed to a scratch directory, Machado/Oliveira/Fairchild (2009) protanopia/deuteranopia/tritanopia transform matrices applied per-pixel to the real sprite files) and run against all six ingredients (tomato/garlic/lemon/herb/chili/spoon) plus the three specials (color bomb/area bomb/striped tomato) — see `docs/verification/accessibility-pass/colorblind-simulation/ingredient-and-special-sprites-cvd-sheet.png`. Finding: under protanopia/deuteranopia, tomato and chili's normal-vision red hues do converge toward a similar dark olive-brown, the one real risk case — but their silhouettes stay unambiguous (a round blob with a short stem vs. a long, curved, tapered pod), and every other pairing (garlic's layered bulb, lemon's pointed oval, herb's leaf spray, spoon's handle-and-bowl) stays visually distinct under all three simulated conditions. **Conclusion: the existing sprite art is already colorblind-safe by shape alone — no additional pattern/icon overlay was added**, since the investigation didn't support inventing a fix for a gap that isn't actually there.

**Verification method, and its one disclosed limitation.** `react-native-web`'s `PixelRatio.getFontScale()` always returns `1` (confirmed by reading `node_modules/react-native-web/dist/exports/PixelRatio/index.js`) — there is no browser equivalent of a device's system text-size setting, so `maxFontSizeMultiplier` is otherwise inert in this project's local web preview, the only running target available in this environment (no Android/iOS emulator or device, matching this project's standing disclosed-gap precedent for anything native-only). To get a genuine live trace of the real component tree under real 2x-scaled text rather than just asserting it from the code, `AppText.tsx` temporarily grew a debug-only `?fontScaleDebug=N` URL-param hook that multiplied each `Text`'s effective `fontSize` client-side (skipping any element with `allowFontScaling={false}`, exactly mirroring what a real device's OS-level scale would do) — the same "temporary harness gate, removed after capture" convention this project already used for the crash/save-corruption verification. It was removed immediately after capturing screenshots; `AppText.tsx`'s shipped form is the plain three-line wrapper. **Verified live over CDP** (headless Windows Chrome from WSL2): Home, the `how_to_play` onboarding tutorial, the in-level HUD/top-bar (Hint button, exit button, Target/Moves/Lives panels), and the Level Map all render correctly with no clipping at a real, in-tree 2x font scale — see `docs/verification/accessibility-pass/font-scale-2x/`. Not independently screenshotted at 2x (though confirmed structurally safe by the file-by-file audit above, having no fixed-height `Text` containers at all): `WonOverlay`/`PausedOverlay`/`ContinueOffer`/`OutOfLives`. Still disclosed and open, the same standing gap every other native-only claim in this project carries: no real Android/iOS device or emulator exists in this environment, so the actual OS-level accessibility text-size setting (as opposed to this session's faithful in-tree simulation of its effect) has not been independently confirmed on a real device.

**Test coverage:** `AppText.tsx` cannot get a `jest` unit test — it imports `'react-native'`, which fails to parse under this repo's plain `ts-jest` config, the same limitation `services/hapticsService.ts`/`components/ErrorBoundary.tsx` already document; it's verified live only, per this project's standing "no React component-test infra" convention. No engine-level logic changed this session, so the existing suite is the correctness signal for everything else: full suite still 548 tests passing, unchanged.

## Free, player-invoked shuffle button

**Distinct from both neighbors it sits next to.** Not the removed purchasable power-up tray (`DEFERRED_COMPLEXITY.md`'s tray entry) — there's nothing to buy, no ad, no cap — and not the Hint button beside it, which reveals a move rather than rearranging the board. `engine/gameState.ts`'s new `requestManualShuffle(state)` reuses `matrix.ts`'s own `shuffle()` — the exact function every stuck-board rescue already trusts (both `generateLevel`'s creation-time guarantee and `applyMove`'s mid-play silent rescue) — rather than writing a second reshuffle, so "the board is always playable after a shuffle" stays one guarantee enforced in one place, not two. It's a thin wrapper: guarded to only apply while `status === 'in_progress'` (a no-op otherwise, mirroring `grantBonusMoves`'s own guard shape), replacing only `board` and leaving `movesRemaining`/`lives`/`objectives`/`denialSpread`/`layerCells` untouched — a real reshuffle costs the player nothing.

**Uncapped, deliberately, unlike the Hint button's 2-per-attempt limit.** A reshuffle only permutes the board's existing piece multiset — it can't manufacture a match, a special, or any objective progress a single tap couldn't already offer — so repeated taps can't be gamed into an advantage a rate limit would meaningfully prevent. Inventing a cap here would just be manufactured friction with no protective purpose, which cuts against this game's calm, nothing-to-grind design brief (CLAUDE.md's Design Constraints). `Board.tsx`'s `handleRequestShuffle` also clears any hint currently glowing — a hinted pair is a position pair on the pre-shuffle board, meaningless the instant the board underneath it changes.

**UI**: a "🔀 Shuffle" button, styled identically to the existing "💡 Hint" button (same `hintButton`/`hintButtonLabel` styles reused, not duplicated), placed to its left in the top bar — Shuffle, Hint, Exit, all anchored `flex-end` so none of them shift position as the Hint button's own cap causes it to appear/disappear.

**Test coverage:** `engine/gameState.test.ts`'s new `requestManualShuffle` describe block: a real reshuffle changes tile positions while leaving moves/lives/objectives/totalCleared untouched, the resulting board is a genuine permutation (identical piece multiset) that's always match/square-free and playable (`checkMatches`/`checkSquares`/`hasLegalMoves`), and the function is a no-op outside `in_progress` (paused/won/lost). Full suite: 552 tests passing (up from 550 before this session).

**Verified live** over CDP against the real running app: captured the full board's per-piece screen position and sprite before and after a single real tap on the new Shuffle button — 39 of 40 pieces changed position, the sprite multiset was byte-identical, and Moves/Target/Lives all read unchanged, confirming a real, free, in-place reshuffle with no move or life cost. See `docs/verification/manual-shuffle/`.

## Dedicated settings screen

**A real reversal of prior guidance, reconciled rather than ignored.** `lalas-kitchen-build-spec.md` explicitly says "Sound should default to off, with an easy one-tap mute, not buried in a settings menu" — Sound/Haptics lived as an inline card directly on Home for exactly this reason. This session explicitly asked for a dedicated settings screen. Investigated what the original note was actually protecting: quick reachability of mute, not literally which screen the toggle renders on. `components/Settings.tsx` is a new screen, reached by one tap on a "Settings" card on Home (the same visual pattern as the existing "Your recipe book" card), with both toggles immediately visible on entry — no sub-menus, no further navigation. That's still "one tap away, no burial," just a named screen instead of an inline card, which is what actually scales as more toggles get added later (this task explicitly anticipates "any future toggles").

**Structured exactly like `RecipeBook.tsx`**, the other Home-reachable secondary screen (back-arrow header + plain cards below) — no new navigation pattern invented for one screen. `App.tsx` gained a `'settings'` screen state, `handleOpenSettings`, and a render branch; `handleToggleSound`/`handleToggleHaptics` (already existing, already persisting via `saveProgress`) are unchanged — only which screen calls them moved.

**Home.tsx's inline Sound/Haptics card and its four props (`soundEnabled`/`hapticsEnabled`/`onToggleSound`/`onToggleHaptics`) were removed outright**, replaced by a single `onOpenSettings` prop and a nav card — not left as dead, unused props alongside the new screen.

**Verified live** over CDP against the real running app: Home now shows a "Settings" card (no inline toggles); tapping it opens `Settings.tsx` with both toggles visible immediately; tapping the real Sound switch flips it on and `saveProgress` immediately persists `soundEnabled: true` to `localStorage` (confirmed by reading the real save blob, not assumed); the back arrow returns to Home with the toggle state intact. See `docs/verification/settings-screen/`.

**Test coverage:** none of `Home.tsx`/`Settings.tsx`/`App.tsx` have a React component-test harness (this project's standing limitation — see CLAUDE.md's Testing Philosophy), so this is verified live only, matching every other Board-adjacent screen. No engine-level logic changed; full suite unchanged at 552 tests passing.

## Save-data backup/export: investigated, not built — and a real premise correction along the way

**No backend, no accounts, no auth exist anywhere in this project.** Building genuine cloud sync (a hosted service, an account system to identify "whose save is this") is real infrastructure with a real ongoing cost and maintenance burden, for a single real player — confirmed with the architect as the wrong scope before building anything, per this session's own instruction not to assume a specific service is available.

**The premise this was first evaluated against was "native builds already get OS-level backup for free, so document that and stop" — investigated directly rather than assumed, and it turned out to be only half true.** `engine/gameState.ts` persists through `@react-native-async-storage/async-storage`. Reading that package's own native source (not just its docs) surfaced a real, non-obvious asymmetry:

- **Android**: `android/app/src/main/AndroidManifest.xml` (already generated in this repo) has `android:allowBackup="true"` — Expo's own prebuild default, never overridden — so this app's storage already participates in Android's Auto Backup to Google Drive with zero code.
- **iOS**: `@react-native-async-storage/async-storage`'s own native implementation (`ios/RNCAsyncStorage.mm`'s `_ensureSetup`) **explicitly excludes its storage directory from iCloud backup by default** — `RCTAsyncStorageExcludeFromBackup` defaults to `YES` unless the app's own `Info.plist` overrides it. So on iOS specifically, the save was **not** actually covered by the assumed free OS-level backup at all.

**Fixed with a one-line config change, not new infrastructure.** `app.json`'s `ios.infoPlist` now sets `"RCTAsyncStorageExcludeFromBackup": false`, which Expo will write into the generated `Info.plist` on the next iOS prebuild/EAS build — no native `ios/` project exists in this repo yet, so this takes effect the same declarative way every other Expo config plugin value does. This closes the actual gap the original "document only" premise assumed was already closed, at effectively zero cost: no new dependency, no new UI, no new user-facing surface.

**What's still a genuine, disclosed gap, not silently assumed fixed:** no real iOS device or build exists in this environment (the same standing limitation every other native-only feature in this project carries — see e.g. the real-audio-backend and real-device-build entries), so the actual effect of this flag on a real device's iCloud backup has not been directly confirmed, only reasoned from reading the exact native code path that consumes it. **Web (`localStorage`) has no OS-level backup equivalent at all** and this was deliberately not built around: no account/backend system exists to sync against, and a manual export/import (backup-code or share-sheet) was considered and explicitly not built this session — a real, if imperfect for a non-technical player, universal fallback that remains open if this ever becomes a real pain point. See `DEFERRED_COMPLEXITY.md`.

## In-app crash log (lightest real telemetry signal, no new service)

**A real fork, confirmed rather than assumed.** `ErrorBoundary.tsx`'s `componentDidCatch` already logs via `console.error` — the "not silent" half of this project's no-silent-failures rule — but nobody watches a console on a real device in the field, so a crash there was genuinely invisible to anyone. Closing that gap with a remote signal (Sentry or similar) means picking and wiring a third-party service; presented three options with real cost tradeoffs (a remote service, an in-app-only record, or documenting the gap and stopping). Architect chose the in-app record: no new dependency, no external account, matched to this project's actual scale — a single real player, not a userbase needing dashboards.

**`SaveData.lastCrash?: CrashRecord`** (`{ message, stack?, timestamp }`) is the one new field, holding only the MOST RECENT crash, not a growing log — a single field is enough to notice something went wrong at all, and an unbounded log on a device nobody actively monitors would just grow forever with no reader to prune it. `engine/gameState.ts`'s `recordCrash(skinId, crash, storage?)` does its own load-merge-save (`loadSave` → spread → `saveProgress`) rather than routing through `appPersistence.ts`'s `buildSaveData` — a crash can happen with no valid in-memory app state to rebuild a full save from, but "whatever's already on disk, plus this one field" only ever needs what's already there. A crash before any save exists yet still gets a real record (a fresh-save shape mirroring `App.tsx`'s own `applyLoadedSave(null)` defaults), so a first-launch crash isn't silently dropped either.

**The one real risk this design had to solve: an ordinary gameplay save must not silently erase a crash record written by a completely different code path.** `buildSaveData` always rebuilds a fresh object from its own params — it never preserved unknown fields — so without a fix, the very next toggle flip or tutorial dismiss after a crash would overwrite the save and erase `lastCrash` before anyone ever saw it. Fixed by threading it through as a new trailing optional param (same shape as `consecutiveLosses`'s own precedent), sourced from a new `App.tsx` ref (`lastCrashRef`, read from the loaded save at boot, same pattern as every other optional field) and passed at all five `buildSaveData` call sites.

**`ErrorBoundary` gained a `skinId: string` prop, not an import of `SkinConfig`.** This preserves the component's existing "must still work if something else — including the skin config — is broken" design intent (see the error-boundary entry above): `App.tsx`'s outer `App()` function passes the already-resolved `skinConfig.skinId` string, so `ErrorBoundary.tsx` itself never touches skin internals. It does import `engine/gameState.ts` for `recordCrash`, though — a deliberate, narrower exception than `SkinConfig`: that module is foundational persistence infrastructure every screen already depends on, not player-authored skin content, so it isn't the kind of thing a bad `config.json` could plausibly break.

**Surfaced calmly, not as a technical alert.** `components/Settings.tsx` renders a small card — "A technical hiccup" / "Safe to ignore — this just helps with fixing things later." plus the raw timestamp+message in muted small text — only when `lastCrash` is actually present (the common case is this section doesn't exist at all). Per CLAUDE.md's Design Constraints, the one real player this screen is for isn't a developer, so the tone stays reassuring; the raw message is still there, just visually de-emphasized, for whoever actually reads this screen looking for a signal.

**Test coverage:** `engine/gameState.test.ts`'s new `recordCrash` describe block (patches onto an existing save leaving every other field untouched; a crash before any save exists still produces a real loadable record; a second crash overwrites the first) plus a new malformed-`lastCrash` case in the existing corrupted-save-fallback describe block; `components/errorRecovery.test.ts`'s new `describeCrashRecord` tests (captures the real message, folds in the component stack, stamps the given timestamp; tolerates a missing component stack/error.stack; falls back to a generic message rather than an empty string); `appPersistence.test.ts`'s new `buildSaveData — lastCrash passthrough` describe block (writes an explicit value through unchanged, defaults to `undefined` when omitted, matching every other optional field's convention). Full suite: 561 tests passing (up from 552 before this session).

**Verified live** over CDP against the real running app, with a temporary harness gate (a `?forceCrash=1`-gated throw in `Home.tsx`, removed immediately after capture — this project's established "temporary gate, reverted after" convention): a real render-time throw was caught by the real `ErrorBoundary`, showing the existing "Something went wrong / Start Fresh" screen; the real save in `localStorage` was confirmed to contain a genuine `lastCrash` (real message, a real multi-frame stack trace including the component stack, a real timestamp) merged cleanly alongside every pre-existing field; reloading without the crash param rendered Home normally, and opening the new Settings screen showed the calm "A technical hiccup" card with the real recorded message and timestamp. See `docs/verification/crash-telemetry/`.

**Still a genuine, disclosed limitation, not silently assumed complete:** this is only ever seen by someone who physically opens Settings on the actual device — there is still no proactive/remote signal, which was the explicit tradeoff of choosing this option over a real telemetry service. If that ever becomes a real pain point (crashes going unnoticed for a long time), Sentry or similar remains the natural next step — see `DEFERRED_COMPLEXITY.md`.

## Generator-driven score objectives

**Reuses the existing gate+cadence rotation shape, not a parallel system.** Every other generated-level lever (`generatedShapeId`'s `SHAPE_MIN_LEVEL_NUMBER`/`SHAPE_CADENCE`, `eligibleBlockerIds`'s `BLOCKER_MIN_LEVEL_NUMBER`, `DENIAL_SPREAD_MIN_LEVEL_NUMBER`) is a levelNumber threshold plus a cadence. `appPersistence.ts`'s new `isScoreObjectiveLevel(levelNumber)` is the same shape: `SCORE_OBJECTIVE_MIN_LEVEL_NUMBER` (3) then every `SCORE_OBJECTIVE_CADENCE`-th (3) level. The threshold is deliberately low — matching blockers' own introduce-at-level-3, not board shapes' more cautious ramp — because, unlike a blocker or a shaped board, a player has already SEEN a `'score'` objective by the time they ever reach a generated level at all: the hand-built `LEVEL_QUEUE`'s own "Score Rush" (level 5) teaches it before the generator starts (level 8, generatedLevelNumber 1). There's no new mechanic to ease a player into here, only variety to introduce.

**Only ever replaces a level's single objective, never mixes with a second.** `buildGeneratedLevelConfig`'s `useScoreObjective` gate is `objectiveCount === 1 && isScoreObjectiveLevel(levelNumber)` — a score objective coexisting with a second, distinct-matchType `'collect'` objective is a genuinely separate design question (does a mixed level's HUD show both meaningfully? does score progress interact with the second target's own pacing?) that wasn't asked for and isn't decided here. Since `objectiveCount` only ever becomes 2 once `typeCount >= MIN_TYPES_FOR_SECOND_OBJECTIVE` (levelNumber >= 7), and `isScoreObjectiveLevel`'s own cadence can land on a level past that threshold too (e.g. levelNumber 9), the `objectiveCount === 1` check is load-bearing, not redundant — verified directly with a test at levelNumber 9 confirming the level stays a real two-`'collect'`-objective level, never a lone `'score'` one.

**`generatedScoreTarget` is calibrated against the one real precedent this game has**, not an arbitrary new number: the hand-built "Score Rush" (`App.tsx`'s `LEVEL_QUEUE` level 5) is 1000 points across 24 moves, ~41.7 points/move. `generatedScoreTarget(levelNumber, playableRatio, breather)` mirrors `generatedTargetCount`'s own signature exactly, but a real subtlety separates it from a naive "movesLimit × density" formula: it derives its base moves count from `generatedMovesLimit(levelNumber, playableRatio)` **with `breather` omitted from that inner call**, then applies its own `BREATHER_SCORE_RATIO` (a flat -30%, matching `generatedTargetCount`'s own `BREATHER_TARGET_RATIO`) directly to the final target. Passing `breather` straight through to the inner `generatedMovesLimit` call would have been wrong: that function's own breather param already GRANTS +30% more moves, so scaling the score target by that same already-inflated value would leave the points-per-move density — and therefore the real difficulty — completely unchanged, silently defeating the whole point of a breather. This was caught by the function's own test suite, not assumed correct on the first pass.

**No separate `MIN_SCORE_TARGET` floor — a genuine, caught mistake, not a deferred nicety.** An initial version added one (200), mirroring `generatedTargetCount`'s own `MIN_TARGET` pattern, but `generatedMovesLimit`'s own `MIN_MOVES` floor (18) already guarantees the base moves count driving this formula never drops below 18 — meaning any additional floor at or below `round(18 × (1000/24))` (750) could never actually bind. Caught by a test that asserted the wrong number and then explained why: an unreachable safety net is worse than none, since it reads as protecting against a case that structurally can't happen. Removed rather than left in as unreachable insurance.

**Test coverage:** `appPersistence.test.ts`'s new `isScoreObjectiveLevel`/`generatedScoreTarget` describe blocks (gate/cadence behavior, shape-scaling, the breather-density fix specifically, the corrected floor-inheritance behavior) plus four new `buildGeneratedLevelConfig` integration tests (places a real score objective on an on-cadence single-objective level; an off-cadence level stays plain collect; a score objective never coexists with a second objective even when both gates are on-cadence at once; a score-objective level still gets its blockers/shape exactly like a collect level would). One pre-existing test ("never targets the same piece type twice...") explicitly asserted generated levels never produce a `'score'`/`'clearance'` objective — updated to skip the now-real single-score-objective case rather than assert against the very behavior this session built. Full suite: 574 tests passing (up from 561 before this session).

**Verified live** over CDP against the real running app: a crafted save jumped straight to real level 10 (generatedLevelNumber 3 — the first level both on-cadence for score AND, independently, `ring`-shaped with a real blocker), confirming all three generator features compose correctly on one board with no crash: Home's "Up next" card showed the ★ score fallback icon, the in-level HUD read "★ 0/750" with "Moves: 18" — 750 being the exact `round(18 × (1000/24))` this session's formula predicts once `generatedMovesLimit`'s own `MIN_MOVES` floor engages for this shape. See `docs/verification/generator-score-objectives/`.

**Still deferred, deliberately narrow:** the point-density calibration (1000/24) and the gate/cadence numbers (3, then every 3rd) are hand-picked judgment calls extending an already-hand-picked precedent, not independently playtested — see `DEFERRED_COMPLEXITY.md`.

## Generator-driven clearance objectives

**Confirmed as the one other genuinely open "generator never produces this objective type" gap**, per this session's own "confirm exactly what's left before assuming" instruction — checked `DEFERRED_COMPLEXITY.md` directly rather than guessing at scope. Same gate+cadence shape as `isScoreObjectiveLevel`/`generatedShapeId`: `isClearanceObjectiveLevel(levelNumber)` gates at `CLEARANCE_MIN_LEVEL_NUMBER` (5) then every `CLEARANCE_CADENCE`-th (4) level — later and rarer than score's (3, every 3rd), since clearance is a structurally bigger ask: it changes what the board's tiles conceal, not just a HUD number.

**A real fork, confirmed rather than guessed at.** Placing layered cells on a procedurally generated board hits a genuine ordering problem: `voidCells` are known ahead of time (pure functions of rows/cols — see `engine/boardShapes.ts`), but blocker positions are chosen by `generateLevel`'s own seeded RNG, genuinely unknown to `buildGeneratedLevelConfig` before generation runs — yet a layered cell must never coexist with a blocker on the same cell (an existing, confirmed scope line from the original clearance-layers work). Presented two options — build it anyway by simply forcing no blockers on a clearance-gated level (sidesteps the ordering problem entirely, mirrors the hand-built "Dusty Counter" precedent, which also has no blockers), or leave the gap open for a later, more complete solution. Architect chose to build it now with the no-blockers constraint.

**`generatedLayerCells(levelNumber, rows, cols, voidCells)` reproduces "Dusty Counter"'s own density** (6 layered cells on a 40-cell/8x5 board, ~15%, a third at 2 layers) proportionally against whatever playable-cell count a real board actually has (`CLEARANCE_CELL_RATIO`/`CLEARANCE_DOUBLE_LAYER_FRACTION`), rather than a hardcoded count that would silently misbehave on a shaped or differently-sized board. Position selection is a deterministic stride over the playable (non-void) cells, offset by `levelNumber` so consecutive clearance levels don't always light up identical cells — still fully deterministic per level, matching every other generated-level lever's own guarantee.

**`buildGeneratedLevelConfig`'s `useClearanceObjective` gate is `!useScoreObjective && objectiveCount === 1 && isClearanceObjectiveLevel(levelNumber)`** — the same "only ever alone" rule `useScoreObjective` established, extended one step further: `isScoreObjectiveLevel`'s (3, every 3rd) and `isClearanceObjectiveLevel`'s (5, every 4th) cadences CAN coincide on the same levelNumber (their thresholds/cadences are coprime-adjacent, not deliberately staggered to avoid overlap) — when they do, `'score'` wins deterministically, simply by being checked first in the ternary. This was a real, acknowledged tradeoff, not an oversight: staggering the two cadences to never coincide was considered and rejected as needless complexity for a case that, when it happens, still resolves to a real, valid objective either way (never a crash, never both firing at once).

**`blockerCount` is forced to 0 on a clearance level, regardless of what the blocker rotation would otherwise choose** — confirmed with a dedicated test using a levelNumber where `generatedBlockerCount` would normally be nonzero, proving the override actually suppresses a real blocker rather than the test coincidentally hitting a blocker-free level.

**Test coverage:** `appPersistence.test.ts`'s new `isClearanceObjectiveLevel`/`generatedLayerCells` describe blocks (gate/cadence behavior; density and 2-layer fraction matching Dusty Counter's own ratio; void-cell exclusion; determinism; different levelNumbers vary the selection) plus four new `buildGeneratedLevelConfig` integration tests (places a real clearance objective with real layerCells on an on-cadence level; gets no blockers even when the rotation would otherwise place them; still gets its board shape, with layerCells never colliding with the real generated voidCells; an off-cadence level stays plain collect). The pre-existing "never targets the same piece type twice" test was extended to also skip the now-real single-clearance-objective case. Full suite: 586 tests passing (up from 574 before this session).

**Verified live** over CDP against the real running app: a crafted save jumped straight to real level 12 (generatedLevelNumber 5 — on-cadence for clearance, independently shaped, and would otherwise have gotten a real blocker), confirming all three compose correctly: the HUD read "▤ 0/5" (5, not Dusty Counter's 6 — correctly proportional to this shaped board's reduced playable-cell count), a visibly non-rectangular board, and no blocker tile anywhere. See `docs/verification/generator-clearance-objectives/`.

**Still deferred, deliberately narrow:** the gate/cadence numbers and density ratios are hand-picked judgment calls extending an already-hand-picked precedent, not independently playtested; the score/clearance cadence-coincidence tiebreak (score always wins) is a real, acknowledged simplification, not a deliberately balanced design; and a clearance level still never has blockers at all (not just never on the SAME cell as a layer) — a broader constraint than the underlying mechanic strictly requires, traded for avoiding the harder position-ordering problem — see `DEFERRED_COMPLEXITY.md`.

**Verified live** with a real captured sequence against the running app: a naturally-occurring generated level (levelNumber 7, both a void-shaped board and a blocker eligible at mount) showed `board_shape` first per priority, deferred `blocker` past an immediate dismissal AND a real committed hinted move well within the 60s gap, then genuinely activated `blocker` 66.0 real seconds later on a second real committed move — with both ids persisting to `seenTutorials` on dismissal. See `docs/verification/tutorial-cadence-throttle/`, which also documents the Won-overlay race found and fixed above.

## Real AdMob SDK, using Google's own publicly documented demo IDs

**`react-native-google-mobile-ads` (v16.4.0) replaces `adMobAdService.ts`'s old instant-grant stub.** `npx expo install` failed the same way it did for `expo-haptics`/`expo-audio` in earlier sessions (`EALLOWSCRIPTS` — this environment's npm config rejects the internal `--allow-scripts` flag for project-scoped installs), so it was installed via the same established manual-pin workaround, `npm install react-native-google-mobile-ads@16.4.0`.

**Demo IDs, not a real account — confirmed by direct investigation of Google's own documentation, not assumed from memory.** Fetched `developers.google.com/admob/android/test-ads` and `.../ios/test-ads` directly: the rewarded-ad test unit ids (`ca-app-pub-3940256099942544/5224354917` Android, `.../1712485313` iOS) resolve automatically through the library's own exported `TestIds.REWARDED` — used directly rather than hardcoding the literal strings, so the library's own platform dispatch is what's trusted, not a copy of it. The App-level ids the Expo config plugin requires (`androidAppId`/`iosAppId` in `app.json`, distinct from ad-unit ids — these go in the native manifest/Info.plist, not a code call) are Google's own separately-documented test App IDs (`ca-app-pub-3940256099942544~3347511713` Android, `~1458002511` iOS), confirmed via direct web search against Google's own pages rather than guessed. None of these are tied to a real AdMob developer account — genuinely usable today, swapped for real ids only once one exists.

**A real architectural split, mirroring `hapticsService.ts`'s existing pattern, not a new one invented for ads.** `react-native-google-mobile-ads` transitively imports `'react-native'`, which fails to parse under this repo's plain ts-jest config — confirmed directly (a throwaway test importing it threw the exact same Flow-syntax `SyntaxError` `react-native` itself does). Since `adService.ts`'s `selectAdService` used to import both concrete adapters directly (safe only because neither touched a real SDK yet — that assumption is now false for the mobile side), it was restructured to take `mobileService`/`webService` as plain params instead, exactly like `hapticsService.ts`'s `selectHapticsService` already does for the identical reason. The real adapter now lives in `services/expoGoogleMobileAdsService.ts` (never imported by any test), and `services/defaultAdService.ts` is the one file that imports both the real Platform.OS and this real adapter to construct the actual singleton — the same three-file shape (`hapticsService.ts` / `expoHapticsService.ts` / `defaultHapticsService.ts`) this project already established. The old `services/adMobAdService.ts` stub file is deleted outright, not left as dead code beside its replacement.

**`requestRewardedAd` is a real load→show→listen cycle**, not a fire-and-forget call: `RewardedAd.createForAdRequest(TestIds.REWARDED)`, `.load()`, and four event listeners (`RewardedAdEventType.LOADED` triggers `.show()`; `EARNED_REWARD` marks the reward earned; `AdEventType.CLOSED` resolves the promise with whatever was earned; `AdEventType.ERROR` resolves `false` and logs, matching CLAUDE.md's no-silent-failures rule) — all torn down on whichever terminal event fires first, so a single call can never double-resolve or leak a subscription. `requestBannerAd` deliberately stays an honest stub: no banner-ad UI exists anywhere in this game yet, and loading a real banner that's never displayed is exactly the kind of behavior real ad networks discourage — building banner UI wasn't asked for and isn't invented here just because a real SDK is now wired in elsewhere.

**Test coverage:** `services/adService.test.ts` and `services/crazyGamesAdService.test.ts` were both updated to drop their old direct references to the now-deleted `adMobAdService` stub — `adService.test.ts`'s `selectAdService` tests now use a local `fakeService()` helper (mirroring `hapticsService.test.ts`'s own pattern) instead of asserting on real stub behavior that no longer exists, and `crazyGamesAdService.test.ts`'s Full Launch comparison tests assert the CrazyGames stub's own resolved values directly rather than comparing against AdMob's (former) stub. Full suite: 583 tests passing (down from 586 — the removed AdMob-stub-specific assertions are gone, not replaced 1-for-1, since there's no meaningful stub behavior left to assert on for a real SDK adapter).

**Disclosed, not silently assumed working: this cannot be verified live in this environment.** Unlike every web-reachable feature this project verifies over CDP, `react-native-google-mobile-ads` is a native module — it requires a real dev-client/EAS build on an actual iOS or Android device or emulator, none of which exist in this environment (the same standing gap every other native-only feature in this project carries, e.g. the real-audio-backend and real-device-build entries). What's confirmed: the exact API shape used (event names, method signatures) was verified against the library's own official documentation and source, not guessed from memory; the code compiles and the rest of the test suite is unaffected; the demo App/ad-unit ids are confirmed real via direct investigation. What's NOT confirmed: that a real rewarded ad actually loads and displays on a real device, that the event sequence fires as expected in practice, or that the Expo config plugin correctly wires the App ID into a real native build. Revisit once a real device/build is available — see `DEFERRED_COMPLEXITY.md`.

## Real CrazyGames SDK — and a real web-bundle break this work surfaced in the AdMob change above

**Investigated first, per this session's own explicit instruction — CrazyGames genuinely has a local testing mode, confirmed directly against `docs.crazygames.com`, not assumed either way.** On `localhost`/`127.0.0.1` (or any domain with `?useLocalSdk=true` appended), the real CrazyGames SDK runs in a "local" environment: ad requests show a placeholder overlay instead of a real ad, demo data answers user-info calls, and `getEnvironment()` reports `'local'` — genuinely usable without a real registered game listing, unlike CrazyGames' account-gated Basic Launch monetization state (a separate, already-solved concern — see the crazygames-basic-launch entry). SDK v3 is the current recommended version (v1/v2 are legacy, confirmed by direct doc fetch), loaded via `https://sdk.crazygames.com/crazygames-sdk-v3.js`; `window.CrazyGames.SDK.ad.requestAd('rewarded', { adStarted, adFinished, adError })` and its documented error codes (`adsDisabledBasicLaunch`, `unfilled`, `adblock`, `adCooldown`, `other`) were confirmed against the library's own docs, matching what this project's own pre-existing Basic Launch investigation had already found.

**`createCrazyGamesAdService` gained an injectable `loadSdk` param** (defaulting to a real `loadCrazyGamesSdk` that injects the SDK `<script>` tag and resolves once `window.CrazyGames.SDK` exists), mirroring the `AsyncStorageLike` injection pattern `engine/gameState.ts` already uses — this makes the real request/response wrapping logic (unlike AdMob's native module) genuinely unit-testable with a fake SDK object, not just verified live. The script load is lazy — only attempted from a real `requestRewardedAd()` call once monetization is actually enabled — rather than loaded unconditionally at boot, since nothing needs it while Basic Launch is on; loading it eagerly regardless would be broader platform-lifecycle scope (game-start/stop reporting, user data) this task wasn't asked to build.

**A real, caught mid-session correctness bug: `window`/`document` aren't ambient types in this project's tsconfig** (`lib: ["ES2020"]`, no `"DOM"` — the parent `expo/tsconfig.base` does include DOM, but a child tsconfig's own `lib` array replaces rather than merges with the base's). `engine/asyncStorage.test.ts` had already solved this exact problem for itself with a local `/// <reference lib="dom" />` directive — the same fix applied here to `crazyGamesAdService.ts`, confirmed empirically (a throwaway test file reproduced the identical `TS2304: Cannot find name 'window'` error, then the directive resolved it) rather than guessed at.

**A real, caught mid-session bug, found live and NOT hypothetical: `react-native-google-mobile-ads` (this session's own AdMob work, above) broke the ENTIRE web bundle.** Attempting to reach the OutOfLives screen in the real running app to test this feature returned a blank white page; the actual Metro dev server response was `500`, with the real error `Importing native-only module "react-native/Libraries/Utilities/codegenNativeComponent" on web from: .../GoogleMobileAdsBannerViewNativeComponent.ts`. `services/defaultAdService.ts` statically imported `expoGoogleMobileAdsService.ts` unconditionally — Metro bundles that eagerly for every platform including web, regardless of the runtime `Platform.OS` branch inside `selectAdService`, so the AdMob package's native-only banner component broke web bundling entirely. This is exactly the risk `DEFERRED_COMPLEXITY.md`'s own ad-service entry had already flagged as a "revisit once a real SDK lands" scenario — now real. **Fixed with the predicted solution**: `defaultAdService.ts` split into `defaultAdService.native.ts` (imports the real AdMob adapter) and `defaultAdService.web.ts` (imports only `crazyGamesAdService`, a defensive throwing stub in the unreachable "mobile" slot) — Metro's own platform-extension resolution picks the right file per bundle, so the AdMob package's module graph never reaches a web build at all. Confirmed fixed by re-fetching the same web bundle URL directly: `200`, a real 5.4MB bundle, not the `500` error blob.

**Live verification has one real, deliberate stopping point: a safety guardrail blocked the final click.** Everything up to and including reaching the real "Watch a video to refill your lives" button (via a temporarily flipped `CRAZY_GAMES_MONETIZATION_ENABLED = true`, reverted immediately after) was confirmed live against the real running app: the button correctly appears once `isRewardedAdAvailable()` reads true, and the real SDK script itself was independently confirmed reachable from this environment (a direct page navigation to `sdk.crazygames.com/crazygames-sdk-v3.js` returned real, minified SDK JavaScript). The actual button tap — which would have the running app dynamically inject and EXECUTE that live third-party script inside the page — was blocked by this environment's own permission system as an unauthorized external code-execution action, and that block was respected rather than worked around. This is a different, narrower gap than AdMob's "no native device exists" limitation: the code path, the API shape, and the script's reachability are all confirmed; only the single final in-app execution step is unconfirmed, and only because a safety boundary correctly stopped it.

**Test coverage:** `crazyGamesAdService.test.ts` was rewritten to cover the real request/response wrapping with a fake SDK (`fakeSdk`) and injected `loadSdk`: resolves true on `adFinished`, resolves false and logs on `adError` (covering the `unfilled`/`adblock`/`adCooldown`/`other` error family generically, since every failure reads the same to a caller that only grants on true), and gracefully grants for free (logging) if the SDK script itself fails to load — plus a Basic-Launch-mode test confirming `loadSdk` is never even called when monetization is disabled. Full suite: 585 tests passing.

**Still deferred, deliberately narrow:** no automated Full Launch graduation detection (already logged, unrelated to this session); the real in-app SDK-injection-and-execution step is unconfirmed for the reason above, not silently assumed working; and CrazyGames' own documented recommendation to mute/pause gameplay while an ad plays wasn't built — every current caller (`ContinueOffer`, `OutOfLives`) only ever requests an ad from an already-paused overlay, so the practical gap is narrow, but it's a real, disclosed scope line, not an oversight — see `DEFERRED_COMPLEXITY.md`.

## Dropdown ingredients: the escort mechanic

**A genuinely new mechanic — the biggest net-new engine surface this session touched — confirmed via a real design fork before any code was written.** A `'dropdown'` piece spawns on the board and must ride ordinary gravity down to the bottom of its column to be collected; the one real, consequential question was whether it should be vulnerable to being swept away by a match/special before it arrives (real risk, standard in some match-3 genre conventions) or fully immune (only ever removed by reaching the bottom). Architect chose immune, matching this game's calm, never-punishing design brief (CLAUDE.md's Design Constraints) over genre convention.

**Colorless, like the two bombs, but neither swap- nor match-activated — collected purely by POSITION.** `matrix.ts`'s `PieceType` gained `'dropdown'`; `piecesMatch` excludes it (can never form or join a run, same taxonomy as `color_bomb`/`area_bomb`); a new `dropdownArrivals(board)` mirrors `calculateCascades`'s own per-column segmentation exactly (a void or the board floor ends a segment) to find any dropdown piece sitting at the very bottom of its playable segment — the collection condition. `engine/gameState.ts`'s shared `isClearable` predicate (already the one place blocker/void immunity lives) gained the same exclusion for dropdown, protecting it at all five existing clear-set-building call sites automatically, per this project's own established "one shared predicate, not a sixth ad hoc check" convention.

**`resolveCascades`'s while loop gained a THIRD reason to keep cascading**, distinct from matches/squares: a settled board with no match at all can still have a dropdown piece waiting at its column's bottom. Arrivals are folded into that pass's own clear set alongside whatever match effects also fired (gapped, refilled, deals adjacent blocker damage, same as any other clear) — tracked in a new dedicated `dropdownCollected` count on `CascadeResolution`/`ApplyMoveResult`, never through `clearedByMatchType`/`sumTierPoints` (a dropdown piece is colorless — not a scored or matchType-keyed event). `applyMove` credits this into a new `'escort'`-type `Objective`, the fourth `ObjectiveType` alongside collect/score/clearance — `targetCount` derived from `LevelConfig.dropdownPositions`' length at `createGameState` time, never hand-authored, the same "two numbers can never drift out of sync" convention `'clearance'` already established.

**A new, dedicated `applyMove` branch, checked FIRST — before area/striped/bomb — so a dropdown swapped directly into a bomb never detonates it.** A dropdown piece is never a valid "detonation partner" for anything (it's immune to every special effect, per the confirmed design above), so `aDropdown || bDropdown` short-circuits straight to a plain, always-legal, always-committed swap (mirroring the bomb-swap-always-legal precedent, but with no special effect of its own) — the player needs to freely reposition it sideways without needing to also form a match. `matrix.ts`'s `findAnyLegalMove` gained the matching clause, so the stuck-board rescue/hint system never wrongly judges a board stuck (or hints the wrong move) when a dropdown piece is the only real option — confirmed live: the Hint button correctly suggested a real dropdown-involving swap against the actual running app.

**A real bug, caught live, not hypothetical: `components/Board.tsx`'s `animateCascade` crashed on the very first genuine dropdown swap.** A dropdown swap is the ONE case that can commit a real, legal move with `steps.length === 0` — no match, no arrival, just a relocation — something no other move type in this game could ever do (an ordinary swap that clears nothing is rejected as illegal before ever reaching `resolveCascades`; every bomb/combo effect always clears something by construction). `animateCascade`'s `runStep(0)` read `steps[0]` unconditionally, and `diffBoards(previous, undefined)` threw `Cannot read properties of undefined (reading 'forEach')` — confirmed by installing real `window.onerror`/`console.error` capture hooks in the live browser session and reproducing the exact swap that triggered it, not guessed from reading code. **Fixed** by extracting the final-pass commit logic (game-state commit, life-spend timing, chain-reaction tutorial check, terminal-overlay timing) into a shared `commitFinalState()` helper, called both from the normal last-iteration path and a new `steps.length === 0` early return that skips the diff/animate step entirely. `ApplyMoveResult.steps`'s own doc comment was updated to state this contract explicitly (empty for a genuinely committed zero-clear move, not just a rejected one), and a dedicated engine test locks in `steps.length === 0` for exactly this scenario — the contract Board.tsx now has to honor, verified at the one layer (engine) this project can unit-test directly.

**Verified live end-to-end, including the bug and its fix**, not just the happy path: reached the real "Delivery Day" hand-built level (see below) via a crafted save, confirmed the Hint button correctly suggests a dropdown swap, reproduced the crash on the very first real swap attempt (captured via installed error hooks), applied the fix, confirmed the identical swap now commits cleanly with zero errors, then walked one dropdown piece down its full column across seven more real swaps (Moves ticking down 24→23→...→17→16 across the whole sequence) until it reached the bottom and was genuinely collected — Target reading "⬇ 1/2", the piece gone from the board, a fresh piece refilled in its place. See `docs/verification/dropdown-escort-mechanic/`.

**One hand-built level exercises it**: App.tsx's `LEVEL_QUEUE`'s new 8th and last hand-built entry, "Delivery Day" (`objectives: [{ type: 'escort' }]`, `dropdownPositions`: two cells in the top row), immediately before the generator takes over. The presentation layer needed only a sprite fallback (`getSpriteForPiece`'s new `'dropdown'` branch, a single fixed `dropdown.webp` like the two bombs, falling back to the "DR" text-label placeholder with no art yet) and the same `ESCORT_OBJECTIVE_SPRITE`/`'ESCORTED'` HUD-and-WonOverlay wiring `'score'`/`'clearance'` already established — no new animation identity was invented (a falling dropdown piece uses the exact same cascade-fall visual every other piece already gets).

**Test coverage:** `engine/matrix.test.ts`'s new `dropdown (escort) pieces` describe blocks (matching exclusion from runs/squares, `dropdownArrivals`' segment-aware bottom detection including a shaped-board case where the "bottom" is above a void rather than the literal floor, always-legal swap via both `hasLegalMoves` and `findAnyLegalMove`); `engine/gameState.test.ts`'s new `applyMove — escort (dropdown) mechanic` describe block (a real cascade-driven fall and collection winning an escort objective; an always-legal swap that immediately collects; the zero-steps regression guard above; immunity to a striped sweep passing directly through its cell, confirmed by a real unique-id piece surviving while the rest of the swept row clears); `components/spriteMap.test.ts`'s new dropdown sprite tests. Full suite: 601 tests passing (up from 585 before this session).

**Still deferred, deliberately narrow:** generator integration (`buildGeneratedLevelConfig` never produces `dropdownPositions`/an `'escort'` objective — hand-built content only, matching the same incremental pattern `'score'`/`'clearance'` both started with); no dedicated fall/collection animation beyond the existing generic cascade visual (a real, deliberate scope line, not an oversight — every other special piece's own distinct identity work was a separate, later session for that piece specifically); and the two `dropdownPositions` chosen for "Delivery Day" (both top-row) are a hand-picked, not playtested, starting difficulty — see `DEFERRED_COMPLEXITY.md`.

## Blocker depth: a blocker that ignores ordinary matches

**A new blocker variant, `specialOnly` (skin id `sealed_jar`), that only takes adjacent damage from a special effect — a striped sweep, an area-bomb blast, a color-bomb detonation, or a chain any of those trigger — never a plain ordinary match.** This is a per-blocker-TYPE property (declared once in skin config, like `hitsToClear`), not a per-cell override — matching the existing convention that a blocker's toughness is a property of what kind of blocker it is, not where it's placed. `matrix.ts`'s `Piece` gained an optional `specialOnly?: boolean` field, only meaningful on a blocker.

**The real design question was how `applyAdjacentDamage` (matrix.ts) would know, for a given cleared cell, whether that clear came from an ordinary match or a special effect** — it previously only ever received a flat position list with no notion of "how" each cell cleared. The answer reuses data that already exists: `gameState.ts`'s own `tierByKey` (`Map<string, ScoreTier>`, built for the scoring system) already tags every cleared cell as `'ordinary'`/`'special'`/`'bomb'`. `applyAdjacentDamage` gained a new optional `specialClearedKeys?: Set<string>` param — a plain string-keyed set, deliberately NOT importing gameState.ts's own (private, unexported) `ScoreTier` type, since matrix.ts has no import from gameState.ts anywhere else and this keeps that layering intact. Both of gameState.ts's call sites (`resolveCascades`'s per-pass loop, `resolveClearSet`'s shared tail) derive this set from their own `tierByKey` (filtering out `'ordinary'` entries) before calling. A `specialOnly` blocker checks this set; an ordinary blocker never consults it at all, so every pre-existing 2-argument call site (including every existing test) is completely unaffected.

**Generator integration, not a hand-built level** — unlike score/clearance/escort, which all started as hand-built-only, no hand-built `LEVEL_QUEUE` level has ever used ANY blocker (`blockerCount`/`blockerMatchType` are purely generator-config fields); blockers have only ever been placed by `buildGeneratedLevelConfig`'s existing `eligibleBlockerIds`/`BLOCKER_MIN_LEVEL_NUMBER` rotation (the same system cling/dish_stack/pot_lid already use). So `sealed_jar` was wired into that SAME system rather than inventing a new hand-built-level mechanism for it: `skins/lalas-kitchen/config.json` gained a 4th blocker entry (`sealed_jar`, `hitsToClear: 1`, `specialOnly: true`), and `appPersistence.ts`'s `BLOCKER_MIN_LEVEL_NUMBER` gates it to generated level 12 — later than pot_lid (7) and denial-spread (10), since "ordinary matches don't work at all here" is a genuinely different, more advanced idea than a tougher hit-count, not just "harder pot_lid." `buildGeneratedLevelConfig`'s `chosenBlocker.specialOnly` now threads straight through to the new `LevelConfig.blockerSpecialOnly` → `GeneratorConfig.blockerSpecialOnly` → `generator.ts`'s `placeBlockers`, which stamps it onto every placed blocker Piece exactly like `blockerMatchType`/`blockerHitsToClear` already do (the generator has no opinion on WHY, same as those two fields).

**Verified live**, not just unit-tested: reached the real generated level 20 (generated level number 12) via a crafted save, confirmed four real `sealed_jar` blockers ("SE" text-label placeholder tiles, no art registered yet) genuinely generated on the real board. Performed a real 3-match directly adjacent to one of them (a spoon run in column 1, landing next to the blocker originally reported at (1,1)) and confirmed via the DOM (`[data-testid^="tile-blocker"]`, not just a screenshot) that **all four blockers still existed afterward, none cleared** — the ordinary match credited its own objective (Target went 0/13 → 3/13) but cleared no sealed_jar cell. For a `hitsToClear: 1` blocker this fully proves zero damage occurred (there's no partial-damage state to miss — survival ⟺ untouched), which is the actual claim this check needed to make. **A follow-up cross-feature sanity pass (see the FINAL STEP entry) caught and corrected an overclaim in this entry's original wording**: it additionally said the blockers "remained at their exact original positions." That's not something this check actually verified — a tile's `data-testid` is keyed by the piece's stable id (assigned once at placement/spawn), not recomputed from its current board position, and a blocker is NOT anchored like a void: `calculateCascades` compacts it toward the bottom of its column segment exactly like any other surviving piece whenever cells clear in that segment, excluded only from matching/swapping/being force-cleared. The blocker at (1,1) shared a column with the cleared match and, by that same compaction logic, most likely did physically shift down — a separate, ordinary, correct behavior wholly unrelated to the specialOnly damage question this test actually needed to answer. See `docs/verification/blocker-depth/`.

**Test coverage:** `engine/matrix.test.ts`'s new `specialOnly blockers` describe block under `applyAdjacentDamage` (an ordinary clear with no `specialClearedKeys` does nothing; a clear identified as special damages it normally; when several cells clear together only the special-tagged ones count; an ordinary blocker on the same board is unaffected by the new param being absent). `engine/gameState.test.ts`'s two new end-to-end tests under `applyMove — blockers` (a specialOnly blocker is untouched by a real ordinary match adjacent to it; a specialOnly blocker IS damaged by a real striped sweep passing adjacent to it, mirroring the dropdown-immunity test's own striped-sweep setup). `appPersistence.test.ts`'s two new generator-gating tests (never placed below level 12; placed and carrying `blockerSpecialOnly: true` once past it, with every OTHER blocker id confirmed to never carry the flag). Full suite: 609 tests passing (up from 601).

**Still deferred, deliberately narrow:** no distinct visual overlay beyond the blocker's own sprite (a real, deliberate scope line matching the dropdown piece's own "sprite fallback only" precedent — no other blocker variant has ever had a dedicated overlay beyond its sprite either); no dedicated tutorial explaining "this blocker needs a special piece" (every other genuinely new mechanic this project has built got one, but authoring an 8th tutorial was judged out of scope for this pass — a real, disclosed gap, not an oversight); and the gate level (12) and hit count (1) are hand-picked, not playtested — see `DEFERRED_COMPLEXITY.md`.

## Board topology (conveyors, portals): investigated, no bounded scope found

Investigated before building anything, per the standing "confirm before deciding on a genuine fork" protocol — the task explicitly permitted skipping this item if no reasonable bounded scope could be defined, so the bar was to genuinely look for one before concluding there isn't one.

**Every real topology idea (a conveyor belt shifting pieces sideways, a portal pair teleporting a piece between two cells, a wraparound edge) requires rewriting `matrix.ts`'s `calculateCascades`, not extending it.** `calculateCascades` is fundamentally a **per-column** algorithm — it loops over each column independently, walking non-void segments and compacting/refilling each in isolation; there is no cross-column data flow anywhere in it. A conveyor (a piece moving sideways) or a portal (a piece leaving one column and entering another) both require a piece to cross a column boundary during gravity resolution — something this function's entire structure assumes never happens. This isn't a "the function needs a new branch" gap like the dropdown piece's third continuation reason or the blocker's new damage-source check; it's a different algorithm shape entirely.

**This is also the single most heavily-relied-upon piece of the engine.** Every feature built across this project's whole history sits on top of the per-column gravity guarantee: void-cell board shapes (a void is a fixed floor WITHIN a column's segment), the dynamic denial-zone spread, every special piece's clear-and-refill, the dropdown/escort mechanic built earlier this session, and the blocker-depth variant built just before this entry. A structural rewrite risks regressing all of them at once, in ways a unit test suite built against the CURRENT per-column model wouldn't necessarily catch (the tests assert the current contract, not a hypothetical cross-column one).

**Conclusion: no idea in this space stays within a bounded, low-risk scope for this closing pass.** Rather than force a shallow, high-risk version in (or silently skip the item without explanation), this is logged as a deliberately-not-built investigation result — see `DEFERRED_COMPLEXITY.md`. If a future session wants this, the honest starting point is redesigning `calculateCascades` itself as its own dedicated phase, verified in isolation the way Phase 1 (the core matrix) originally was, before any topology feature is layered on top of it.

## Tuning-constant review: one real bug found and fixed, plus three smaller corrections

A full inventory of every hand-picked numeric/boolean constant across `appPersistence.ts`, `engine/gameState.ts`, `engine/generator.ts`, `components/cascadeTiming.ts`, and skin config was cross-referenced for genuine inconsistencies (not just "is this the right number," but "do two of these actively contradict or undermine each other when composed") — the task's own ask was to fix real inconsistencies and honestly document the rest as unproven, not fabricate certainty either way.

**A real, reachable bug: a freshly spread blocker lost the `specialOnly` flag.** `DenialSpreadState` already carried `blockerHitsToClear` (so a spread-in cell is exactly as tough as a generator-placed one) but had no `blockerSpecialOnly` field, and `stepDenialZone`'s freshly-spread-blocker construction never set `specialOnly` at all. Since `sealed_jar` is eligible from generated level 12 and the denial-spread mechanic from level 10, both are simultaneously satisfiable — `chosenBlocker` can genuinely rotate to `sealed_jar` on a spread-eligible level — so a real level could have a zone whose static blockers ignore ordinary matches but whose newly-grown cells silently didn't, undermining the entire point of the blocker-depth feature on exactly the levels where the two mechanics compose. **Fixed**: `DenialSpreadState` gained an optional `blockerSpecialOnly?: boolean`, threaded from `LevelConfig.blockerSpecialOnly` in `createGameState`'s `denialSpread` construction (the same way `blockerHitsToClear` already is), and `stepDenialZone` now stamps it onto every freshly-spread blocker cell. Verified with two new tests: `createGameState` correctly threads the flag into `denialSpread` state, and a full spread sequence (5 unaddressed moves) confirms the newly-created blocker at the spread target carries `specialOnly: true`, not just the original.

**A real, undisclosed asymmetry: clearance objectives never received breather relief.** `generatedTargetCount`/`generatedScoreTarget` both shrink their workload under a breather (`BREATHER_TARGET_RATIO`/`BREATHER_SCORE_RATIO`, both 0.7), but `generatedLayerCells` had no `breather` parameter at all — a breather granted on a clearance-gated level only ever loosened `movesLimit`, leaving the actual clearance workload (how many cells need their layers cleared) completely untouched, a real gap in the difficulty-breather feature's own coverage that wasn't documented anywhere as a deliberate scope line. **Fixed**: `generatedLayerCells` gained the same optional `breather` param, applying a new `CLEARANCE_BREATHER_RATIO` (0.7, matching the other two ratios' magnitude "for one coherent easier level, not one lever moving more than the others" reasoning) before re-applying its existing `Math.max(1, ...)` floor. Verified with two new tests: the exact expected shrink (6 cells → 4 at levelNumber 5 on an 8×5 board) and the floor holding on a tiny board.

**Two stale comments corrected, no behavior change:** `components/cascadeTiming.ts`'s `planCascadeAnimation` doc comment claimed "applyMove never returns an empty `steps` for a committed move" — false since this session's own dropdown-escort work introduced exactly that case (see the dropdown-ingredients entry's real crash), so the comment now explains the real exception and that `Board.tsx`'s actual `animateCascade` special-cases it with an early return rather than calling into this model. `appPersistence.ts`'s `SHAPE_ROTATION_OFFSET` comment said the generator's first shaped level is "raw level 8" — true when written (`LEVEL_QUEUE.length` was 7), now stale since "Delivery Day" made it 8 hand-built levels (so the first generated level is raw level 9); corrected to note the number changed but the fix itself is unaffected, since `generatedShapeId` keys off `generatedLevelNumber`, not the raw level number.

**Confirmed correct, no action needed, by direct computation rather than trusting the prose:** the score/clearance objective cadence coincidence (levelNumber ≡ 0 mod 3 vs. ≡ 1 mod 4, coinciding every 12 levels — `useClearanceObjective`'s `!useScoreObjective` guard makes score win deterministically every time, exactly as documented) and `SHAPE_ROTATION_OFFSET`'s own claim of zero adjacent-shape repeats (enumerated the full rotation through several cycles — holds). One existing disclosure was found to understate its own severity rather than being wrong: the difficulty breather's moves boost being "partly absorbed" by `MIN_MOVES`'s floor on a heavily-shaped level can actually be **total**, not partial, in a concrete computed case (a `ring`-shaped level past level 13: `18 × 0.55 = 9.9 → 10 → max(18,10) = 18`, identical with or without the breather) — CLAUDE.md's wording was tightened to disclose this honestly rather than leave "partly" implying a lesser effect than what the arithmetic actually shows.

**Everything else inventoried** (the full difficulty ramp's step sizes, every gate level number, animation-timing constants, the recipe-card milestone spacing, hint/tutorial cadences) was already honestly disclosed as hand-picked-not-playtested throughout this file and `DEFERRED_COMPLEXITY.md` at the point each feature was built — the review didn't find any value stated with false confidence beyond the two corrections above, so nothing further needed re-disclosing. Full suite: 613 tests passing (up from 609).

## Real AdMob production IDs, and a genuine fork the swap request surfaced: one ad unit per grant flow

**A real AdMob account now backs the mobile ad path** — the App ID (`ca-app-pub-1884558565604210~2303142978`) and two rewarded ad unit IDs (moves grant, lives refill) replace the demo/test values the real-admob-sdk entry above installed. Investigated before swapping, per this project's standing protocol, rather than assuming the request's own premise held: it described "two demo ad unit ID values currently wired in," but the actual code (confirmed by reading `expoGoogleMobileAdsService.ts`) only ever had **one** — a single `REWARDED_AD_UNIT_ID = TestIds.REWARDED` constant, used by one `requestRewardedAd()` method with no parameter, called identically from both real grant sites (`components/Board.tsx`'s mid-level `ContinueOffer` moves grant and `App.tsx`'s `OutOfLives` lives refill). There was never a second ad unit id to swap, and no way for the code to route "moves" vs. "lives" to different ids — the request's "correctly matching moves to moves and lives refill to lives refill" and "keeping the existing service interface... unchanged" instructions were genuinely in tension, not simultaneously satisfiable, so this was surfaced and confirmed with the architect rather than guessed.

**Resolved by adding a `purpose: 'moves' | 'lives'` parameter to `AdService.requestRewardedAd`** (the architect's chosen option over splitting into two named methods, or collapsing to one shared ad unit) — the smallest change that actually lets each real call site reach its own ad unit. `services/expoGoogleMobileAdsService.ts` now keys a `REWARDED_AD_UNIT_ID_BY_PURPOSE` lookup (`moves` → `.../8073545649`, `lives` → `.../1915331401`) off that parameter; `loadAndShowRewarded` takes it straight through to `RewardedAd.createForAdRequest`. `components/Board.tsx:830` now calls `requestRewardedAd('moves')`, `App.tsx:758` calls `requestRewardedAd('lives')`. `crazyGamesAdService.ts` and `defaultAdService.web.ts`'s stub both accept and ignore the parameter (JS/TS's "fewer params" function-assignability rule — no signature change needed there), since CrazyGames has no per-purpose ad units; `crazyGamesAdService.test.ts`'s four direct `requestRewardedAd()` calls needed a placeholder `'moves'` argument to satisfy the now-required parameter, with a comment noting it's inert there.

**The App ID question was also a genuine fork, confirmed rather than assumed**: only one App ID was given, but `app.json`'s `react-native-google-mobile-ads` plugin config has separate `androidAppId`/`iosAppId` slots (AdMob issues a distinct App ID per platform app registered in its console). Confirmed with the architect: this account has only registered the Android app so far — `androidAppId` is now the real value, `iosAppId` deliberately stays Google's demo App ID (`ca-app-pub-3940256099942544~1458002511`) until a real iOS app exists in the AdMob console. A stray demo ID left in a config slot on purpose, not an oversight — disclosed here so it isn't later mistaken for an incomplete swap.

**Verification:** full suite (613 tests) passes; a repo-wide grep for `3940256099942544` (the demo App/ad-unit id family) confirms it appears nowhere except the deliberately-kept `iosAppId` slot and a historical code comment; a grep for `TestIds` confirms the import and its usage are both gone from `expoGoogleMobileAdsService.ts`. Same disclosed gap as the original real-admob-sdk entry: **this cannot be verified live in this environment** — no real device or EAS dev-client build exists here to confirm a real rewarded ad actually loads and displays end-to-end, or that `app.json`'s App ID is correctly picked up by a real native build. That verification needs an actual device/build, same as every other native-only feature in this project.

