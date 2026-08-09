# Lala's Kitchen — Special Piece Asset Catalog

The special-piece art is already present in the skin and registered for Metro.
This file is an implementation handoff for Claude; no new special-piece images
are required for the current release pass.

## Existing game-ready assets

All paths are relative to:

`skins/lalas-kitchen/sprites/`

| Mechanic | Asset | Current visual language | Intended use |
| --- | --- | --- | --- |
| Horizontal/vertical striped | `striped_tomato.webp` | Tomato wrapped with two cream bands and small sparkles | Striped tomato piece |
| Horizontal/vertical striped | `striped_lemon.webp` | Lemon wrapped with two cream bands and small sparkles | Striped lemon piece |
| Horizontal/vertical striped | `striped_herb.webp` | Herb wrapped with two cream bands and small sparkles | Striped herb piece |
| Horizontal/vertical striped | `striped_garlic.webp` | Garlic wrapped with two cream bands and small sparkles | Striped garlic piece |
| Horizontal/vertical striped | `striped_chili.webp` | Chili wrapped with two cream bands and small sparkles | Striped chili piece |
| Horizontal/vertical striped | `striped_spoon.webp` | Spoon wrapped with two cream bands and small sparkles | Striped spoon piece |
| Area bomb | `area_bomb.webp` | Tied kitchen bundle with ingredient-colored burst marks | Area-bomb piece |
| Color bomb | `color_bomb.webp` | Glowing magical recipe jar with swirling ingredients | Color-bomb piece |
| Dropdown / escort | `dropdown.webp` | Woven kitchen basket tied with a red ribbon | Escort piece |

## Registry status

All of these are already registered in:

`skins/lalas-kitchen/spriteRegistry.ts`

The current lookup behavior is:

- striped pieces resolve to `striped_<base sprite>`;
- area bombs resolve to `area_bomb.webp`;
- color bombs resolve to the fixed registry key `color_bomb`;
- dropdown pieces resolve to `dropdown.webp`.

The correct lookup logic lives in:

`components/spriteMap.ts`

## Visual review notes

The art is strong enough for release and already fits the ingredient sprite family.
The main remaining opportunity is effect presentation, not replacement art:

- use a soft turquoise wash for striped sweeps;
- use deep blue or navy for area-bomb blasts;
- use violet/gold for color-bomb detonation;
- use warm amber for blocker hits;
- reserve deep wine/magenta for supercombos.

Keep the resting sprites unchanged. Apply these colors only to the momentary
activation/clear animation so the board remains calm and readable.

## Claude implementation checklist

- Do not recreate or replace these image files.
- Confirm all nine assets render on the board, not text fallbacks.
- Confirm striped direction remains readable through the existing direction badge.
- Confirm special-effect color comes from `config.palette.effectColors` rather than
  the single default accent color.
- Test the assets at the smallest supported tile size.
- Keep the special art inside the tile footprint; no effect should reduce tap area.

## Optional future additions

These are not release blockers:

- a separate horizontal/vertical striped variant if the direction badge is ever
  removed;
- a small activated-state frame for each special type;
- a dedicated supercombo sprite if the mechanic becomes a major progression beat.

