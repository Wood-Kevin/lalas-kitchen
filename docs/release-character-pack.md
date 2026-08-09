# Lala's Kitchen — Release Character Pack

Implementation brief for the next character pass. This document is deliberately
self-contained so it can be handed to Claude without changing the current design
direction or introducing new progression pressure.

## Release goal

Make the game feel more authored and personal during ordinary play. Preserve the
existing identity:

- warm, calm, cozy, and unhurried;
- no timers, streak pressure, or monetization prompts;
- no loud particle storms or noisy celebration layers;
- food-first visuals with Lala's Kitchen's cream, tomato-red, sage, and wood palette.

## Recommended implementation order

1. Use the standalone Option B HUD.
2. Add sparse Lala microcopy moments.
3. Add recipe chapters and authored level names.
4. Add a subtle kitchen surface behind the board.
5. Add milestone vignette art when time allows.

---

## 1. Option B HUD — Kitchen Tray

### Existing implementation asset

Use the isolated component:

`components/HudOptionB.tsx`

It accepts the same data shape as the current HUD and is intentionally not wired
into `App.tsx` or `Board.tsx` yet.

### Visual specification

- A shallow warm-wood tray sits behind the top HUD.
- Three rounded cream chips: Target, Moves, Lives.
- Ingredient or objective sprite appears beside Target progress.
- Flame sprite appears beside Lives.
- Score sits in a small centered plaque below the chips.
- Keep the tray compact enough that the board remains the visual focus.
- Use the existing skin palette; do not introduce a new color system.

### Acceptance criteria

- The HUD remains readable on narrow phones.
- Target supports multiple objectives without clipping.
- Large text settings do not overlap the tray.
- The score plaque is present on every level but remains visually secondary.
- No existing HUD file is deleted until the alternate has been playtested.

---

## 2. Lala microcopy

Use short, optional, low-frequency text moments. These are not dialogue boxes and
must never block a move.

### Trigger-to-copy bank

| Trigger | Copy options |
| --- | --- |
| First valid move of a level | `There we are.` / `A good start.` |
| 4+ pieces cleared | `That'll do nicely.` / `A good stir.` |
| Special piece created | `A little kitchen magic.` |
| Special piece activated | `Now that's a useful one.` |
| Cascade of 2 | `Look at that little chain.` |
| Cascade of 3+ | `Beautifully done.` / `That came together nicely.` |
| Manual shuffle | `Let's freshen the board.` |
| Automatic no-moves rescue | `The board needed a little reset.` |
| One move remaining | `One more careful stir.` |
| Level win | `Perfect. Let it simmer.` |
| Recipe unlock | `Another favorite for the book.` |
| Returning home | `Welcome back, dear.` |

### Presentation rules

- Show at most one line per move.
- Prefer showing copy after a cascade settles, not during active board motion.
- Fade in, hold briefly, fade out; never cover the board.
- Do not use copy on every ordinary match.
- Avoid exclamation-heavy writing; reserve one exclamation for major unlocks.
- Keep copy dismissible by continuing play.

Suggested component name: `LalaMomentBanner`.

---

## 3. Recipe chapters

Use chapters to make the recipe book and level map feel like a journey through one
kitchen rather than an endless numeric list.

### Chapter data

| Chapter | Suggested range | Accent cue | World cue |
| --- | ---: | --- | --- |
| Morning Table | 1–20 | soft gold | window light, spoon, breakfast cloth |
| Garden Basket | 21–60 | sage green | herbs, lemons, garden gate |
| Sunday Simmer | 61–120 | tomato red | stock pot, recipe box, copper pan |
| Bread & Hearth | 121–220 | toasted brown | flour sack, loaf, oven mitt |
| Pantry Favorites | 221+ | deep plum / warm spice | jars, baskets, handwritten labels |

### Chapter presentation

- Add a small chapter label above the relevant level-map section.
- Add one landmark illustration per chapter.
- Use the chapter accent only for borders, labels, and small highlights.
- Keep the global background and main UI palette unchanged.
- Chapter transitions should be collectible and calm, not gated by a timer.

