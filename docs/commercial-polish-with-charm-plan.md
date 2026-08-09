# Lala's Kitchen — Commercial Polish With Charm

## Product intent

Move Lala's Kitchen toward the presentation quality of a premium casual match-3
game while preserving the reason the project exists: it should still feel like a
warm, personal game made for Mom.

The target is **commercial polish without commercial pressure**.

Keep:

- Lala's warmth and the family-kitchen setting;
- the illustrated food sprites and recipe-book collection;
- calm pacing and no timers;
- no monetization requirements;
- sound and haptics optional and off by default;
- accessible touch targets and readable UI.

Add:

- more responsive moment-to-moment feedback;
- stronger visual hierarchy;
- richer but restrained transitions;
- clearer rewards and progression;
- consistent production quality across every state.

Do not clone Royal Match or Candy Crush. Use them as quality benchmarks for
feedback density, animation finish, and reward clarity—not as references for tone,
monetization, or visual identity.

---

## North-star test

Every proposed change should pass both questions:

1. Would Mom immediately understand and enjoy this?
2. Would a new casual player recognize this as a polished, modern match-3 game?

If a change improves one answer but harms the other, reduce its intensity rather
than removing the charm.

---

## Implementation strategy

Work in small, reviewable slices. Do not attempt a full rewrite.

### Phase 0 — Capture a baseline

Before changing behavior:

- capture one clean level at rest;
- capture a normal match;
- capture a special creation;
- capture a two-pass cascade;
- capture a blocker hit;
- capture a win and recipe reveal;
- capture the level map and home screen.

Use the same device size for before/after comparison. Record animation timings,
not just screenshots.

### Phase 1 — P0 gameplay feel

This is the highest-value phase because it affects every level.

#### 1. Input response

- Make the selected tile state immediate and unmistakable.
- Make the dragged tile visibly follow the finger without feeling loose.
- Add a small destination preview during a valid drag.
- Keep illegal swaps calm and readable: short return motion, no punishment flash.
- Preserve the current generous touch target.

#### 2. Match feedback

Build a consistent beat for every accepted move:

1. swap anticipation;
2. match highlight;
3. clear/pop;
4. score feedback;
5. refill and settle;
6. cascade escalation if another match forms.

Recommended feel targets:

- input acknowledgment: 60–100 ms;
- ordinary match pop: 180–260 ms;
- special activation: 300–500 ms;
- cascade pass spacing: long enough to read, never frantic.

Do not speed up the game globally. Improve clarity and rhythm instead.

#### 3. Reward feedback

- Show a small floating `+N` score on every scoring move.
- Scale copy and color by action quality, not by arbitrary screen decoration.
- Show a larger but still restrained reward for special clears and cascades.
- Keep ordinary matches subdued so special actions remain meaningful.
- Add a quiet “Nice chain!” or Lala line only after the cascade settles.

### Phase 2 — P0 HUD and board presentation

#### Kitchen Tray HUD

Use the isolated prototype:

`components/HudOptionB.tsx`

Implementation requirements:

- Target, Moves, Lives remain readable at a glance.
- Score is visible on every level.
- The tray must not reduce board tap size materially.
- Low moves get a visual state, but not a timer-like warning.
- Multiple objectives must fit without clipping.
- Test with the largest supported system font setting.

#### Board surface

Add a subtle warm kitchen surface behind the board. It should provide depth, not
become scenery that competes with the pieces.

- quiet wood, parchment, or linen texture;
- soft board shadow or inset frame;
- no high-contrast objects behind active tiles;
- preserve the existing ingredient sprite silhouettes.

#### Special-piece hierarchy

Keep the existing special sprites documented in:

`docs/special-piece-assets.md`

Use distinct momentary effect colors:

| Event | Suggested effect color |
| --- | --- |
| Ordinary match | tomato accent |
| Blocker hit | warm amber |
| Striped sweep | soft turquoise |
| Area bomb | deep blue / navy |
| Color bomb | violet-gold |
| Supercombo | deep wine |

Use these colors during activation and clearing only. Resting tiles should remain
consistent with the current food-sprite palette.

### Phase 3 — P1 win and reward polish

