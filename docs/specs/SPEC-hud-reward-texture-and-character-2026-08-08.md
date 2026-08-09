# SPEC.md — Lala's Kitchen: HUD Reward Texture & Character Redesign

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
**Date agreed:** 2026-08-08 (Kevin: "Character as in just not bland" — resolves the board-scope fork; running-score-display fork resolved by the runner, see section 3)
**Owner:** Kevin

---

## 1. Problem

<!-- One paragraph: what problem, for whom, and which lane this build
     serves (joy, career evidence, or both). Joy builds don't need market
     permission — no validation gate here. But be honest about the lane:
     a career-evidence build with no audience in mind is neither. -->

**Problem:** A same-day background playability review (`docs/playability-review-2026-08-08.md`)
named its highest-impact, cheapest finding: score is fully computed by
the engine on every move (`ApplyMoveResult.score`, three tiers, a
per-pass chain multiplier) but only ever *shown* on `'score'`-type
objective levels — the majority of the game's HUD gives a player no
numeric or visual sense that a bigger move accomplished more. That
review also produced a concept sketch, `components/HudOptionB.tsx` (the
"Kitchen Tray" direction), as a candidate redesign. A runner review of
that file (this session) found it was not implementation-ready: its
`score` prop has no data source in `Board.tsx` today, its colors are
three hardcoded hex values that bypass this project's skin-config
architecture entirely, and its added chrome height was never checked
against `CLAUDE.md`'s own tap-accuracy constraint. Separately, the
architect asked directly for this work to also address that **the
player board needs some character** — the current `Hud.tsx` is
deliberately flat, minimal chrome (a real, cited design constraint:
"every pixel spent on chrome here is a pixel not spent on tile size"),
and now reads as *too* plain, not just under-informative.

**Lane:** Joy — this is felt game-quality work for the one real player
and for the game's own life, not a market-facing feature.

## 2. Scope

**In scope (this build):**
- A running per-attempt score, visible on **every** level regardless of
  objective type — not just `'score'`-type ones (Finding 1 of the
  playability review). Resets on a fresh attempt (retry/Play Again),
  the same per-attempt lifetime every other Board.tsx attempt-scoped
  state (`bonusGrantsUsed`, hint/shuffle usage) already has.
- A real visual character pass on the HUD, using `HudOptionB.tsx`'s
  Kitchen Tray direction as the aesthetic basis, corrected so its colors
  come from new `SkinPalette` fields rather than hardcoded hex — the
  same fix pattern the visual-reward-language spec already established
  for effect colors.
- Live measurement of the redesigned HUD's height against a real small
  viewport (an SE-sized screen, this project's own established worst
  case) to confirm it does not shrink `tileSize` — not just a visual
  approval, an actual `onLayout`-driven check.
- Preserving the current one-row-per-objective HUD layout for
  multi-objective levels (a deliberate correction to `HudOptionB.tsx`,
  which collapses multiple objectives into one joined text string — a
  real legibility regression from what `Hud.tsx` does today, not
  something to carry forward silently).

**Explicitly out of scope:**
<!-- Anything cut mid-build goes to DEFERRED_COMPLEXITY.md per the baseline,
     but known cuts get listed here up front so the runner never "helpfully"
     builds them. -->
- Any change to the score calculation itself (`SCORE_TIER_POINTS`,
  `passScoreMultiplier`) — this build is about visibility, not values.
- Sound or haptic cues tied to score/combo events — the playability
  review's own "Explicitly NOT recommended" section is explicit that
  audio work stays out of scope here; sound stays off-by-default,
  unchanged.
- The playability review's other findings (3–6: combo-streak threshold
  tuning, an announced shuffle rescue, star-rating threshold display,
  the `sealed_jar`/denial-spread co-occurrence gate) — real, but
  separate asks, not folded into this build per Scope Discipline.
