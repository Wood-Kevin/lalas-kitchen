# SPEC.md — Lala's Kitchen: Commercial-Polish Consolidation & Win Celebration

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
**Date agreed:** 2026-08-08 (approved via Claude Code plan mode — the plan at
`C:\Users\kevin\.claude\plans\rosy-hugging-lamport.md` is the record of that
approval; this file restates it in SPEC.md's standard shape per "the plan
lives in the repo")
**Owner:** Kevin

---

## 1. Problem

**Problem:** The project pivoted from "built calm for one specific player"
to a genre-standard commercial-polish pass this session — Kevin: "calm was
probably the wrong word to run a base from... the big annoyance for her was
the sounds and constant microtransactions... even if calm was the baseline,
bland still doesn't fit." Two constraints stayed permanent (sound/haptics
off by default, nothing purchasable); everything else — visual richness,
celebratory feedback, genre-standard feel — became open ground.

Mid-session, another tool ("codex") was found running against this repo on
a since-deleted branch, working the same brief. Kevin stopped it and asked
this session to take over and consolidate whatever it had produced — stashed
before deletion, nothing lost (`git stash@{0}`, "codex commercial polish
before branch deletion"). A full read-only review of that stash (six files:
`Hud.tsx`, `Board.tsx`, and four new components) found most of it sound but
two real problems: `Hud.tsx`'s padding grew past even the values this same
session's earlier HUD-character build (see the archived
`SPEC-hud-reward-texture-and-character-2026-08-08.md`) had already measured
and tightened for tap accuracy, and `KitchenSceneDecor.tsx` mounted
unconditionally across the entire screen instead of scoped to the board.

A first draft of the consolidation plan carried forward a stale "avoid
fireworks/full-screen celebration effects" restriction, quoted directly from
two pre-existing docs (`docs/commercial-polish-with-charm-plan.md`,
`docs/release-character-pack.md`). Kevin corrected this directly: "We can
add firework type effects and such. Not sure where you are getting to not
add something like that." Those two docs predated this session's own
"calm was the wrong word" conversation and were never re-checked against
it — real celebration effects, including particle/firework-style bursts,
are in scope, bounded to genuine peaks (not every ordinary match).

**Lane:** Joy — felt game-quality and consolidation work for the one real
player, not a market-facing feature.

## 2. Scope

**In scope (this build):**
- Apply the codex stash to a clean working tree; review and land what's
  sound, fix what isn't, extend what's genuinely incomplete.
- Re-verify `Hud.tsx`'s sizing against the same live-measurement method the
  prior HUD-character spec established, retuning if codex's padding growth
  reopened a `tileSize` regression.
- Fix `KitchenSceneDecor.tsx`'s scope: bound to the board's own measured
  area, gated the same way the board grid itself is gated.
- Verify `ScorePopup`'s fixed position doesn't collide with the HUD.
- Extract `Board.tsx`'s inline score-popup-tone / Lala-copy branching into
  pure, named, tested functions, matching this codebase's established
  pattern (`cascadeTiming.ts`, `wonActions.ts`).
- Land `WonOverlay.tsx`'s sequential `AnimatedStar` reveal.
- Build a real win-celebration particle burst for a strong win (3-star, or
  a win that also unlocked a recipe card), reusing this game's own accent
  colors, bounded to the win overlay's own card area — not full-screen.
- Decide and, where cheap, close `LalaMomentBanner`'s copy-bank coverage
  gap (originally 4 of 12 triggers from `release-character-pack.md`).
- Correct the two stale "avoid fireworks" doc lines, plus any component
  comment that inherited the same now-superseded reasoning.

**Explicitly out of scope:**
- Phase 4 content work (recipe chapters, authored level names, milestone
  vignette art) — fully spec'd elsewhere, untouched by the codex stash, a
  separate later slice.
- The full board-surface backdrop *texture*
  (`release-character-pack.md` Section 5) — `KitchenSceneDecor` is a
  narrower corner-accent stand-in, not this; no asset exists yet.
