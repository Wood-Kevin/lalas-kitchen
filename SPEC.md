# SPEC.md — Lala's Kitchen: Visual Reward Language Redesign

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
**Date agreed:** 2026-08-08 (Kevin, explicit delegation: "I'll let you decide so I can be surprised")
**Owner:** Kevin

---

## 1. Problem

<!-- One paragraph: what problem, for whom, and which lane this build
     serves (joy, career evidence, or both). Joy builds don't need market
     permission — no validation gate here. But be honest about the lane:
     a career-evidence build with no audience in mind is neither. -->

**Problem:** A same-day fun-factor review (2026-08-08, architect playing
on desktop) surfaced two concrete, traceable causes behind a vague "not
sure the fun factor is there" concern — reported directly as "a whatever
moment" and "mechanics don't really vary." First: every clearing effect
in the game — an ordinary match, a blocker clear, a striped sweep, a
color bomb detonation, an area bomb blast, a supercombo — renders using
the exact same single shared color (`skinConfig.palette.accent`),
differentiated only by shape and duration, both weak signals on a small
moving tile. Real mechanical depth exists (specials, combos, chains,
four objective types) but almost none of it is *visually* distinct in
the moment it fires. Second: the engine already computes a per-move
score with cascade tiers (`SCORE_TIER_POINTS`: ordinary/special/bomb =
10/25/50 per cell, plus a `+25%`-per-pass chain multiplier) — but that
signal is only ever displayed on `'score'`-type objective levels, a
minority. On every other level, a genuinely impressive multi-pass chain
and a flat one-off match currently look identical.

Both were previously assumed out of bounds under the "calm, not
frantic" constraint. That reading was corrected the same day (see
`CLAUDE.md`'s calm-scope clarification, commit `384e3fe`): the
architect's own words were **"calm was more in relation to the sounds
and micro transaction pressures"** — not visual richness or reward
intensity. Pacing/timing is a separate, still-valid calm axis (the
subject of `docs/specs/SPEC-game-feel-overhaul-2026-08-08.md`, shipped
and verified the same day) and this spec does not touch it.

**Lane:** Joy first — this directly targets "does playing this feel
good," the actual open question. Secondarily, a fair career-evidence
story: root-causing a vague "not fun" feeling to two specific, fixable
defects (one shared color, one discarded feedback signal) instead of
reaching for generic genre-convention fixes.

## 2. Scope

**In scope (this build):**
- Give each clearing mechanism its own distinct, calm color — ordinary
  match, blocker clear, striped sweep, color bomb / radial detonation,
  area bomb blast, supercombo conversion + synchronized sweep. Same
  intensity ceiling as today (soft washes, no particles, no flashing) —
  differentiated by **hue**, not by loudness. The color set lives in
  `skinConfig.palette` (new fields), consistent with every other color
  in this codebase already being skin-configurable data.
- Surface a version of the existing score/tier signal on **every**
  level, not just `'score'`-type ones, so a bigger cascade visibly
  reads as bigger regardless of objective type — resolved as a
  visual-only intensity scaling on the existing overlays (see section 3's
  "reward-scaling is visual-only" decision), never a new number.
- Reconsider `MATCH_POP_MS`/`MATCH_POP_SCALE`/`MATCH_POP_OPACITY`
  (added earlier the same day, under the old over-narrow reading of
  "calm") now that intensity is confirmed not to be the constraint —
  candidate for more visual weight, per the TODO decision on reward
  budget below.
- Any wiring changes in `cascadeTiming.ts`, `specialEffectAnimation.ts`,
  `Tile.tsx`, and `Board.tsx`'s pass-animation plumbing needed to carry
  a per-mechanism color and (if chosen) a per-pass score signal through
  to presentation.

**Explicitly out of scope:**
<!-- Anything cut mid-build goes to DEFERRED_COMPLEXITY.md per the baseline,
     but known cuts get listed here up front so the runner never "helpfully"
     builds them. -->