- Any monetization, purchase, or urgency framing around score (no "beat
  your best," no leaderboard, no daily reset) — nothing purchasable
  stays nothing purchasable; a running score is flavor, not a hook.
- The game **board's own tile-grid frame/background** — confirmed out
  of scope (see section 3's "character means the HUD" decision). Its
  edge-to-edge, no-frame tap-accuracy treatment is untouched.

## 3. Architecture decisions

<!-- One block per meaningful decision. Same rule as "Justify every change"
     in the baseline, applied at design time: the shape, the why, and the
     alternative not taken. These blocks double as ADRs and as content seeds
     for the Career evidence section. -->

### Decision: Running score lives in new Board.tsx state, not GameState/SaveData
- **Choice:** A new per-attempt `runningScore` state in `Board.tsx`,
  incremented by `ApplyMoveResult.score` after every committed move,
  reset to 0 on a fresh attempt. Not persisted, not added to
  `GameState`.
- **Why:** `ApplyMoveResult.score` already exists and is computed for
  every move regardless of objective type (confirmed by direct reading
  of `engine/gameState.ts` during the visual-reward-language spec) — no
  engine change needed for a whole-move total. On a `'collect'`/
  `'clearance'`/`'escort'` level, this number is pure flavor (it never
  gates winning), so it doesn't belong in persisted save state any more
  than, say, the combo-streak banner's trigger does.
- **Rejected alternative and why:** A real `GameState.score` field,
  persisted like `Objective.currentCount` — heavier, and would need a
  save-schema migration for a value with no actual game-mechanical
  consequence outside `'score'`-type levels, where it already exists
  under a different name.

### Decision: HUD colors move into new `SkinPalette` fields, not hardcoded hex
- **Choice:** Whatever warm tray/chip palette the character redesign
  uses becomes real `SkinPalette` data (new fields, naming TBD by the
  runner at implementation time, following the `effectColors` precedent
  set earlier the same day).
- **Why:** Every color in this codebase is skin-owned data — `accent`,
  `panel`, `border`, `text`, `mutedText`, `secondaryAccent`,
  `effectColors` are all in `SkinPalette`. `HudOptionB.tsx`'s three
  hardcoded hex values (`#A87543`/`#7D512D`/`#D8B37B`) are the one place
  in the app that convention breaks, confirmed by direct comparison
  against `Hud.tsx` sitting in the same file tree.
- **Rejected alternative and why:** Keeping them as local constants in
  the HUD component — smaller diff, but reintroduces exactly the
  inconsistency a runner review flagged this session, and blocks a
  hypothetical second skin from ever using its own HUD palette.

### Decision: Multi-objective levels keep one row per objective, not a joined string
- **Choice:** The character redesign keeps `Hud.tsx`'s current
  structure — each objective gets its own icon+count row — restyled
  with the Tray's chip/color language, rather than adopting
  `HudOptionB.tsx`'s single joined `"3/10 · 1/5"` text line with stacked
  icons ahead of it.
- **Why:** A real, confirmed regression risk in the reviewed mockup: the
  generator places two `'collect'` objectives once a level's piece-type
  pool reaches 5+ types, and a joined string with icons crowded ahead of
  it is measurably harder to parse at a glance than two clearly
  separated rows, which is what the game already does correctly today.
- **Rejected alternative and why:** Carrying `HudOptionB.tsx`'s layout
  forward unchanged — was the literal mockup, but a runner review is
  exactly where this kind of regression should be caught before it
  ships, not after.

### Decision: The running score displays as a persistent total only, for this build
- **Choice:** Option (a) from the two the playability review named — a
  persistent running total (the "Score" plaque `HudOptionB.tsx` already
  sketches). Not the per-cascade-pass floating `+N` (option b), and not
  both.
- **Why:** Zero engine change — `ApplyMoveResult.score`'s whole-move
  total is already exactly what a running total needs. The floating
  `+N` is the more emotionally legible version but requires actually
  widening `ApplyMoveResult` with a per-pass breakdown, a real,
  deliberate engine-boundary change — worth doing once it's clear the
  simple version doesn't already solve "a whatever moment," not before.
  Start cheap, validate, escalate only if still needed — the same
  reasoning that kept the visual-reward-intensity feature presentation-
  only, applied to a build decision this time rather than an
  architecture one.
- **Rejected alternative and why:** The floating `+N` (or both) up
  front — genuinely the more teachable version, and not rejected
  forever (see `DEFERRED_COMPLEXITY.md`), just not proven necessary yet
  against the cost of widening a tested public contract.

### Decision: "Character" means the HUD, not the board's tile-grid frame
- **Choice:** This build is HUD-only. The board's own edge-to-edge,
  no-frame treatment (`CLAUDE.md`'s tap-accuracy constraint) is
  untouched.
- **Why:** Confirmed directly — "Character as in just not bland" reads
  as a statement about the current flat HUD's *quality*, not an
  instruction to add board-grid chrome that trades against a distinct,
  concretely stated constraint. The bar for this build is real: not a
  token palette tweak, genuine visual warmth and personality within the
  HUD's existing footprint.
- **Rejected alternative and why:** Also restyling the board's own
  frame/background — would have been guessing past what was actually
  confirmed, and trades directly against a named constraint that was
  never addressed in this decision.

## 4. Data model

<!-- Tables/collections, ownership, and the access rule per table.
     For anything multi-tenant or user-owned, state the enforcement
     mechanism explicitly (RLS forced, not just enabled). -->

No database — client-only game.

| Table | Owned by | Access rule | Enforcement |
|-------|----------|-------------|-------------|
| `Board.tsx`'s `runningScore` (new, presentation-layer state) | Presentation layer | Per-attempt only, never persisted | Reset alongside every other per-attempt state in `handlePlayAgain` |
| `skinConfig.palette` (new HUD character fields) | Skin | Read-only aesthetic data | `components/skinConfig.ts` schema, extended |
| `ApplyMoveResult` | Engine | **Unchanged** — the running-total decision needs no new field, `score` already exists per move | Existing `gameState.ts` tests |
| `SaveData` | Engine | **Unchanged** — no new persistence | Existing `gameState.ts` load/save tests |

## 5. Security posture

<!-- The baseline deployment floor applies automatically and is not
     restated here. This section is only for what is ABOVE the floor
     for this project, or any floor item deferred (which also goes to
     DEFERRED_COMPLEXITY.md with a reason). -->

**Above the floor:** Nothing new. No network surface, no new dependency,
no persistence change.

**Floor deferrals (should be empty):** None.

**Adversarial pass scheduled:** No — no attack surface changes.

## 6. Verification plan

<!-- This section IS the input to verify.sh. Every row names a behavior and
     the raw signal that proves it against the live system. If a behavior
     has no signal listed, it is not verifiable, which means it is not done.
     Per the baseline: the trace, not the claim. -->

| Behavior | Command / probe | Signal that proves it |
|----------|----------------|-----------------------|
| Score is visible and accurate on a `'collect'`-type level | Real `applyMove` unit test (`engine/gameState.test.ts`) plus a live CDP check of level 1 ("Tomato Toss," a `'collect'` level) | **Done**: `ApplyMoveResult.score` (a genuinely new engine field — it did not exist before this build, confirmed by direct reading; only the internal `CascadeResolution.score` existed) is unit-tested (a plain 3-match scores exactly 30; a rejected move scores exactly 0). Live: the running app shows "Score / 0" in the HUD on level 1 before any move |
| Score resets on a fresh attempt | Code review of `handlePlayAgain` | **Done**: `setRunningScore(0)` sits alongside every other per-attempt reset |
| HUD colors come from `SkinPalette`, not hardcoded values | Code review / grep for hex literals in the new HUD component | **Done**: zero hardcoded hex colors in `Hud.tsx`; all sourced from `config.palette` (`panel`, `border`, `accent`, `mutedText`, `secondaryAccentText`, the new `tray.*`) |
| A two-objective level still reads clearly | Code review — the redesign preserves `Hud.tsx`'s original per-objective row structure, only restyled | **Done** by construction; not separately live-checked this session (no generated 2-objective level was reached in the live check, which only visited level 1) |
| The redesigned HUD's `tileSize` impact on a small viewport | **Done, real measurement** (not estimated): live `getBoundingClientRect()` over CDP against the real running app at the true 375×667 SE viewport, on level 1 (8 rows × 5 cols — one of the narrower shapes). Two tightening passes applied after the first pass's rough estimate showed a real risk | `boardArea` = 351×507px, `byWidth`=65, `byHeight`=63, `tileSize`=63 — **height is the binding constraint by 2px/tile (~3%)**, a small, disclosed, real cost, not eliminated but honestly measured and minimized without visibly undercutting the "not bland" ask. A 6-column (or wider) level's `byWidth` sits far below `byHeight`, so this cost is specific to the game's narrower shapes, not universal |
| Test suite green | `npx jest` | All passing, current baseline 788 plus new coverage |
| It actually reads as more rewarding, and has real character | Real play by Kevin, ideally after an OTA reaches his device | The row that decides whether this build succeeded — a felt judgment, not a metric |

## 7. Career evidence

<!-- Career evidence is shifted left, same as security. These artifacts get
     produced DURING the build as a side effect, not after it as a project.
     The audience is hiring managers and engineering peers, not customers.
     Check them off as they happen.

     Shipped, for this lane, means live plus narrated: deployed, verify.sh
     evidence in hand, and this checklist done. "Technically complete" with
     this section empty means the project is not complete. -->

- [ ] A short writeup of the `HudOptionB.tsx` review itself — a good
      concept sketch caught short of implementation-ready by three
      concrete, checkable gaps (data source, architecture consistency,
      unverified layout impact) is a clean, transferable review story
- [ ] Before/after HUD screenshot pair
- [ ] If option (b) is chosen: a decision-block-worthy post on when it's
      right to widen a tested public contract for a feature vs. when
      it's right to approximate presentation-side (contrasting directly
      with the same-day visual-reward-intensity decision)

## 8. Change log

<!-- Spec changes after AGREED get a dated line here. If the code and this
     spec disagree and the spec is the one that is wrong, the fix lands
     here in the same session, per "Docs move with the code." -->

| Date | Change | Why |
|------|--------|-----|
| 2026-08-08 | Drafted, status DRAFT. Prior `SPEC.md` (visual reward language) archived to `docs/specs/SPEC-visual-reward-language-2026-08-08.md`, fully AGREED and implemented — a separate, completed initiative, not overwritten. | New, distinct initiative per the spec skill's "do not overwrite an existing spec" rule |
| 2026-08-08 | DRAFT → AGREED. Board-scope fork resolved by Kevin ("Character as in just not bland" — HUD-only, real warmth not a token tweak). Score-display fork resolved by the runner: running total only for this build, per-cascade `+N` deferred as a well-scoped escalation, not built now. | Kevin's clarification plus the runner's own start-cheap-validate-first reasoning |
| 2026-08-08 | Implemented and tested: `ApplyMoveResult.score` (a real engine addition — investigation found no score reached the public contract at all before this, correcting an imprecise claim in the archived visual-reward-language spec), `Board.tsx`'s `runningScore`, `SkinPalette.tray`, `Hud.tsx`'s Kitchen Tray redesign (`HudOptionB.tsx` deleted, folded in with two corrections: palette-sourced colors, preserved per-objective rows). Tap-accuracy cost measured for real over CDP (not estimated) and minimized via two tightening passes — a small, disclosed residual remains on narrow-column levels only. 790/790 tests. Not yet felt-verified. | Implementation session; the open row is a human "does this feel like character" judgment |