- Any monetization-adjacent engagement mechanic beyond what already exists
  (the recipe-progress hint). Streaks/timers/urgency remain out — that
  restriction wasn't challenged this session, only the celebration-effects
  one was.
- Any change to score calculation, engine matching/clearing logic, or
  persisted save shape — this build is presentation-layer only.

## 3. Architecture decisions

### Decision: Re-verify, don't trust, codex's HUD sizing changes
- **Choice:** Live `getBoundingClientRect()` measurement over CDP against
  the real running app, same method and same worst-case viewport
  (375×667 SE, level 1, 8×5) the prior HUD-character spec used, before
  landing any of codex's `Hud.tsx` changes as-is.
- **Why:** Codex's stash grew `chip.minHeight` 42→58 and tray padding
  6/4→10/8 — past even the *pre-tightening* values this session's own
  earlier work had already measured and shrunk for tap accuracy. Landing
  it unverified would silently re-open a regression this project had
  already paid down once.
- **Rejected alternative and why:** Accept codex's padding on aesthetic
  grounds alone — the exact thing the prior HUD spec's own verification
  step was built to prevent.

### Decision: `KitchenSceneDecor` is rescoped, not deleted
- **Choice:** Keep the component, move its mount point from a top-level
  sibling spanning the whole screen into a new child of `Board.tsx`'s
  `boardArea`, gated on the same `tileSize > 0` condition the board grid
  itself uses.
- **Why:** The component's own internals (`pointerEvents="none"`
  throughout, fixed corner offsets meant to "peek" from behind the board)
  were always correct — only its caller's placement was wrong. Its fixed
  offsets only make sense relative to the board's own bounds, not the full
  screen (which includes the HUD and every overlay).
- **Rejected alternative and why:** Rewrite it to measure its own
  position dynamically — unnecessary complexity; the existing fixed
  offsets are fine once the parent container is the right size.

### Decision: `resolveScorePopupTone`/`resolveLalaMomentCopy` are pure, tested functions
- **Choice:** Pull `Board.tsx`'s inline nested-ternary tone/copy branching
  into `components/rewardMoment.ts`, two named pure functions, with unit
  tests covering every priority ordering.
- **Why:** Matches this codebase's own established pattern for
  presentation-derived decisions (`cascadeTiming.ts`'s
  `passRewardIntensity`, `wonActions.ts`'s `computeStarRating`) — a
  branching decision embedded in a component function is untestable
  without a render harness this project has never built; extracted, it's
  a plain function a unit test can drive directly.
- **Rejected alternative and why:** Leave it inline, verify only by
  reading — worked for codex's original 4-branch version, but grew
  fragile once this build added 4 more signals (`effectDescriptor`,
  first-move, moves-remaining) to the same decision.

### Decision: Real celebration effects are in scope, bounded to genuine peaks
- **Choice:** Build `WinCelebrationBurst.tsx` — a real multi-particle
  radial burst, reusing this game's own accent-color language — gated by
  `wonActions.ts`'s new `isStrongWin` (3-star finish, or a win that
  unlocked a recipe card). An ordinary win keeps the existing subtler
  star-pop + sparkle treatment.
- **Why:** Directly confirmed by Kevin, correcting the two stale doc
  lines this plan's first draft had carried forward unchecked. Gating by
  win quality reuses the same floor/ceiling reward-hierarchy shape
  `passRewardIntensity`/`scaledByReward` already established for board
  effects this same day — "more juice where it's earned," not uniformly
  louder everywhere.
- **Rejected alternative and why:** A burst on every win, or no burst at
  all — the former ignores the reward-hierarchy precedent this project
  already committed to; the latter is exactly the over-cautious reading
  that needed correcting.

### Decision: The burst also applies to a recipe-card win, reversing that component's own prior note
- **Choice:** `WonOverlay.tsx` layers `WinCelebrationBurst` over
  whichever of `RecipeCardReveal` or the plain illustration is showing —
  including recipe-card wins, even though `RecipeCardReveal.tsx`'s own
  comment had separately documented "no confetti... the only celebration
  cue" as its own approved design brief.
