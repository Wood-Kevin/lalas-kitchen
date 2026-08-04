# Swap-anchor — every swap-triggered LOCAL effect fires where the player aimed it

Verifies the fix for a real playtest report — *"when I move the area bomb to the
right the explosion seems like it all goes to the left instead of staying
centered"* — which turned out to be a **pattern across four effects**, not one
bug. See `engine/DECISIONS.md`'s swap-anchor entry for the reasoning and the
alternatives not taken.

Two independent layers were verified, because they fail independently and a
passing test proves neither on its own:

1. **The engine's clear geometry** — via a throwaway probe driving the **real
   `applyMove`** and dumping the cells that genuinely cleared.
2. **The presentation layer** — via **CDP against the real running app**, with a
   real drag gesture, tracking the real `area_bomb.webp` sprite frame by frame.

---

## 1 · Engine geometry, before and after (real `applyMove`)

A 7x7 board of all-distinct `matchType`s (so nothing matches by accident and
every cleared cell is the effect's own footprint). `#` = cleared, `[X]` = the two
swapped cells. Every case was run **both drag directions** over the same physical
setup.

### Solo area bomb — the reported symptom

```
BEFORE THE FIX                      AFTER THE FIX
drag bomb RIGHT (3,3)->(3,4)        drag bomb RIGHT (3,3)->(3,4)
 .  .  #  #  #  .  .                 .  .  .  #  #  #  .
 .  .  # [A][o] .  .                 .  .  . [A][o] #  .
 .  .  #  #  #  .  .                 .  .  .  #  #  #  .
   cols 2-4, aimed at col 4            cols 3-5, centred on col 4
```

The blast was nailed to the bomb's resting cell and ignored the gesture
entirely — dragging the bomb right, and dragging an ordinary piece left onto it,
produced a **byte-identical** clear. After the fix both still produce the same
clear, but now *for the right reason*: in both cases the bomb genuinely ends up
on the same cell, and the blast follows it there.

### Striped + striped cross — the same pair cleared differently by tap order

```
BEFORE — drag LEFT right    BEFORE — drag RIGHT left
 .  .  .  #  .  .  .         .  .  .  .  #  .  .
 #  #  # [L][R] #  #         #  #  # [L][R] #  #
 .  .  .  #  .  .  .         .  .  .  .  #  .  .
   vertical arm on col 3       vertical arm on col 4
   (the cell being VACATED in both cases)

AFTER  — drag LEFT right    AFTER  — drag RIGHT left
 .  .  .  .  #  .  .         .  .  .  #  .  .  .
 #  #  # [L][R] #  #         #  #  # [L][R] #  #
 .  .  .  .  #  .  .         .  .  .  #  .  .  .
   arm on col 4 (aimed)        arm on col 3 (aimed)
```

The arm now follows the gesture instead of contradicting it.

### Area + area 5x5 — same tap-order dependency, over 25 cells

```
BEFORE — drag LEFT right    AFTER — drag LEFT right
 .  #  #  #  #  #  .         .  .  #  #  #  #  #
 .  #  # [L][R] #  .         .  .  # [L][R] #  #
 .  #  #  #  #  #  .         .  .  #  #  #  #  #
   centred col 3 (vacated)     centred col 4 (aimed)
```

### Area + striped — documented as "a plus," but it wasn't one

```
BEFORE                       AFTER
 .  .  .  .  #  .  .          .  .  .  .  #  .  .
 .  .  #  #  #  .  .          .  .  .  #  #  #  .
 .  .  # [A][S] .  .          .  .  . [A][S] #  .
 .  .  #  #  #  .  .          .  .  .  #  #  #  .
 .  .  .  .  #  .  .          .  .  .  .  #  .  .
 line down the block's EDGE    line through the block's MIDDLE
 (an asymmetric offset union)  (a genuine centred plus)
```

### Control — the path that was already correct

The **in-match striped sweep** runs on the ordinary `swapPieces` path, so a
striped piece dragged into a run already swept the line it *landed* on. Identical
before and after — the game already contained the right behaviour; the four
swap-triggered branches were the outliers.

```
[S][o] .  .  .  .  .     swept col 1 (the destination), unchanged by this fix
 .  #  .  .  .  .  .
```

Also confirmed **unchanged and correct**: `resolveColorBomb`,
`resolveStripedBombCombo`, `resolveAreaColorCombo` — their clear sets genuinely
don't depend on position, which is why the original "the swap is cosmetically
irrelevant" shortcut was sound *for them* before it was inherited by effects
where it isn't.

---

## 2 · Presentation layer, live over CDP

Run against the real app (`npx expo start --web`) with a **real drag gesture**
dispatched at real on-screen tile coordinates. A temporary board-override hook
seeded a hand-built board (a diagonal Latin square of the four ingredients level
1 renders — **no run and no 2x2 anywhere**, asserted by the settled result, so
the only thing that can clear is the effect itself). The hook was **removed
before commit**; a repo-wide grep for it returns nothing.

This layer needed its own fix: the first cascade pass is diffed against the
**pre-move** board, so a cleared piece's `from` is its *pre-swap* cell. Fixing
the engine alone would have made things visibly worse — the bomb would have slid
back to its origin and exploded there while the blast landed one cell over. See
`components/boardDiff.ts`'s `relocateSwappedClears`.

### Area bomb — frame-by-frame trace of the real `area_bomb.webp` sprite

Bomb seeded at row 3, **col 1**; dragged one cell right. Positions are in grid
columns (1.00 = col 1), sampled every animation frame, logged on change:

```
t=    0ms  col 1.00  row 3.00  scale 1.40     <- at rest on its own cell
t= 3727ms  col 1.22  row 3.00  scale 1.40     <- drag begins, finger-follow
t= 3744ms  col 1.46  row 3.00  scale 1.40
t= 3761ms  col 1.68  row 3.00  scale 1.40
t= 3961ms  col 1.90  row 3.00  scale 1.40
t= 3992ms  col 2.00  row 3.00  scale 1.43     <- ARRIVES at the destination
t= 4027ms  col 2.00  row 3.00  scale 1.41     <- and detonates THERE
t= 4094ms  col 2.00  row 3.00  scale 1.17
t= 4161ms  col 2.00  row 3.00  scale 0.64
t= 4227ms  col 2.00  row 3.00  scale 0.18
t= 4278ms  col 2.00  row 3.00  scale 0.02
t= 4302ms  (bomb sprite gone)
```

**The decisive line is the absence of one**: the sprite never returns to col
1.00. It travels 1.00 -> 2.00, holds col 2.00 for the whole shrink-and-vanish
exit, then disappears. That retreat-to-origin is precisely what made the
explosion read as going left.

Resulting board (`#` = cell no longer holds its seeded piece; rows 0-1 differ
because gravity refilled above the cleared block):

```
 .  #  #  #  .        cols 1-3 affected, cols 0 and 4 untouched
 .  #  #  #  .        -> 3x3 centred on col 2, the DESTINATION
 .  #  #  #  .        (the old behaviour would have hit cols 0-2)
 .  #  #  #  .
 .  #  #  #  .
 .  .  .  .  .
 .  .  .  .  .
 .  .  .  .  .
```

`Moves` went 20 -> 19: a genuinely committed move, with no run anywhere on the
board.

### Striped cross — live

Two adjacent striped pieces at (3,1) and (3,2); the **left** one dragged right.

```
 #  .  #  .  #       row 3 cleared entirely, so rows 0-2 all shifted down
 #  #  #  #  #
 #  #  #  #  #
 #  S  S  #  #       S = the two striped cells (always consumed)
 .  .  .  .  .
 .  .  #  .  .       rows 5-7 show the vertical arm at COLUMN 2
 .  .  #  .  .       -> the cross centred on the destination
 .  .  #  .  .       (the old behaviour would show it at column 1)
```

`Moves` 20 -> 19.

---

## What this does NOT cover, disclosed rather than implied

- **Area + area and area + striped were not driven live** — both are verified by
  the real-`applyMove` probe above and by unit tests, and they share the exact
  same `relocateSwappedClears` presentation path the two live cases exercised,
  but no real gesture was dispatched for them.
- **No native device.** Web only, the same standing gap every other feature in
  this repo discloses. The drag/exit animation is Reanimated-driven and could
  behave differently on a real phone.
- **No human has played this.** The traces prove the geometry and the motion;
  whether the corrected blast *feels* right in normal play is a real-playtest
  question this capture can't answer.
- The three area+special combos still animate with the generic sweep rather than
  their own `SpecialEffectDescriptor` identity — unchanged by this work, see
  `DEFERRED_COMPLEXITY.md`.

## Where the logic and tests live

- `engine/gameState.ts` — `applyMove`'s anchor-rule comment and the four
  branches that now stage the swap; `resolveAreaBomb`, `resolveStripedCross`,
  `resolveAreaStripedCombo`, `resolveAreaAreaCombo`; `ApplyMoveResult.swapCommitted`.
- `components/boardDiff.ts` — `relocateSwappedClears`.
- `components/specialEffectAnimation.ts` — the `striped_cross` origin, moved to
  posB in lockstep with the engine.
- `engine/gameState.test.ts` — the swap-anchor block, which drives each setup
  from **both** drag directions and asserts a mirrored result (the shape of
  assertion that would have caught this; a single-direction test could not).
- `components/boardDiff.test.ts` — `relocateSwappedClears` unit tests.
