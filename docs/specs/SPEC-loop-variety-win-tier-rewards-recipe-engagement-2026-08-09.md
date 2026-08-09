# SPEC.md — Lala's Kitchen: Loop Variety, Win-Tier Rewards & Recipe Engagement

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
**Date agreed:** 2026-08-09 (Kevin: "do the free hint or shuffle. Not going to break anything. Star thresholds sound good" — resolves the daily-bonus-shape fork in favor of the resource-grant alternative and confirms the proposed star-threshold ratios as-is)
**Owner:** Kevin

---

## 1. Problem

**Problem:** Real playtest feedback, after the commercial-polish consolidation pass shipped
(see the archived `SPEC-commercial-polish-consolidation-and-celebration-2026-08-08.md`):
"just feels like we are still missing something major," refined into three distinct threads
through direct follow-up:

1. **The core loop reads as recycled.** Generated-level objective type is a pure function of
   level number — `(levelNumber - MIN) % CADENCE === 0`, checked in a fixed priority order
   (score, then clearance, then escort, else collect). Score levels land every 5th eligible
   level, clearance every 6th, escort every 8th, board shape every 2nd. None of this is
   randomized; the exact same sequence repeats every time (full period 120 levels, but the
   rhythm is felt long before that). A player who's put in real hours can predict what a level
   will ask for from its number alone.
2. **Ordinary wins feel flat.** The win-celebration burst built last session is gated to a
   3-star finish or a fresh recipe unlock — a binary "burst or nothing." The 3-star bar
   (`THREE_STAR_UNUSED_RATIO`, half the move budget left unused) was calibrated against a
   greedy bot evaluating every legal move, not against how an actual casual player performs —
   so most real wins likely land at 1-2 stars and get no escalation at all, which is close to
   what a real report just confirmed (a 1-star win, no burst, felt like nothing happened).
3. **There's no return hook.** The original commercial-polish scope named two tracks —
   feel/juice (built) and monetization-adjacent UX, engagement without purchases (explicitly
   deferred to "its own conversation," never picked back up). Today the only thing resembling
   engagement is a plain text line on Home ("a new recipe waits N levels ahead").

**Lane:** Joy — felt game-quality work for the one real player, not a market-facing feature.
Every constraint from prior sessions still applies: sound/haptics off by default, nothing
purchasable, no timers or urgency framing, and — per standing instruction — no notifications,
ever, opt-in or not.

## 2. Scope

**In scope (this build), one item per thread, each confirmed directly with the architect:**

- **Thread 1 — seeded shuffle-bag.** Replace the modulo-cadence gates for generated-level
  objective type (score/clearance/escort) with a deterministic, seeded shuffle-bag: exactly
  the same long-run frequency as today (still 1-in-5, 1-in-6, 1-in-8 of eligible levels), but
  which specific level within each window lands the mechanic is no longer predictable by mental
  arithmetic. Board-shape rotation and blocker selection are explicitly NOT touched this pass —
  see Explicitly out of scope.
- **Thread 2 — three-tier win celebration + loosened star thresholds.** `WinCelebrationBurst`
  gains a light/full intensity split: 1-star keeps today's quiet star-pop + sparkle only,
  2-star gets a smaller/shorter version of the burst, 3-star or a recipe unlock keeps the full
  treatment unchanged. Separately, `THREE_STAR_UNUSED_RATIO`/`TWO_STAR_UNUSED_RATIO` move down
  (proposed 1/2 → 1/3 and 1/3 → 1/6 respectively — see Decision block for the reasoning and the
  explicit disclosure that these numbers are a starting hypothesis, not a calibration).
