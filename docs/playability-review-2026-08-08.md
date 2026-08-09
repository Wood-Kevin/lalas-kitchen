# Playability Review — Lala's Kitchen (2026-08-08)

Reviewer stance: expert match-3 / casual game design, read-only against the codebase
(no files modified during the review itself). Hard constraint honored throughout: **no
annoying sounds** — none of the recommendations below add audio; the existing
sound-off-by-default + calm-tone design is treated as settled and correct.

Basis: direct reading of `engine/matrix.ts`, `engine/gameState.ts`, `engine/generator.ts`,
`appPersistence.ts`, `components/Board.tsx`, `components/Hud.tsx`, `components/WonOverlay.tsx`,
`components/Home.tsx`, `components/ComboStreakBanner.tsx`, `components/ContinueOffer.tsx`,
`components/PausedOverlay.tsx`, `App.tsx`'s `LEVEL_QUEUE`, `DEFERRED_COMPLEXITY.md`, and
`engine/DECISIONS.md` (via grep).

---

## Verdict

This is, mechanically, a genuinely well-built match-3 for this specific player. The
anti-frustration layer is the best thing in the game and is ahead of most commercial
titles: free uncapped shuffle, a 2-use hint, a difficulty breather after two losses, a
mid-level continue that spends the life only if declined, and lives regen with no ticking
clock. Calm is enforced at the pacing level everywhere it matters. What the game is missing
is not mechanics — it's **reward texture**: the moment-to-moment numeric and visual feedback
that makes each move feel like it accomplished something. Most of that is already computed
by the engine and simply never shown.

Priority order below: the first two findings are the highest-impact, cheapest changes
available. Items 3–6 are real but smaller. Items 7+ are observations, most already
disclosed in the repo's own docs.

---

## Finding 1 — Score is invisible on every non-score level (biggest lever)

**What I verified:** `components/Hud.tsx` renders exactly three panels — Target / Moves /
Lives. Per-move score exists in the engine for *every* move regardless of objective type:
`engine/gameState.ts` computes `scoreGained`/`CascadeResolution.score` on every `applyMove`
(three scoring tiers, plus a per-pass chain multiplier `passScoreMultiplier`), but that
number is only ever surfaced when the objective itself is `type: 'score'`. On a `'collect'`
level — the majority of the game — the player's only numbers are a countdown (Moves) and a
count-up (Target). Nothing rewards the quality of a move. A 3-match, a striped sweep, and a
chain reaction are numerically indistinguishable on screen.

This is exactly the gap the 2026-08-08 "Scope of calm" note already identifies as open
ground ("surfacing score/tier feedback on ordinary collect levels ... is open ground"), and
it is **presentation-only work** — the engine already computes the number.

**Recommendation (cheap, high impact):**
- Show a small running score on every level (one more HUD panel or a corner readout),
  fed by the per-move `score` `applyMove` already returns — zero engine change.
- Show a per-move floating `+N` at the cascade's clear point, sized/colored by tier
  (ordinary/special/bomb), and let the pass multiplier be visible: a second cascade pass
  reading a bigger `+N` than the first is the single clearest "chains are worth more" teach
  the genre has, and this engine already prices it correctly.

This gives every move a reason without any sound, timers, or purchase pressure.

---

## Finding 2 — All special effects render in one shared accent color

**What I verified:** the 2026-08-08 fun-factor review already recorded the symptom — every
effect (ordinary match, blocker clear, striped sweep, color bomb detonation, area bomb
blast, supercombo) uses the single `palette.accent`, differentiated only by shape and
duration. `components/specialEffectAnimation.ts` and the `Tile.tsx` exiting/clear paths
confirm it: no per-mechanism hue exists anywhere.

**Recommendation (medium effort, high impact):** give each special a calm identity hue for
its *effect* (not the resting piece necessarily — just the clear/radial/sweep visual):
e.g. striped = one soft hue, color bomb = another, area bomb = a third. The mechanics are
already genuinely distinct; the eye just can't tell. Per the scope note, this does not touch
the sound or monetization axes that "calm" actually protects, and nothing about a color
change makes pacing frantic.

---

## Finding 3 — The combo celebration threshold (4 cascades) is too deep for this player

`COMBO_STREAK_THRESHOLD = 4` (`engine/gameState.ts`). Four consecutive cascade passes in
one move is a rare event — it happens, but for a player who plays at an unhurried pace it
will be a "wait, did that even happen?" moment, and the calm "Nice chain!" banner
(`components/ComboStreakBanner.tsx`) goes almost entirely unseen.

**Recommendation:** consider lowering the threshold to 3 so the acknowledgment lands at the
"chain of three" moment casual players actually experience, or make the banner copy scale
with depth. If the concern is banner spam, the 3-pass threshold is still rare enough. This
is a one-line tuning change; hand-picked either way, so worth a playtest before shipping.

---

## Finding 4 — The no-moves shuffle rescue is silent