- **Why:** This plan's own approved Step 7 explicitly named "a win that
  also unlocked a recipe card" as a strong-win case. `RecipeCardReveal`'s
  own restraint was reasoned from the same general "calm" framing Kevin's
  correction reopened — not a separate, still-standing constraint — so
  applying the same reversal here is consistent, not a silent override.
  `RecipeCardReveal.tsx`'s own comment is corrected in the same session,
  per "docs move with the code."
- **Rejected alternative and why:** Leave `RecipeCardReveal` bursts-free
  as a deliberately quieter treatment — a real, defensible option, but
  one that would need a fresh, explicit confirmation rather than reading
  it into the existing approval, since the plan's own text already named
  this case.

## 4. Data model

No database — client-only game. No engine or persisted-save changes in
this build (this section restates that from the archived HUD spec since
it still holds).

| Table | Owned by | Access rule | Enforcement |
|-------|----------|-------------|-------------|
| `Board.tsx`'s `scorePopup`/`lalaMoment` state (presentation-layer, per-move) | Presentation layer | Per-move only, keyed and replaced every commit | Cleared by each component's own `onDone` callback |
| `components/rewardMoment.ts` (new, pure functions) | Presentation layer | No state — pure functions of already-existing move data | Unit tests (`rewardMoment.test.ts`) |
| `components/celebrationParticles.ts` (new, pure layout) | Presentation layer | No state — deterministic function of count/colors | Unit tests (`celebrationParticles.test.ts`) |
| `ApplyMoveResult` / `SaveData` | Engine | **Unchanged** | Existing `gameState.ts` tests |

## 5. Security posture

**Above the floor:** Nothing new. No network surface, no new dependency
(Reanimated primitives already in use throughout), no persistence change.

**Floor deferrals (should be empty):** None.

**Adversarial pass scheduled:** No — no attack surface changes.

## 6. Verification plan

