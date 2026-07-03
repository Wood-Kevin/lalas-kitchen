# Phase 5 Verification Screenshots

Captured during Phase 5's headless-Chromium verification pass (before the
viewport-height fix, so lives still render as hearts and the board is
top-aligned rather than centered — see `components/NOTES.md` for what
changed since). Kept as reference for judging future "calm and satisfying"
feel questions, since scratch space doesn't survive past a session.

- **board-initial.png** — Fresh level load: 8x6 placeholder-labeled board, HUD showing Target 0/15, 20 moves, 5 hearts.
- **board-after-tap.png** — One tile selected after a tap (thicker accent border), board otherwise unchanged.
- **board-mid-animation.png** — Mid-cascade: two columns refilling at once — one column's incoming tile is still high enough to render up into the HUD's Target panel (the spawn-behind-HUD issue logged in `DEFERRED_COMPLEXITY.md`), the other's incoming tiles are fading in within the grid.
- **board-settled.png** — Same cascade, fully resolved: all tiles solid, moves decremented to 19.
- **board-paused.png** — "Out of moves!" overlay, pre-fix: centered on the container but visually cuts into the board since the board didn't yet fill the viewport.
- **board-resumed.png** — After tapping "+5 Moves": overlay dismissed, moves back to 5, play resumed.
