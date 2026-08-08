# SPEC.md — Lala's Kitchen: Game-Feel Overhaul (piece-transition mechanics)

<!--
This file is the contract between the architect (me + conversational Claude)
and the runner (Claude Code). The runner implements against this file, not
against chat memory. Drift is defined as code that disagrees with this spec.
If the spec is wrong, change the spec first, then the code. Never the reverse
silently.

Status meanings:
  DRAFT      = still being shaped in conversation, do not implement
  AGREED     = frozen enough to build against
  SUPERSEDED = replaced; link the successor
-->

**Status:** AGREED
**Date agreed:** 2026-08-08 (Kevin, in conversation: "I'm good with all your recommendations")
**Owner:** Kevin

---

## 1. Problem

<!-- One paragraph: what problem, for whom, and which lane this build
     serves (joy, career evidence, or both). Joy builds don't need market
     permission — no validation gate here. But be honest about the lane:
     a career-evidence build with no audience in mind is neither. -->

**Problem:** Piece transitions still don't feel like other match-3 games
(Royal Match, Candy Crush), a complaint that has survived five swap-tuning
passes. A 2026-08-08 design review traced the remaining cause to structure,
not tuning: (a) every fall runs one fixed 480ms duration regardless of
distance, so pieces in the same cascade visibly move at different speeds
(a 6-cell fall travels 6× faster than a 1-cell fall); (b) refill pieces
materialize mid-board at a fixed `r - 2` with an opacity fade instead of
streaming in from above the board edge; (c) cascade passes play as global
lockstep beats on a fixed 480ms metronome (`cascadeStepIntervalMs`)
regardless of pass content — a slideshow, not continuous motion; (d) falls
decelerate to zero velocity (critically damped spring) and *then* play an
impact squash, which is physically contradictory. The prior swap work
(critical damping for swaps, squash-and-stretch, travel fix for the cleared
half of a swap) is correct and is kept. The calm brief is not being traded
away: smoothness in the reference games comes from continuity, not speed —
this changes the *shape* of motion, not its intensity.

**Lane:** Both. Joy first (the game's one real player experiences these
transitions on every move, and the game is live on both stores). Career
evidence second: "diagnosing game feel structurally instead of tuning
constants for a sixth time" is a genuinely tellable engineering story.

## 2. Scope

**In scope (this build):**
- **Distance-proportional fall timing.** A tile's fall duration derives
  from its actual travel distance (both ends are already known in
  `Tile.tsx`'s position effect: `rowShared.value` before assignment vs the
  incoming `row`), shaped as `base + perCell × distance` with a cap, so all
  falling pieces move at visually consistent speed and arrival times vary
  naturally. Swap motion keeps its own fixed `swapDurationMs` — a swap is a
  one-cell gesture and is already correct.
- **Top-edge spawn streaming with board clipping.** Spawned refills enter
  from above the board's top edge (stacked negative rows per column: the
  Nth refill in a column starts N rows above the edge), fall their real
  distance at the same distance-proportional timing, and are clipped by an
  `overflow: hidden` board container. The `enterFromRow = r - 2` rule and
  the spawn opacity fade-in are removed — a clipped entry needs no fade.
- **Content-driven cascade pass scheduling.** Pass *i+1* begins when pass
  *i*'s longest computed motion (fall or clear, whichever ends later)
  lands, plus one short fixed breathing beat — replacing the flat
  `cascadeStepIntervalMs = cascadeDurationMs` (480ms) metronome. The
  engine's pass model (`applyMove`'s `steps`) is untouched; this is
  presentation scheduling only. The existing chain-staging holds
  (`chainHoldMs`) and terminal-overlay hold compose on top unchanged in
  spirit, re-derived from the new per-pass duration.
- **Accelerating fall easing.** Falls (and top-edge spawn entries) use an
  accelerating gravity-like profile so a piece lands *with* velocity,
  which is what motivates the existing squash-and-stretch landing beat.
  Swaps and drag-return stay critically damped (`TILE_MOVE_DAMPING_RATIO
  = 1`) — a hand placing a piece decelerates; a falling piece doesn't.
- **Remove the artificial 25ms/column left-to-right drop stagger**
  (`COLUMN_DROP_STAGGER_MS`) — with distance-based timing, arrival
  variation emerges from physics and the choreographed ripple is no
  longer needed.