The win state should feel like a small ceremony, not a generic modal.

- Let the final cascade finish before the overlay appears.
- Animate stars sequentially with a short readable beat.
- Show score, moves remaining, and star result in one hierarchy.
- Reveal the recipe card with a small paper/card motion.
- Add one handwritten recipe annotation.
- Show the next recipe milestone without creating urgency.
- Keep “Play Again” and “Back to Levels” visually secondary to the primary next step.

Use restrained particles: steam, crumbs, or tiny ingredient sparkles for an
ordinary win. **Revised**: real celebration effects, including
firework-style particle bursts, are in scope for a genuine peak (a 3-star
finish, or a win that unlocks a recipe card) — confirmed directly by the
architect, correcting this line. See wonActions.ts's isStrongWin and
WinCelebrationBurst.tsx. Still bounded to the win overlay's own card area,
never full-screen edge-to-edge.

### Phase 4 — P1 authored progression

Add structure without adding pressure.

#### Recipe chapters

Use the chapter data and copy in:

`docs/release-character-pack.md`

Recommended initial chapters:

- Morning Table;
- Garden Basket;
- Sunday Simmer;
- Bread & Hearth;
- Pantry Favorites.

Give each chapter a landmark and light accent treatment. Do not redesign the whole
level map before one chapter has been tested end-to-end.

#### Authored level names

Keep numeric levels visible, but add a name such as “The Golden Skillet” or “Slow
Simmer.” Use deterministic names for generated levels and hand-authored names for
milestones.

#### Milestone vignettes

At major recipe unlocks, show a small static illustration of Lala watering herbs,
opening the pantry, pulling bread from the oven, or setting the table. One sentence
of copy is enough.

### Phase 5 — P1 Lala presence

Add `LalaMomentBanner` or equivalent as a non-blocking overlay.

Rules:

- maximum one moment per move;
- do not show on every ordinary match;
- prefer post-cascade timing;
- fade in and out without stopping input;
- support sound-off and haptics-off play;
- use the copy bank in `docs/release-character-pack.md`.

Moments should feel like Lala is nearby, not like a tutorial system is interrupting.

---

## Visual quality checklist

Before calling a slice complete, check:

- Are all active board pieces real sprites rather than text fallbacks?
- Are shadows, borders, and corner radii consistent?
- Does every interaction have a clear start, middle, and end state?
- Is the player’s eye drawn to the board first, then the objective, then the reward?
- Can a player understand what happened without sound?
- Does the screen still feel like Lala's kitchen rather than a generic match-3?
- Does the UI remain comfortable on a small phone?

## Accessibility and calm-mode requirements

- Do not rely on color alone for special-piece meaning.
- Preserve the striped direction badge and readable icons.
- Keep contrast sufficient for labels and progress values.
- Preserve screen-reader labels for tiles and controls.
- Sound and haptics remain opt-in and off by default.
- No timer bars, countdown pressure, streak loss, or monetized interruption.

## Suggested review gates

### Gate 1 — Board feel

Review one normal match, one special, and one cascade. If the board is not
satisfying without the win overlay, stop and tune this phase before adding content.

### Gate 2 — HUD readability

Review on the smallest supported phone and with large text enabled. Confirm that the
tray adds character without shrinking the playable board.

### Gate 3 — Reward ceremony

Review one ordinary win and one recipe unlock. The player should understand what
they earned, why it matters, and what comes next without feeling rushed.

### Gate 4 — Mom test

Ask the original intended player to play without explanation. Watch for:

- hesitation about what to tap;
- confusion about specials;
- missed rewards;
- feeling rushed or pressured;
- delight at Lala, the recipes, or the kitchen world.

Fix confusion before adding more polish.

## Definition of done for the first release-polish slice

- Kitchen Tray HUD is integrated and responsive.
- Score and floating reward feedback are visible during play.
- Special effects have distinct visual identities.
- One complete cascade feels intentional and satisfying.
- One win flow has polished star and recipe timing.
- Lala's character remains visible through copy or context without interrupting play.
- No changes introduce urgency, monetization pressure, or a loss of the family-kitchen
  identity.