- **Thread 3 — recipe-progress visibility + gentle daily first-win moment.** Home's plain
  "a new recipe waits N levels ahead" text becomes a real visual progress indicator (a fill
  bar/ring toward the next recipe card, reusing that card's own sprite as the target icon). A
  new daily touch: the first level won each calendar day grants one free Hint-or-Shuffle use
  (a single shared bonus token, spendable on whichever the player taps first) for the *next*
  level entered, announced once via a dedicated `LalaMomentBanner` line when that level starts.
  No streak tracking, nothing lost by skipping a day — see Decision block for the mechanism and
  why the initially-proposed flavor-only alternative was superseded.

**Explicitly out of scope:**
- Board-shape template rotation and blocker-type selection staying on their current fixed
  cadences — Thread 1 targets objective type specifically, the most directly *felt* recycling
  (it changes what you're asked to do every level); shape/blocker predictability is a real,
  smaller-feeling follow-up candidate, not silently dropped, logged to `DEFERRED_COMPLEXITY.md`
  once this ships.
- Any change to how score/clearance/escort targets or move budgets are calculated — this build
  touches *which level gets which mechanic*, never the mechanic's own difficulty tuning.
- Any streak, daily-login-with-loss, timer, or purchasable engagement mechanic — ruled out by
  standing constraints, not reconsidered here.
- Push notifications of any kind, opt-in or not — standing instruction, not up for debate in
  this build.
- Recalibrating the star thresholds against real telemetry — no analytics pipeline exists for
  this single-player project; the proposed new ratios are a reasoned hypothesis pending a real
  human playing against them, exactly like every other hand-picked constant this project
  discloses rather than pretends is measured.

## 3. Architecture decisions

### Decision: Objective-type selection becomes a seeded shuffle-bag, not true randomness
- **Choice:** For each mechanic (score/clearance/escort), levels past that mechanic's own
  `MIN_LEVEL_NUMBER` are grouped into consecutive windows of size `CADENCE` (unchanged: 5/6/8).
  Today, position 0 of every window is always the hit. Instead, each window's hit position is a
  deterministic pseudo-random index in `[0, CADENCE)`, seeded from `(bagIndex, a per-mechanic
  salt constant)` via the same `mulberry32` PRNG this codebase already duplicates between
  `generator.ts` and `gameState.ts` (a third, `appPersistence.ts`-local copy, following that
  existing precedent rather than exporting one — see the sibling Decision below). Same level
  number always produces the same result on replay (the generator's core "same seed always
  produces the same level" guarantee, preserved); the same *frequency* survives exactly (still
  1-in-5, 1-in-6, 1-in-8), only the position within each window varies.
- **Why:** This keeps every existing difficulty-tuning decision (the cadence numbers themselves,
  chosen specifically so score stays common and escort stays rare) completely untouched, and
  keeps the generator's determinism contract intact — a real requirement this codebase has never
  broken, confirmed across every generator-touching decision so far. It only removes the ability
  to predict a level's mechanic from arithmetic on its number, which is the literal thing
  "recycled objectives on a predictable loop" describes.
- **Rejected alternative and why:** True runtime randomness (`Math.random()` at generation time)
  — rejected outright, since it would mean the SAME level number shows a DIFFERENT objective
  type on a retry, breaking the reasonable expectation that "level 47" is always the same
  challenge, and breaking this project's own standing "deterministic generator" contract
  (`engine/generator.ts`'s whole reason for a seeded PRNG in the first place).

### Decision: A third local `mulberry32`, not a shared export
- **Choice:** `appPersistence.ts` gets its own local copy of `mulberry32`, matching how
  `gameState.ts` already has its own copy rather than importing `generator.ts`'s.
- **Why:** `generator.ts` doesn't export it today (confirmed by direct reading, cited in
  `engine/DECISIONS.md` as the reason `gameState.ts` duplicated it rather than importing). A
  third small, private, well-understood pure function is cheaper and lower-risk than restructuring
  either existing module's exports for a one-line shared utility.
- **Rejected alternative and why:** Export it from `generator.ts` and import in both other
  files — genuinely the more conventional fix, but touches a module boundary two other files
  already deliberately worked around, for a function short enough that duplication carries
  negligible real cost.

### Decision: Three celebration tiers, not a continuous scale
- **Choice:** `wonActions.ts`'s `isStrongWin` (boolean) is replaced outright by
  `resolveCelebrationTier(stars, unlockedRecipeCard): 'quiet' | 'light' | 'full'` — 1-star is
  `'quiet'` (unchanged treatment), 2-star is `'light'`, 3-star or a recipe unlock is `'full'`
  (unchanged treatment). `WinCelebrationBurst`/`celebrationParticles.ts` gain an `intensity`
  parameter scaling particle count, flight distance, and duration down for `'light'` — same
  mechanism, smaller numbers, not a second component.
- **Why:** Matches the exact floor/ceiling reward-hierarchy shape this whole project has used
  since the visual-reward-language spec (`passRewardIntensity`, `scaledByReward`) — more tiers
  where the underlying signal already has more tiers (stars already have three values), rather
  than inventing a fourth. A clean replacement, not a boolean kept alongside a new tier function —
  `isStrongWin` has exactly one call site (`WonOverlay.tsx`), so there's no reason to keep both.
- **Rejected alternative and why:** A continuously scaling burst (particle count as a smooth
  function of some score-like value) — more "authentic" in principle, but this project's own
  reward signals are already discrete (star count, tier), and a continuous scale would need a
  new continuous input invented for the sole purpose of feeding it.

### Decision: Loosen both star thresholds, proposed as a hypothesis, not a final calibration
- **Choice:** `THREE_STAR_UNUSED_RATIO` moves from 1/2 to 1/3 (exactly where the 2-star bar sits
  today); `TWO_STAR_UNUSED_RATIO` moves from 1/3 to 1/6.
- **Why:** The current 1/2 bar was itself the result of a bot-simulation finding the *original*
  2/3 bar unreachable — but the bot it was measured against evaluates every legal move each
  turn, which is not how a real casual player plays. With no telemetry to calibrate against (this
  is a single-player project with no analytics pipeline), the honest move is a reasoned guess,
  explicitly disclosed as such, rather than another simulation run that would just encode the
  same "optimal bot" bias one level down. Halving both bars preserves the *relative* spacing
  between tiers while making the top tier reachable by a meaningfully efficient — not
  near-perfect — real player.
- **Rejected alternative and why:** Re-running the greedy-bot simulation with a *less*-than-optimal
  bot to approximate casual play — plausible, but inventing a synthetic "casual bot" model is its
  own unvalidated assumption, arguably a worse foundation than a disclosed guess pending real
  play. Revisit numerically once real sessions land against these.

### Decision: The daily first-win moment grants one free hint-or-shuffle use, not flavor only
- **Choice:** The first level won each calendar day (device-local date, same accepted
  clock-trust tradeoff `SaveData.livesLastRegenAt` already discloses) grants a single shared
  bonus token — spendable on either the Hint or the Shuffle button, whichever the player taps
  first — usable on the *next* level entered, past that attempt's normal 2-use cap. Tracked by
  two new `SaveData` fields: `lastDailyBonusClaimedDate?: string` (prevents earning it twice in
  one day) and `pendingDailyBonusGrant?: boolean` (true from the moment it's earned until the
  next level mounts and picks it up). Announced once, when the next level starts, via a
  dedicated `LalaMomentBanner` line — the bonus is silent otherwise, which would read as a
  hidden mechanic nobody notices rather than a reward.
- **Why:** Confirmed directly by the architect over the flavor-only alternative — "do the free
  hint or shuffle, not going to break anything." A genuinely felt reward (an extra use of a
  resource the player already values, per the existing Hint/Shuffle cap precedent) rather than
  a text-only acknowledgment, and the architect's own risk read of the cap-machinery concern
  raised in review was that it's a manageable, well-scoped addition, not a real hazard.
- **Rejected alternative and why:** Flavor-only, no mechanical grant — this session's own
  original proposal, chosen initially for lower risk to `Board.tsx`'s per-attempt cap machinery.
  Superseded by direct architect confirmation preferring the richer reward; the risk concern is
  addressed in implementation by scoping the bonus as one shared token (not independent +1s to
  both caps) consumed atomically on first use, and by clearing the persisted grant the moment a
  level mounts with it available — so there's exactly one place the grant can be lost track of,
  not several.

### Decision: Recipe-progress becomes a windowed fill indicator, not a lifetime one
- **Choice:** The Home progress indicator fills based on `(currentLevel - previousMilestoneLevel)
  / (nextMilestoneLevel - previousMilestoneLevel)` — progress *within the current gap* between
  recipe cards — rather than total cards unlocked over the full 52-card set.
- **Why:** A lifetime-progress bar would sit at ~90%+ full almost permanently once a player is
  deep into the 52-card curve (the milestone spacing widens considerably in the back half — see
  `CLAUDE.md`'s recipe-box milestone sequence), making the indicator feel static exactly when a
  return-hook is supposed to feel alive. A windowed bar resets to a fresh, visibly-moving 0% at
  every unlock, which is the property that makes it worth glancing at again next session.
- **Rejected alternative and why:** A lifetime "X/52 cards" counter — genuinely simpler (already
  exists as a plain count on the collection screen), but that's exactly why it doesn't need to
  be duplicated here; the collection screen already owns the honest, un-gamified total.

## 4. Data model

No database — client-only game.

| Table | Owned by | Access rule | Enforcement |
|-------|----------|-------------|-------------|
| `SaveData.lastDailyBonusClaimedDate?: string` (new) | Engine (persisted save) | Written by the App.tsx win-transition handler that already computes `unlockedRecipeCard`/`completedLevels` for that same transition | `engine/gameState.ts`'s `isValidSaveData` gains a matching optional-field check, same shape as every other optional `SaveData` field (`consecutiveLosses`, `lastCrash`, etc.) |
| `SaveData.pendingDailyBonusGrant?: boolean` (new) | Engine (persisted save) | Set `true` alongside `lastDailyBonusClaimedDate` on a qualifying win; cleared to `false` the moment a level next mounts with it available (Board.tsx's own `onDailyBonusConsumed` callback into App.tsx) | Same `isValidSaveData` optional-field convention |
| `appPersistence.ts`'s shuffle-bag position function (new, pure) | Presentation/generator-adjacent layer | No state — deterministic function of `(bagIndex, cadence, salt)` | Unit tests asserting exactly one hit per window, determinism, and unchanged long-run frequency |
| `wonActions.ts`'s `resolveCelebrationTier` (replaces `isStrongWin`) | Presentation layer | No state — pure function of `(stars, unlockedRecipeCard)` | Unit tests covering all 6 input combinations |
| `ApplyMoveResult` / core engine matching, cascading, scoring | Engine | **Unchanged** | Existing `gameState.ts`/`matrix.ts` tests |

## 5. Security posture

**Above the floor:** Nothing new. No network surface, no new dependency, `lastDailyBonusClaimedDate`
is the only new persisted field and carries no sensitive data (a plain date string, same
spoofable-via-device-clock tradeoff already accepted and disclosed for `livesLastRegenAt`).

**Floor deferrals (should be empty):** None.

**Adversarial pass scheduled:** No — no attack surface changes. The only "abuse" surface (winding
the device clock to claim the daily line repeatedly) grants nothing worth abusing — it's a text
line, not a resource.

## 6. Verification plan

| Behavior | Command / probe | Signal that proves it |
|----------|----------------|-----------------------|
| Objective-type shuffle-bag preserves exact long-run frequency | Unit test sweeping a large level range (e.g. 3–1000) counting hits per mechanic | Score hits `total_eligible / 5` (±1 for remainder), clearance `/6`, escort `/8` — same ratios as today's modulo gates |
| Shuffle-bag is deterministic per level number | Unit test calling `isScoreObjectiveLevel(N)` (etc.) twice for the same N | Identical result both calls |
| Shuffle-bag is no longer predictable by simple modulo | Unit test confirming at least one window's hit position is NOT at position 0 | A window where the hit isn't the first eligible level in it |
| Win celebration tier resolves correctly for all 6 star/recipe combinations | `wonActions.test.ts` | 1-star→quiet (both recipe states), 2-star→light (both states), 3-star→full (both states) |
| Light burst is visibly smaller than full, not just relabeled | `celebrationParticles.test.ts` comparing `buildCelebrationParticles` output at both intensities | Fewer particles and/or shorter distances at `'light'` than `'full'` |
| New star thresholds compute correctly at the boundary values | `wonActions.test.ts`, extending the existing `computeStarRating` suite | 1/3 and 1/6 boundaries hit exactly, same structure as the existing boundary tests |
| Daily bonus is earned once per calendar day, never twice | Unit test around the new pure win-transition helper with two wins on the same simulated date vs. two on different dates | Second same-day win does not re-set `pendingDailyBonusGrant`; a win on a new date does |
| The bonus token is shared, not double-granted to both caps | Unit test / code review of `Board.tsx`'s hint and shuffle handlers | Spending the token on Hint leaves Shuffle at its normal cap and vice versa — exactly one extra use total, not one extra on each |
| The bonus is consumed once offered, not re-offered on a later level | Unit test / code review of the mount-time `onDailyBonusConsumed` call | `pendingDailyBonusGrant` clears the moment a level mounts with it available, regardless of whether the token is actually spent that attempt |
| `SaveData` round-trips both new fields correctly, old saves still load | `gameState.test.ts`'s existing `loadSave` malformed/missing-field suite, extended | A save missing either field loads with it `undefined`, not a crash |
| Recipe progress bar reflects the correct windowed fraction | Unit test against `levelProgress.ts`'s extended hint-building function at several current-level values within a known gap | Fraction matches `(current - prev) / (next - prev)` exactly |
| It actually reads as varied/rewarding/engaging in real play | Real play by Kevin, ideally after an OTA reaches the device | The row that decides whether this build succeeded — a felt judgment, not a metric, same standing disclosure every prior spec this session has carried |

## 7. Career evidence

- [ ] A short writeup on the shuffle-bag technique itself — deterministic-but-unpredictable
      sequencing is a genuinely transferable pattern (matchmaking, content rotation, A/B
      assignment) beyond this one game
- [ ] Before/after comparison of the recipe-progress indicator (text line vs. visual fill)
- [ ] A decision-block post on the star-threshold change: calibrating against a real user's
      report vs. a bot simulation, and being honest about which one is actually load-bearing

## 8. Change log

| Date | Change | Why |
|------|--------|-----|
| 2026-08-09 | Drafted, status DRAFT. Prior `SPEC.md` (commercial-polish consolidation & win celebration) archived to `docs/specs/SPEC-commercial-polish-consolidation-and-celebration-2026-08-08.md`, fully AGREED and implemented — a separate, completed initiative. Three threads (loop predictability, ordinary-win reward flatness, no return hook) each confirmed with the architect via direct multiple-choice before drafting, per this project's architect/runner boundary. | New, distinct initiative; directional decisions already made in conversation, mechanism-level decisions (thresholds, data model, rejected alternatives) proposed here for the architect's review before AGREED |
| 2026-08-09 | DRAFT → AGREED. Daily-bonus-shape fork resolved in favor of the resource-grant alternative (a real free Hint-or-Shuffle use, not flavor-only) — see the updated Decision block. Star thresholds (1/3, 1/6) confirmed as proposed, no changes. The board-shape/blocker-rotation scope cut was not separately objected to, so it stands as drafted. | Architect review response: "do the free hint or shuffle. Not going to break anything. Star thresholds sound good" |
| 2026-08-09 | Implemented and tested, all three threads: the seeded shuffle-bag (`appPersistence.ts`'s `isScoreObjectiveLevel`/`isClearanceObjectiveLevel`/`isEscortObjectiveLevel`, a third local `mulberry32`), `resolveCelebrationTier` replacing `isStrongWin` with a light/full intensity split plus the loosened star thresholds, the daily-bonus shared Hint-or-Shuffle token (`SaveData.pendingDailyBonusGrant`/`lastDailyBonusClaimedDate`, `Board.tsx`'s `hasDailyBonusToken`), and the windowed recipe-progress fill bar (`findPreviousUnlockedMilestoneLevel`, `buildRecipeProgressFraction`, `Home.tsx`). 850/850 tests (up from 825). A genuine debugging detour during live verification — a `ReferenceError` that survived a full dev-server restart and a forced reload — was root-caused to a stale browser-tab sub-bundle cache (confirmed via a direct bundle `fetch()` showing already-correct compiled code, then a fresh tab showing zero errors), not a real code defect; see `engine/DECISIONS.md`'s matching entry for the full trace. Not yet felt-verified: the recipe-progress bar's actual visual appearance, and the daily-bonus/shuffle-bag behavior end-to-end against a real save — both disclosed in `DEFERRED_COMPLEXITY.md`. | Implementation session; the open rows are human judgment calls (does the loop feel varied, do ordinary wins feel better, is the daily bonus noticed) this environment can't substitute for |
