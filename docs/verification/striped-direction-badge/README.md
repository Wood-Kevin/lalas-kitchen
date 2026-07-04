# Striped-piece direction badge — verification

`direction-badge.png` — captured via the same headless-Chromium + Expo-web
pass phase-5 used, but against a throwaway harness that renders the real
`components/Tile` for each of the four cases the change must cover (the live
board rarely holds all four striped pieces at once, so a harness is the
reliable way to see them side by side). The harness itself was temporary and
is not in the repo.

Reads left to right:

- **row · art (tomato)** — striped tomato art, top-right badge shows the
  horizontal `↔` (this piece sweeps its whole row when matched).
- **col · art (lemon)** — striped lemon art, badge shows the vertical `↕`
  (sweeps its whole column).
- **row · placeholder (herb)** — no dedicated striped art, so the tile shows
  the `ST` text-label fallback; the same horizontal `↔` badge renders
  identically over it.
- **col · placeholder (spoon)** — text-label fallback with the vertical `↕`
  badge.

Confirms the badge reads clearly and differently for row vs. column, and is
independent of whether the tile shows dedicated art or the placeholder — which
is the whole point, since dedicated striped art removed the old full-tile
stripe overlay that used to carry this direction cue. Presentation only: all
182 engine/component tests still pass.