Suggested data shape:

```ts
type RecipeChapter = {
  id: string;
  title: string;
  levelStart: number;
  levelEnd?: number;
  accent: string;
  landmarkSprite: string;
};
```

---

## 4. Authored level names

Use names as display copy only; level numbers remain available for orientation.
Generated names should be deterministic from the level number.

### Name bank

```ts
const LEVEL_NAME_BANK = [
  'The Golden Skillet',
  'A Pinch of Patience',
  'Late Harvest',
  'The Big Pantry Sweep',
  'Slow Simmer',
  'Fresh from the Garden',
  'The Wooden Spoon',
  'A Little Extra Basil',
  'Sunday at the Stove',
  'The Cozy Counter',
  'Market Morning',
  'The Full Recipe Box',
];
```

Rules:

- Never hide the numeric level identifier.
- Do not imply a time limit or urgency.
- Avoid repeating the same name within the visible level-map viewport.
- Hand-built milestone names should override generated names.

---

## 5. Board surface backdrop

Add a quiet physical surface behind the board to connect play to the kitchen world.
This is a background treatment, not a new interactive layer.

### Preferred asset

Filename: `board_surface_kitchen.webp`

Suggested source size: `1440 × 2560` portrait, or a seamless `1024 × 1024` tile.

Visual direction:

- pale honey wood or warm parchment surface;
- very low contrast grain;
- faint linen or gingham corner detail only if it does not compete with tiles;
- no sharp object crossing behind the board;
- no text, characters, food pieces, or high-contrast props;
- keep the central board region quiet for readability.

Recommended overlay treatment:

- 8–14% opacity behind the board;
- subtle inner shadow around the board frame;
- preserve the current cream panel color for tiles.

Fallback if a bitmap is not ready: use a low-contrast gradient and border treatment
in code rather than delaying the release.

---

## 6. Recipe annotations

Add one handwritten-style note to selected recipe cards. Keep it to one short line.

```ts
const RECIPE_ANNOTATIONS = [
  'Best served warm.',
  'A little extra basil never hurts.',
  'One of Lala\'s Sunday favorites.',
  'Let this one take its time.',
  'Good bread makes the table happy.',
  'Keep the spoon moving gently.',
  'A bright one for the garden shelf.',
  'This recipe has a story behind it.',
];
```

Use annotations on milestone recipes only. Do not add them to every card or the
collection will become visually noisy.

---

## 7. Milestone vignette art

Optional P1 asset set for major recipe unlocks. These can be static illustrations;
animation is not required.

### Asset list

| Filename | Moment |
| --- | --- |
| `vignette_watering_herbs.webp` | Garden Basket chapter |
| `vignette_opening_pantry.webp` | Pantry Favorites chapter |
| `vignette_pulling_bread.webp` | Bread & Hearth chapter |
| `vignette_setting_table.webp` | Major recipe milestone |

Suggested source size: `900 × 600` landscape, with the subject biased to one side
so copy can sit safely in the opposite side of the card.

Keep the same illustrated Lala character, line quality, and warm daylight as
`home-hero-500h-crop.webp`.

---

## Do not add for this release

- daily streaks;
- timers or urgency copy;
- monetized boosters;
- forced dialogue screens;
- ~~fireworks or full-screen particle effects~~ **revised**: firework-style
  particle bursts for a genuine peak (3-star win, recipe unlock) are in
  scope, confirmed by the architect — see WinCelebrationBurst.tsx. Still
  bounded to the win overlay's own card area, never full-screen;
- a new currency or upgrade economy;
- a large board redesign that reduces tap size.

## Definition of done

- Option B HUD is visible in a real level and survives small-phone layouts.
- Lala copy appears sparingly and never blocks input.
- At least three chapter labels and authored names are visible in progression.
- The board has a quiet kitchen surface or equivalent depth treatment.
- Recipe unlocks contain at least one annotation or contextual line.
- All new assets and copy remain compatible with sound-off and calm-mode play.