- **Ordinary-match anticipation beat** (fork resolved IN, 2026-08-08) —
  matched tiles brighten/swell briefly before shrinking, the genre's
  "recognize → celebrate → remove" grammar. Folded into the *front* of
  the existing `matchDurationMs` budget the same way the sweep's
  `SWEEP_GLOW_POP_MS` already is, so the clear's total time — and the
  pass schedule arithmetic — is unchanged.

**Explicitly out of scope:**
<!-- Anything cut mid-build goes to DEFERRED_COMPLEXITY.md per the baseline,
     but known cuts get listed here up front so the runner never "helpfully"
     builds them. -->
- **Continuous per-column gravity resolution** (the full genre model:
  columns resolve locally and independently the moment space opens, no
  global pass boundaries at all). This requires abandoning the engine's
  settled-board pass snapshots as the presentation contract and touches
  the same structural boundary the board-topology investigation already
  declined to cross. Log in DEFERRED_COMPLEXITY.md; the in-scope items
  are expected to capture most of the felt difference.
- Any engine (`engine/`) change. `applyMove`, `calculateCascades`, and the
  `steps` contract are untouched — this is a presentation-layer build.
- Any change to special-effect identity animations (sweep travel, radial
  ripple, supercombo beats, chain-link stagger). Their *delays* re-anchor
  to the new pass schedule; their internal shapes and constants stay.
- Any intensity increase: no particles, no screen shake, no flash beyond
  the (forked) anticipation brighten. Calm brief holds.
- Sound/haptics changes.

## 3. Architecture decisions

<!-- One block per meaningful decision. Same rule as "Justify every change"
     in the baseline, applied at design time: the shape, the why, and the
     alternative not taken. These blocks double as ADRs and as content seeds
     for the Career evidence section. -->