- Sound defaults and haptics defaults — untouched; the reconfirmed
  constraint is that these stay calm-by-default, full stop.
- Any change to purchase/monetization pressure — untouched; nothing
  purchasable remains nothing purchasable.
- Motion timing, easing, pacing, or the pass-scheduling model — that's
  `SPEC-game-feel-overhaul-2026-08-08.md`'s domain, already shipped and
  verified same-day. This spec changes color/intensity of existing
  overlays, never their duration or schedule, unless a decision below
  says otherwise explicitly.
- A full numeric score HUD redesign or new screen. If the score-signal
  TODO resolves toward showing a number, the shape is reusing `Hud.tsx`'s
  existing chip pattern, not new UI chrome.
- New sound effects tied to any new visual moment.
- Any further pacing/physics work (continuous per-column gravity, etc.)
  — already deferred in the prior spec; unrelated axis, still deferred.

## 3. Architecture decisions

<!-- One block per meaningful decision. Same rule as "Justify every change"
     in the baseline, applied at design time: the shape, the why, and the
     alternative not taken. These blocks double as ADRs and as content seeds
     for the Career evidence section. -->

### Decision: "Calm" is scoped to sound + monetization, not visual richness
- **Choice:** Already made, same day, in conversation — recorded in
  `CLAUDE.md` (commit `384e3fe`). This spec exists because of it, not to
  re-litigate it.
- **Why:** The architect's own scoping of the original user research:
  sound-off-by-default and no purchase/urgency pressure were the actual
  protected properties. Visual distinctiveness and reward intensity were
  never tested against real user feedback either way — they were an
  extrapolation that overgrew the stated constraint.
- **Rejected alternative and why:** Leaving the broad reading in place
  and finding some other explanation for "whatever moment" / "mechanics
  don't vary" — rejected because the single-shared-color and
  hidden-score-signal causes are concrete, checked-in-code facts, not
  speculation, and directly explain both reported symptoms.

### Decision: Per-mechanism colors live in `skinConfig.palette`, not a components-level constant
- **Choice:** Extend `SkinPalette` with new effect-color fields rather
  than hardcoding a color table in `cascadeTiming.ts` or `Tile.tsx`.
- **Why:** Every other color in this codebase — `accent`, `panel`,
  `border`, `text`, `mutedText`, `secondaryAccent` — is already
  skin-configurable data. A components-level constant would be the one
  place color diverges from that convention, and would make these
  values invisible to a hypothetical second skin.
- **Rejected alternative and why:** A components-level constant, e.g.
  `EFFECT_COLORS` in `cascadeTiming.ts` — simpler to write, but breaks
  the established "components never hardcode skin aesthetic data"
  pattern and fails the leak test's spirit even though it doesn't
  literally name a piece type.

### Decision: Reward-scaling is visual-only — no new numeric HUD element
- **Choice:** A bigger cascade shows up as a bigger version of the
  existing color-wash overlay (opacity/scale scaled by a new pure
  `passRewardIntensity` derivation), never as a number. The engine's
  real `CascadeResolution.score`/`tierByKey` stay exactly as they are —
  not threaded to the presentation layer, not exposed on
  `ApplyMoveResult` beyond what's already there. The presentation-layer
  signal is a deliberate, disclosed approximation (pass index + cells
  cleared this pass), not a literal mirror of the engine's scoring
  formula, so the two can never silently drift out of sync — there is
  nothing to keep in sync.