When a board runs out of legal moves, `hasLegalMoves → shuffle` rescues it. The diff
layer animates the relocations (it's a real, visible motion pass — good), but there is no
text acknowledgment. For a casual player a silently re-arranged board reads as either a
glitch or their own doing.

**Recommendation:** a calm one-line acknowledgment — "The board was refreshed" as a small
fade pill, same visual language as the combo banner. It's presentation-only, and it also
gives the free Shuffle button a consistent voice.

---

## Finding 5 — Star-rating thresholds are opaque

Stars are computed from `movesRemaining` vs `movesLimit` (`components/wonActions.ts`). A
player who wins with one star has no idea what would have earned three, and since the
threshold isn't shown pre-move there's no way to play toward it.

**Recommendation:** show the thresholds somewhere calm — a "★ ★ ★ at N moves remaining"
line on the win overlay, or on the level map tooltip. Cheap, and it gives the (already
persisted) best-ever star system a reason to exist beyond decoration.

---

## Finding 6 — `sealed_jar` (specialOnly) can co-occur with denial-spread on the same generated level — a difficulty spike no lever accounts for

**What I verified, this is the one genuinely new finding the repo does not already disclose:**
three independently-designed gates all saturate at once on some generated levels, with no
guard preventing their combination:

- `DENIAL_SPREAD_MIN_LEVEL_NUMBER = 10` (`appPersistence.ts`): at generated level ≥ 10, the
  blocker zone spreads into adjacent ordinary cells.
- `BLOCKER_MIN_LEVEL_NUMBER.sealed_jar = 12`: from generated level 12, `sealed_jar` enters
  the eligible blocker rotation — a blocker that only takes damage from *special* clears.
- `generatedBlockerCount` caps at 4 blockers, reached by generated level ~9.

So a generated level at ≥ 12 can contain **up to four spreading, ordinary-match-immune
blockers** on an 18-move, 6-type board. The spread minted blockers inherit `specialOnly`
(the tuning-constant-review fix confirmed this), so the zone grows into a wall that a player
who hasn't yet built a special can't damage at all. The difficulty breather does not touch
this — it only loosens moves/target on the next level.

This is exactly the repo's own documented bug class: two or three independently correct
systems never checked against each other once they can co-occur.

**Recommendation (decide, don't guess):** at minimum, gate the two — e.g. a `sealed_jar`
level never spreads (or the spread is suppressed when the level's blocker type is
`specialOnly`). Alternatively, let the breather also trim blocker count. I'd recommend the
first: the sealed jar is *already* the "toughest idea" card; making its board also grow is
stacking two lessons in the same level, against the project's own pacing discipline.

---

## Observation 7 — The hand-built queue contradicts the generator's own difficulty thesis

`generatedPieceTypeCount`'s documented thesis is "fewer piece types = gentler, denser
matches." But `App.tsx`'s `LEVEL_QUEUE` levels 1–3 all use the full 6-type pool, so a brand
new player's first board (while the how-to-play tutorial is still on screen) has 6 types and
a specific 1-in-6 target. The ramp logic only ever applies to generated content, which now
starts 11 levels in.

Not urgent for the one real player (she's past level 300), but for any fresh install this
is the gentlest possible fix: give levels 1–2 a 3–4 type pool. Cheap, consistent with the
engine's own ramp reasoning.

---

## Observation 8 — Everything else worth noting is already disclosed in the repo

Reading `DEFERRED_COMPLEXITY.md` against the code, the following are already honestly
logged and I have nothing to add:
- No dedicated fall/collection animation for escort dropdowns (uses generic gravity).
- The area+special combos animate with the generic sweep (no distinct descriptor).
- The generated ramp flatlines by ~level 25 (level 300 ≈ level 60) — fine for a calm
  endless game, but it is why "the game stops changing."
- The recipe reveal on the win overlay isn't tappable (only the collection screen opens
  the detail view).
- No sound on combo events, and all audio work is pending a human listen.

---

## Explicitly NOT recommended (honoring the brief)

- **Daily streaks / timed events / "wheels."** The game's "no timers, no rush" identity is
  its differentiation for this player; any urgency system is pressure, which is the one
  thing the brief and the design constraints both forbid. The existing next-recipe-hint
  ("a new recipe waits N levels ahead") is the right, pressure-free session goal.
- **Anything purchasable.** Already absent by design; keep it that way.
- **More/looser sound.** Sound is off-by-default and tuned calm; the constraint here is
  "no annoying sounds," and the current posture is the safe one. If the combo banner ever
  wants a cue, it should follow the existing match/cascade/win tones, gated behind the
  same toggle — but I would not make this a priority.
- **Richer celebration on wins.** The win overlay's steam + sparkle is appropriately
  restrained; fireworks would be out of character. *(Historical — this recommendation
  was reversed later the same day: the "calm" framing this was reasoned from was itself
  corrected, and a real firework-style burst for a genuine peak win now exists — see
  WinCelebrationBurst.tsx. Left as-is rather than edited, since this file is a dated
  point-in-time record.)*

---

## Summary of recommended priorities

| # | Change | Effort | Impact | Scope |
|---|--------|--------|--------|-------|
| 1 | Surface per-move score + cascade-tier feedback on all levels | Low | High | Presentation |
| 2 | Per-mechanism effect colors | Medium | High | Presentation |
| 3 | Combo threshold 4 → 3 | Trivial | Medium | Tuning |
| 4 | Announce the shuffle rescue | Low | Medium | Presentation |
| 5 | Show star thresholds | Low | Medium | Presentation |
| 6 | Gate sealed_jar vs denial-spread co-occurrence | Low | High | Engine/tuning |

Findings 1, 2, and 6 are the ones I would take to the architect first: 1 and 2 are the
open-ground reward-texture work the game is actually missing, and 6 is a real,
repo-not-yet-disclosed difficulty spike.