### Decision: Distance-proportional durations, computed in the presentation layer
- **Choice:** Per-tile fall duration = `base + perCell × |Δrow|`, capped;
  computed where the motion starts (`Tile.tsx`'s position effect /
  `ExitingTile`'s travel), from data already present. Constants live in
  `cascadeTiming.ts` beside the existing motion constants.
- **Why:** Uniform *velocity* (not uniform duration) is what makes genre
  cascades read as physical. The effect site already knows both endpoints,
  so no new data needs threading from Board or the engine.
- **Rejected alternative and why:** A true acceleration integrator
  (per-frame gravity simulation) — more physically pure, but Reanimated's
  declarative duration+easing API expresses the same perceived profile
  without a custom frame loop, and a closed-form duration keeps the pass
  schedule computable (the content-driven scheduling below depends on
  knowing each pass's longest motion up front).

### Decision: Spawns stream from above the board edge, clipped, no fade
- **Choice:** The Nth spawn in a column enters at row `-(N)` relative to
  its column's segment top; the board container gains `overflow: hidden`;
  the spawn opacity fade is deleted.
- **Why:** Materializing mid-board at `r - 2` with a fade reads as
  teleportation, and the fade exists only because there was no clipping to
  hide an off-board entry. Streaming from the edge is how every reference
  game reads, and it makes refill motion obey the same distance-based
  timing as everything else.
- **Rejected alternative and why:** Keeping the fade with a larger fixed
  offset (e.g. `r - 4`) — still distance-blind, still materializes pieces
  in mid-air on tall boards, and fixes neither the velocity inconsistency
  nor the dreamlike fade. Also rejected: clipping via per-tile masks —
  one `overflow: hidden` on the existing board frame is strictly simpler.
- **Void-segment exception (fork resolved, 2026-08-08):** a spawn
  refilling an *enclosed* segment (one whose top row is not the board's
  row 0 — e.g. the plus shape's pocket) has no edge to stream from, and
  entering "above the segment" would visibly cross a void. That one case
  **retains a brief fade-in at its landing cell** (no travel) — the
  no-fade rule applies only to segments that touch the board's top edge,
  where streaming is physically possible. Rare by construction and
  disclosed in DEFERRED_COMPLEXITY.md.

### Decision: Content-driven pass scheduling, engine pass model retained
- **Choice:** `planCascadeAnimation` (already the single source of truth
  for pass timing) computes each pass's start from the previous pass's
  actual longest motion plus one short fixed beat, instead of a flat
  480ms interval. Board's chained `setTimeout`s realize the same schedule
  shape they do today.
- **Why:** Kills the dead metronome air between beats — the largest
  slideshow contributor — while keeping the engine contract, the chain
  staging, the terminal-overlay hold, and the entire test surface of the
  existing schedule model intact. `planCascadeAnimation` stays pure and
  testable.
- **Rejected alternative and why:** Continuous per-column resolution (see
  out of scope) — the genre-ideal, but a structural rewrite of the
  presentation/engine boundary that every shipped feature currently sits
  on, for a gain the in-scope items mostly capture. Deferred, not denied.

### Decision: Accelerating easing for falls; critical damping stays for swaps
- **Choice:** Falls run an accelerating (ease-in-shaped, gravity-like)
  profile into the landing squash; swaps, drag-return, and snap-back stay
  on the critically damped duration-spring.
- **Why:** The squash-and-stretch beat is an *impact* animation; impact
  requires arrival velocity. The current decelerate-then-flinch sequence
  is internally contradictory. Swaps are a different physical story (a
  deliberate placement) and their current feel was explicitly tuned and
  accepted — don't reopen it.
- **Rejected alternative and why:** One easing for all motion (the current
  state) — simpler, but it is precisely the incoherence being fixed. Also
  rejected: reintroducing spring overshoot for landings — already tried
  and reversed for cause (Follow-up 5: a tile leaving its own cell reads
  as the grid flexing); the zero-overshoot rule stands.

### Decision: Anticipation beat for ordinary matches — IN (resolved 2026-08-08)
- **Choice:** Ordinary match clears play a mild brighten-and-swell folded
  into the front of `matchDurationMs` (the sweep's existing
  pop-then-shrink pattern at lower intensity), then the normal shrink.
- **Why:** Completes the feedback grammar — every special effect already
  gets a pop; the game's most common event was the only one that just
  evaporated. Folding it inside the existing clear budget means zero
  pacing-arithmetic change, which was the original hesitation.
- **Rejected alternative and why:** Deferring it — rejected by the
  architect on recommendation, since implemented-inside-the-budget it
  carries none of the pacing risk that motivated the fork.

## 4. Data model

<!-- Tables/collections, ownership, and the access rule per table.
     For anything multi-tenant or user-owned, state the enforcement
     mechanism explicitly (RLS forced, not just enabled). -->

No database. This is a presentation-layer build in a client-only game;
the "data model" is the animation-constant surface, listed so drift is
checkable:

| Table | Owned by | Access rule | Enforcement |
|-------|----------|-------------|-------------|
| `components/cascadeTiming.ts` constants (new: fall `base`/`perCell`/`cap`, pass breathing beat; removed: `COLUMN_DROP_STAGGER_MS`) | Presentation layer | Single source of truth for all motion timing; Board/Tile import, never inline numbers | Existing `cascadeTiming.test.ts` pattern — every constant exercised by a schedule test |
| `skins/lalas-kitchen/config.json` `animationProfile` | Skin | Qualitative knobs only. Resolved 2026-08-08: `cascadeFallSpeed` now maps to a *velocity profile* (base + per-cell ms) in `cascadeTiming.ts`, not a flat duration — the config file itself is unchanged (still `"medium"`), only the mapping's meaning changes, per the leak test | Schema in `components/skinConfig.ts` |
| `SaveData` | Engine | **Unchanged — this build must not touch persistence** | Existing `gameState.ts` load/save tests |

## 5. Security posture

<!-- The baseline deployment floor applies automatically and is not
     restated here. This section is only for what is ABOVE the floor
     for this project, or any floor item deferred (which also goes to
     DEFERRED_COMPLEXITY.md with a reason). -->

**Above the floor:**
- Nothing new. No network surface, no persistence change, no new
  dependency (explicitly: no animation library beyond the existing
  Reanimated).

**Floor deferrals (should be empty):**
- None introduced by this build.

**Adversarial pass scheduled:** No — no attack surface changes. The
adversarial equivalent for this build is the regression matrix in
section 6 (the animation pipeline has a history of interaction bugs:
zero-pass dropdown commits, drag-release offsets, chain staging, shuffle
moving pieces upward).

## 6. Verification plan

<!-- This section IS the input to verify.sh. Every row names a behavior and
     the raw signal that proves it against the live system. If a behavior
     has no signal listed, it is not verifiable, which means it is not done.
     Per the baseline: the trace, not the claim. -->

There is no deployed server; "live" here means the real running app over
CDP (the project's established capture method) plus the device in the
field. Evidence lands in `docs/verification/game-feel-overhaul/`.

| Behavior | Command / probe | Signal that proves it |
|----------|----------------|-----------------------|
| Fall speed is distance-consistent | Frame-by-frame CDP trace of one move producing both a 1-cell and a ≥4-cell fall | Measured average px/frame within 25% between the two tiles (the small fixed `base` skews short falls slightly slower by design); 1-cell fall completes in ~`base + perCell` ms, not 480ms |
| Spawns stream from the top edge | CDP trace of a multi-spawn column refill | Each spawn's first visible pixel is at/above the board's top edge; no mid-board first frame; no opacity ramp on a spawn |
| Board clips off-board tiles | Same trace | No tile pixel ever renders outside the board frame's bounds |
| Pass schedule is content-driven | Timestamp log of `runStep(i)` calls for a ≥3-pass cascade with mixed fall depths | Inter-pass gaps ≈ (that pass's longest motion + beat), varying pass to pass; no constant 480ms spacing |
| Falls accelerate; swaps don't | Per-frame position deltas from the trace | Fall deltas increase monotonically until landing; swap deltas keep the current critically damped profile (unchanged vs a pre-build reference trace) |
| Squash beat still plays, at landing | Trace of a fall's final frames | Scale distortion begins within one frame of position arrival |
| Swap feel regression: none | Re-run the `docs/verification/swap-smoothness/` capture method | Swap traces byte-comparable in profile to current build (duration, damping, squash) |
| Zero-pass dropdown swap still commits (known crash class) | Scripted dropdown sideways swap with no match/arrival | Move commits, both tiles relocate, no throw — same probe as `docs/verification/dropdown-escort-mechanic/` |
| Chain staging still staggers per link | Re-run `docs/verification/chain-staging/` probe | Wave *w* cells begin clearing `w × CHAIN_LINK_STAGGER_MS` after wave 0, on the new schedule |
| Terminal overlay never cuts off the final pass | Winning-move trace | Overlay's first frame is after the final pass's longest motion + hold, per the updated `planCascadeAnimation` |
| Test suite green | `npx jest` | All passing, including new schedule/duration unit tests (current baseline: 657) |
| It actually *feels* right | Real on-device play by Kevin (and the game's real player) after the next build/OTA ships | Field report — the same standard that caught the sound redesign; explicitly not closable in-agent |

## 7. Career evidence

<!-- Career evidence is shifted left, same as security. These artifacts get
     produced DURING the build as a side effect, not after it as a project.
     The audience is hiring managers and engineering peers, not customers.
     Check them off as they happen.

     Shipped, for this lane, means live plus narrated: deployed, verify.sh
     evidence in hand, and this checklist done. "Technically complete" with
     this section empty means the project is not complete. -->

- [ ] One debugging story written up while fresh: "five tuning passes
      didn't fix game feel because the problem was structural — fixed
      duration vs fixed velocity" (bug, hunt, root cause)
- [ ] Before/after capture pair (screen recording of the same cascade on
      both builds) — the single most shareable artifact this build produces
- [ ] One decision block from section 3 turned into a post draft
      (candidate: "content-driven scheduling vs continuous gravity —
      keeping the engine boundary")

## 8. Change log

<!-- Spec changes after AGREED get a dated line here. If the code and this
     spec disagree and the spec is the one that is wrong, the fix lands
     here in the same session, per "Docs move with the code." -->

| Date | Change | Why |
|------|--------|-----|
| 2026-08-08 | DRAFT → AGREED; all five open TODOs resolved per runner recommendations (anticipation beat IN, enclosed-segment spawns fade in place, `cascadeFallSpeed` becomes a velocity profile, tuning constants are runner-proposed and trace-verified, on-device check assigned to Kevin) | Kevin approved all recommendations in conversation |