- **Why:** Confirmed by reading `engine/gameState.ts` directly (not
  assumed, per the spec's own flagged TODO): `CascadeResolution.score`
  is computed on every move regardless of objective type, but only the
  whole-move TOTAL reaches `ApplyMoveResult` — there is no per-pass
  breakdown exposed today, and growing that public contract for a
  purely cosmetic feature would be a real engine-boundary change for a
  presentation nicety. Deriving an equivalent-shaped signal
  presentation-side is exactly the established pattern this animation
  pipeline already uses everywhere (`sweepDelaysForClears`,
  `radialDelaysForClears`, `buildPassAnimation` are all explicitly
  "presentation-layer derivation, not new engine data," per their own
  doc comments) — this is the same move, not a new kind of shortcut. A
  number also risks conceptual confusion on a `'collect'`-objective
  level with no numeric win condition ("am I being scored on this?"),
  and adds a HUD element to a game whose minimal chrome (Target/Moves/
  Lives only) has been a deliberate property since Home.tsx's own
  "board renders close to edge to edge" constraint.
- **Rejected alternative and why:** Threading the real engine score
  per-pass into `ApplyMoveResult` and showing it as a number — more
  "honest" in the sense of using the real value, but a materially
  bigger and more invasive change (widens a documented, tested public
  contract) for a feature explicitly meant to be a subtle felt signal,
  not a new stat to track. Revisit only if the visual-only version is
  tried and found insufficient.

### Decision: Ordinary matches stay the most subdued mechanism in the reward hierarchy
- **Choice:** Every mechanism gets its own color and its own intensity
  ceiling, ordered `ordinary match < blocker/sweep < color bomb/area
  bomb < supercombo`. Ordinary matches get a real, noticeable boost
  from today's very faint `MATCH_POP_*` values (added earlier the same
  day under the old, over-narrow reading of "calm") — but proportionally
  the smallest boost of the set.
- **Why:** Giving every mechanism the same intensity would fix
  "mechanics don't vary" through color alone but reintroduce it through
  feel — if a plain 3-match pops exactly as hard as a supercombo, colors
  differ but *weight* doesn't, and the game's rarest, most impressive
  moments stop reading as special. Two independent axes (which color,
  how big) read as more legible together than either alone, and a
  legible hierarchy is what a player's eye actually uses to judge "how
  good was that." The specific report that started this whole spec was
  about ordinary matches ("a whatever moment"), so they still need a
  real, felt improvement — just not equal footing with a bomb.
- **Rejected alternative and why:** Uniform intensity across all
  mechanisms — simpler to implement and reason about, but directly
  undermines the hierarchy that makes rare mechanics feel rare, which
  is a real cost this spec's own problem statement argues against.