| Behavior | Command / probe | Signal that proves it |
|----------|----------------|-----------------------|
| Codex stash applied cleanly, six files present | `git status` after `git stash apply` | **Done**: matched the reviewed file list exactly |
| HUD sizing re-tightened, no regression vs. the prior spec's accepted numbers | Live `getBoundingClientRect()` over CDP, level 1, 375×667 | **Done**: `hudHeight=118, boardAreaHeight=504, byWidth=65, byHeight=63, tileSize=63` — matches the prior spec's own accepted value exactly |
| `KitchenSceneDecor` scoped to the board, not the full screen | Code review of its new mount point in `Board.tsx`; `npx tsc` compiles; app renders without crashing over CDP | **Done**: moved inside `boardArea`, gated on `tileSize > 0`; full jest suite (which type-compiles every file) green throughout |
| `ScorePopup`'s fixed position doesn't collide with the HUD | Render-tree analysis: `ScorePopup` is a child of `board` (inside `boardArea`), `Hud` and `boardArea` are non-overlapping flex siblings in `styles.container` | **Done** — structurally cannot collide regardless of HUD height, confirmed by reading the actual JSX nesting, not assumed |
| Tone/copy branching is pure, named, and tested | `components/rewardMoment.ts` + `rewardMoment.test.ts` | **Done**: 16 tests covering every priority ordering across both functions |
| `WonOverlay`'s star reveal matches established Reanimated conventions | Code review against `Sparkle`'s own `withDelay`/`withSequence`/`withTiming` pattern in the same file | **Done** — identical primitives; no Reanimated component in this codebase (`Sparkle`, `SteamWisp`, `ComboStreakBanner`, `PausedOverlay`) has a dedicated test file, so this matches established precedent rather than needing new coverage |
| Win-celebration burst fires only for a strong win | `wonActions.test.ts`'s `isStrongWin` tests; `WonOverlay.tsx`'s `strongWin` gate | **Done**: 5 tests (3-star with/without recipe, recipe-only at 1/2 stars, ordinary win excluded) |
| Burst particle layout is deterministic and testable | `celebrationParticles.test.ts` | **Done**: 7 tests (count, empty-input guards, color cycling, golden-angle spread, stagger window, determinism, unique ids) |
| Stale "avoid fireworks" docs corrected | `docs/commercial-polish-with-charm-plan.md`, `docs/release-character-pack.md`, `docs/playability-review-2026-08-08.md` (historical, annotated not rewritten), `RecipeCardReveal.tsx`'s own comment | **Done** — all four corrected in this session |
| `LalaMomentBanner` copy-bank coverage | `resolveLalaMomentCopy`'s test coverage; `DEFERRED_COMPLEXITY.md`'s `lala-moment-banner-coverage` entry | **Done**: 8 of 12 triggers wired (up from 4), remaining 4 disclosed as a considered decision with reasoning, not an oversight |
| Test suite green throughout | `npx jest` | **Done**: 816/816 passing (up from 790 at session start: +10 `rewardMoment`, +7 `celebrationParticles`, +3 `wonActions`, +6 more `rewardMoment` for the expanded Lala coverage) |
| `npx tsc` typecheck | `npx tsc --noEmit` | **Not usable this session** — fails on a pre-existing, unrelated environment issue (`expo/tsconfig.base.json`'s `customConditions` requires `moduleResolution: bundler`/`node16`/`nodenext`, but this project's own `tsconfig.json` overrides it to `node10`); confirmed via `git status`/`git log` that `tsconfig.json`, `package.json`, and `node_modules/expo/package.json` are all untouched by this session or the codex stash. Jest (which type-compiles every file via ts-jest) substitutes as the real compile-correctness check |
| It actually feels like a genre-standard win moment, not "too much" | Real play by Kevin, ideally after an OTA reaches his device | The row that decides whether this build succeeded — a felt judgment the browser-pane environment's board-render limitation can't substitute for, the same standing gap every animation feature this session discloses |

## 7. Career evidence

- [ ] A short writeup on consolidating a second AI tool's uncommitted,
      stashed work mid-session: what review caught (a tap-accuracy
      regression, a scope bug) vs. what was sound as-is
- [ ] Before/after capture of a strong win (star reveal + celebration
      burst) once a real device/desktop session can render it
- [ ] A short note on the "corrected a stale doc constraint, twice" thread
      this session (calm-not-frantic over-reading → fireworks
      over-reading) as a transferable lesson on re-checking old docs
      against a changed brief rather than trusting them by inertia

## 8. Change log

| Date | Change | Why |
|------|--------|-----|
| 2026-08-08 | Drafted, status AGREED directly (plan-mode approval already secured — see the plan file referenced above). Prior `SPEC.md` (HUD reward texture & character) archived to `docs/specs/SPEC-hud-reward-texture-and-character-2026-08-08.md`, fully AGREED and implemented — a separate, completed initiative. | New, distinct initiative per the spec skill's "do not overwrite an existing spec" rule; plan-mode approval already constitutes the explicit go-ahead this file restates |
| 2026-08-08 | Implemented and tested: codex stash applied and consolidated (HUD re-tightened, `KitchenSceneDecor` rescoped, `ScorePopup` position verified safe by construction); `rewardMoment.ts` extraction; `WonOverlay`'s `AnimatedStar` landed as-is; `WinCelebrationBurst.tsx` + `celebrationParticles.ts` built and wired for strong wins (including recipe-card wins, reversing `RecipeCardReveal`'s own prior no-burst note); `LalaMomentBanner` coverage expanded 4→8 of 12 triggers; stale "avoid fireworks" lines corrected in three docs plus one component comment. 816/816 tests. `npx tsc` unusable this session (pre-existing, unrelated environment issue, disclosed above) — jest's ts-jest compile substitutes. Not yet felt-verified on a real device. | Implementation session; the open row is a human "does this feel right, not too much" judgment |