### Decision: Per-mechanism colors, chosen and verified against real CVD simulation
- **Choice:** Six colors, one per mechanism (ordinary match reuses the
  existing `palette.accent` unchanged, per the reward-budget decision
  above — it doesn't need a new color, it needs restraint):
  - ordinary match: `#A83A2E` (existing accent — unchanged)
  - blocker: `#E8B84B` (warm gold)
  - striped sweep: `#7FD1C9` (light teal)
  - area bomb: `#23395B` (dark navy)
  - color bomb: `#8B5FC7` (violet)
  - supercombo: `#6B1E3C` (dark wine)
  Live in a new `skinConfig.palette.effectColors` object.
- **Why:** A first pass spread purely by hue (`#C9932A` gold /
  `#3E8878` teal / `#4C6FA3` blue / `#7A5A9E` violet / `#B84C7A` rose,
  plus the existing red) was checked computationally against a
  Vienot-1999-style protanopia/deuteranopia simulation (the same class
  of transform the prior sprite-art CVD pass used) and FAILED: sweep and
  supercombo collapsed to a simulated distance of 3.0 (out of ~441
  possible) under deuteranopia — visually identical to a red-green
  colorblind player. Hue alone doesn't survive dichromatic simulation,
  because a dichromat's vision collapses most of the red-green axis, so
  hues that look obviously different to normal vision can co-locate on
  whatever axis remains. The revised set varies genuinely in
  **lightness** (a dark-navy/dark-wine/mid-violet/light-teal/light-gold
  ladder) in addition to hue, which dichromats can still resolve even
  when hue alone fails — re-simulated, minimum pairwise distance rose to
  32.7 (protanopia) / 45.0 (deuteranopia), every pair genuinely
  distinguishable.
- **Rejected alternative and why:** The pure hue-wheel-spread first
  pass — rejected on real computed evidence, not aesthetic preference;
  see above. Also rejected: reusing `secondaryAccent` (`#7C8F6E` sage)
  for one of the six — already has an established meaning elsewhere in
  the app's chrome (borders, secondary buttons), and reusing it for an
  effect wash would blur that meaning the same way the shared-accent
  problem this whole spec exists to fix did.

### Decision: `effectColor` is a new per-entry field, not a repurposed `accentColor`
- **Choice:** `ExitingTile` gains a new optional `effectColor` prop,
  defaulting to `accentColor` when absent, used ONLY by the wash
  overlays (blocker highlight, sweep glow, radial glow, convert flash,
  match pop). The tile's own border/chrome stays on the existing shared
  `accentColor` unchanged.
- **Why:** `accentColor` today drives both the tile's static border
  stroke AND every wash overlay's color. Repurposing it wholesale would
  recolor tile borders per-mechanism too, which was never asked for and
  would be a much larger, riskier visual change than "give each clear
  effect its own color." Keeping them separate is the minimal, correct
  cut.
- **Rejected alternative and why:** Overloading `accentColor` itself —
  smaller prop surface, but conflates two genuinely different concerns
  (persistent chrome color vs. momentary effect color) that happen to
  share a default today only by coincidence.

### Decision: The solo area bomb blast gets its own effect identity (new `area_bomb` descriptor kind)
- **Choice:** Extend `SpecialEffectDescriptor` with a fourth kind,
  `{ kind: 'area_bomb'; origin: Position }`, populated only for a
  solo area-bomb-into-ordinary-piece swap (not the three area+special
  combos, which keep falling through to the generic sweep, unchanged —
  out of scope here). Its blast-radius cells get a short radial travel
  (`radialDelaysForClears` reused with a new, much shorter
  `AREA_BOMB_WAVE_MS`, appropriate to a 3×3 blast's small real distances)
  instead of the flat instant-pop every other non-named effect falls
  into.
- **Why:** The spec's own in-scope list names "area bomb blast" as one
  of the six mechanisms needing a distinct color. Investigation
  confirmed the solo blast currently has NO distinct animation identity
  at all beyond the bomb piece's own powder-poof — its surrounding
  blast cells fall through to the same generic branch an ordinary match
  uses (today, that's the new `matchPop` branch added earlier the same
  day). Giving it a color without giving it *any* distinguishing motion
  would leave it visually closer to a plain match than to the other five
  named mechanisms, undermining the point of this spec for exactly the
  effect it names first.
- **Rejected alternative and why:** Leaving the area bomb's blast
  radius on the generic branch, distinguished by color alone with no
  motion change — simpler, but the existing radial-travel geometry
  already exists and fits (reusing, not inventing, per Scope
  Discipline) and every other named mechanism gets some real motion
  identity, not just a recolor.

## 3a. CVD verification (ran ahead of section 6, since it gated the color decision above)

A Vienot-1999-style linear-RGB simulation (protanopia and deuteranopia
matrices) was run against both candidate color sets before either was
adopted — script and full output are not checked in (a scratch
verification, not project code), but the numbers are recorded here since
they're what the color decision above rests on:

- First pass (pure hue spread): minimum pairwise simulated distance
  20.6 (protanopia, area_bomb vs. color_bomb), **3.0** (deuteranopia,
  sweep vs. supercombo) — failed.
- Revised pass (lightness-varied): minimum pairwise simulated distance
  32.7 (protanopia, area_bomb vs. supercombo), 45.0 (deuteranopia,
  area_bomb vs. supercombo) — passed, adopted.

This is the same rigor `docs/verification/accessibility-pass/colorblind-simulation/`
established for piece-sprite art; section 6 below still calls for a
proper checked-in verification artifact for these six effect colors
before this spec is considered fully closed, since a hand-run scratch
script is a real check but not yet a durable one.

## 4. Data model

<!-- Tables/collections, ownership, and the access rule per table.
     For anything multi-tenant or user-owned, state the enforcement
     mechanism explicitly (RLS forced, not just enabled). -->

No database — client-only game, presentation + skin-config layer only.

| Table | Owned by | Access rule | Enforcement |
|-------|----------|-------------|-------------|
| `skinConfig.palette` (new per-mechanism effect-color fields — exact field names TODO, proposed set below) | Skin | Read-only aesthetic data; `components/skinConfig.ts` schema | Existing `SkinPalette` interface, extended |
| `cascadeTiming.ts`'s `MATCH_POP_*` constants (values only, not shape) | Presentation layer | Retuned per the reward-budget decision — ordinary matches boosted, still the most subdued mechanism | `cascadeTiming.test.ts` |
| `skinConfig.palette.effectColors` (new: blocker/sweep/areaBomb/colorBomb/supercombo) | Skin | Read-only aesthetic data | `components/skinConfig.ts` schema |
| Reward-intensity signal (`passRewardIntensity`, new pure function) | Presentation layer only — deliberately NOT sourced from `CascadeResolution.score` | Confirmed against `engine/gameState.ts`: `score` is computed on every move but only the whole-move total reaches `ApplyMoveResult`, no per-pass breakdown exists. Rather than widen that contract, the signal is derived presentation-side from pass index + cells cleared, the same "derive from the diff, not new engine data" pattern `sweepDelaysForClears`/`radialDelaysForClears` already use | New test file/section |
| `SaveData` | Engine | **Unchanged** — no new persistence; a reward-scaling signal is presentation-only and level-scoped, same as `Objective.currentCount` today | Existing `gameState.ts` load/save tests |

## 5. Security posture

<!-- The baseline deployment floor applies automatically and is not
     restated here. This section is only for what is ABOVE the floor
     for this project, or any floor item deferred (which also goes to
     DEFERRED_COMPLEXITY.md with a reason). -->

**Above the floor:**
- Nothing new. No network surface, no new dependency, no persistence
  change.

**Floor deferrals (should be empty):**
- None introduced by this build.

**Adversarial pass scheduled:** No — no attack surface changes. This
build's equivalent scrutiny is the colorblind-safety check in section 6
(a real accessibility regression risk a color-scheme change genuinely
carries, unlike the prior spec's motion-only work).

## 6. Verification plan

<!-- This section IS the input to verify.sh. Every row names a behavior and
     the raw signal that proves it against the live system. If a behavior
     has no signal listed, it is not verifiable, which means it is not done.
     Per the baseline: the trace, not the claim. -->

No deployed server; "live" means the real running app over CDP (this
project's established method) plus, decisively, real human play — more
so than any prior spec, since "does this feel more fun" is the actual
question being answered and no automated check can answer it.

| Behavior | Command / probe | Signal that proves it |
|----------|----------------|-----------------------|
| Each mechanism renders in its own color, not the shared accent | Live CDP trace/screenshot comparing an ordinary match, a striped sweep, a bomb detonation, and a supercombo side by side | Visibly distinct hues per effect type, not shape/duration alone |
| New effect colors are colorblind-safe | **Preliminary pass done** (section 3a): Vienot-1999-style protanopia/deuteranopia simulation of the six hex values, run before adoption — min pairwise distance 32.7/45.0. Still open: a proper checked-in verification artifact against the actual rendered board background, matching `docs/verification/accessibility-pass/colorblind-simulation/`'s rigor | Every effect distinguishable under both simulations; a durable artifact exists, not just a scratch script's console output |
| Reward/tier signal is visible on a non-score-type level | Real `applyMove` trace across a multi-pass cascade on a `'collect'`-objective level | The chosen signal (visual scaling or a number) responds visibly to pass depth, where before nothing did |
| The ordinary-match pop reads as more rewarding, not more chaotic | Live side-by-side of the pre- and post-revision `MATCH_POP_*` values | Architect's own judgment call — this row is explicitly not automatable |
| No regression to swap feel, fall physics, or pass scheduling | Re-run the prior spec's own verification rows (fall-speed consistency, spawn streaming, pass-before-overlay ordering) | Unchanged from `SPEC-game-feel-overhaul-2026-08-08.md`'s closed state |
| Test suite green | `npx jest` | **Done**: 788/788 passing (up from 771), including new coverage for `resolveEffectColor`'s priority order, `resolveSpecialEffectDescriptor`'s solo-vs-combo area-bomb split (with the swap-anchor-cross-checked origin fix), and `passRewardIntensity`/`scaledByReward`'s monotonicity/ceiling guarantees |
| It actually *feels* more fun | Real play by Kevin, and ideally the game's real player, after the next OTA | The row that decides whether this spec succeeded — the stated problem was "not sure the fun factor is there," and that's a felt judgment, not a metric |

## 7. Career evidence

<!-- Career evidence is shifted left, same as security. These artifacts get
     produced DURING the build as a side effect, not after it as a project.
     The audience is hiring managers and engineering peers, not customers.
     Check them off as they happen.

     Shipped, for this lane, means live plus narrated: deployed, verify.sh
     evidence in hand, and this checklist done. "Technically complete" with
     this section empty means the project is not complete. -->

- [ ] One debugging story written up while fresh: "a vague 'not fun'
      report traced to two concrete causes — one shared color across
      every mechanic, one discarded feedback signal — instead of guessed
      genre-convention fixes"
- [ ] Before/after color comparison capture (the same cascade, old
      single-accent-wash vs. new per-mechanism colors)
- [ ] A decision-block-to-post candidate: "a design constraint that had
      silently overgrown its actual scope, and how a five-minute
      scoping conversation unblocked real work" (the calm-scope
      clarification itself)

## 8. Change log

<!-- Spec changes after AGREED get a dated line here. If the code and this
     spec disagree and the spec is the one that is wrong, the fix lands
     here in the same session, per "Docs move with the code." -->

| Date | Change | Why |
|------|--------|-----|
| 2026-08-08 | Drafted, status DRAFT. Prior `SPEC.md` (game-feel overhaul) archived to `docs/specs/SPEC-game-feel-overhaul-2026-08-08.md`, fully AGREED and verified — a separate, completed initiative, not overwritten. | New, distinct initiative per the spec skill's "do not overwrite an existing spec" rule |
| 2026-08-08 | DRAFT → AGREED. All four open forks resolved by the runner per explicit delegation ("I'll let you decide so I can be surprised"): reward-scaling is visual-only (no new HUD number), ordinary matches stay the most subdued mechanism in a real intensity hierarchy, six per-mechanism colors chosen and CVD-verified (a first hue-only pass failed simulation and was revised), the solo area bomb blast gets a new `area_bomb` descriptor kind for its own motion identity. | Kevin's delegation is the go-ahead; each decision recorded with its rejected alternative in section 3 |
| 2026-08-08 | Implemented and tested: `skinConfig.palette.effectColors`, `passRewardIntensity`/`scaledByReward` (cascadeTiming.ts), the `area_bomb` descriptor kind (with a swap-anchor-cross-checked origin fix caught before shipping — a solo area bomb follows the bomb's post-swap cell, not its pre-swap one, mirroring the established rule for every other local swap-triggered effect), `resolveEffectColor`/`radialKind`/`rewardIntensity` threaded through `ExitingEntry`/`Tile.tsx`/`Board.tsx`. 788/788 tests. **Not yet closed**: the felt/visual verification row — the board cannot render in this session's browser pane, so the color and intensity changes are unconfirmed against a real cascade. | Implementation session; the open row is the same "needs a real human check" standard the game-feel spec closed with |
