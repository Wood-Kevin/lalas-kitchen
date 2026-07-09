# Dropdown (escort) piece real art — verification

Verifies real illustrated art now replaces the "DR" text-label placeholder
the dropdown (escort) piece has shown since that mechanic first shipped (see
`engine/DECISIONS.md`'s dropdown-ingredients entry and
`docs/verification/dropdown-escort-mechanic/`, which originally captured and
disclosed the "DR" fallback as expected-at-the-time behavior). A real
playtest report of a piece rendering as "DR" text led to investigating
whether this was a regression — it wasn't: no dropdown sprite had ever been
registered, confirmed via `git log --all` on `spriteRegistry.ts` turning up
zero dropdown-related commits.

## The fix

One line in `skins/lalas-kitchen/spriteRegistry.ts`, following the exact
`area_bomb.webp` pattern (`getSpriteForPiece` resolves a dropdown piece to
the literal filename `'dropdown.webp'`, not an extensionless special key like
`color_bomb`):

```ts
'dropdown.webp': require('./sprites/dropdown.webp'),
```

plus the real `dropdown.webp` asset itself, already placed in
`skins/lalas-kitchen/sprites/`. No other code changes anywhere — the same
"one registry line" contract every other un-arted piece in this project has
followed (`color_bomb`, `area_bomb`, `striped_*`, blocker art).

## How this was captured

The Expo web dev server on `localhost:8081`, driven from WSL2 over raw CDP
against headless Windows Chrome (`node_modules/ws`), the same rig every other
verification doc in this project uses.

1. Injected a crafted save directly into `localStorage` (key
   `save:cooking-lalas-kitchen`, matching `engine/gameState.ts`'s
   `SAVE_KEY_NAMESPACE`) with `completedLevels: [1..7]` and every tutorial ID
   pre-marked seen, routing straight to the real hand-built "Delivery Day"
   level (`App.tsx`'s `LEVEL_QUEUE`'s 8th entry, the one with real
   `dropdownPositions`) without navigating through seven levels of actual
   play or any tutorial overlay.
2. Reloaded so `App.tsx` booted from that save, confirmed Home's "Up next"
   card correctly read "Delivery Day", then dispatched a genuine CDP mouse
   click (real mousedown/mouseup) on "Start cooking".
3. `delivery-day-real-basket-art.png` — the real level loaded with the HUD
   reading "⬇ 0/2" (the escort objective, unaffected by this change), and
   both dropdown tiles (top row, columns 2 and 4 — the exact two configured
   `dropdownPositions`) now render a real illustrated woven-basket-with-a-red-ribbon
   sprite, not text.
4. A direct DOM check confirmed this wasn't just visually plausible:
   `document.querySelectorAll('*')` found **zero** leaf elements with
   `textContent.trim() === 'DR'` anywhere on the page, while exactly **two**
   real `<img>` elements had a `src` containing `dropdown.webp` (one per
   configured position), and computed `backgroundImage` on two elements also
   referenced `dropdown.webp` — real registered art rendering through the
   same asset pipeline every other piece uses, not a fluke of the screenshot.

## What was confirmed

- The registry line resolves correctly for a real, live-rendered dropdown
  piece — not just checked in isolation against `spriteMap.ts`'s pure
  function.
- The pre-existing "DR" fallback is completely gone from the real running
  app; zero placeholder text nodes remain.
- The escort objective mechanic itself (HUD count, `dropdownPositions`
  placement) is unaffected — this was purely a presentation-layer fix, no
  engine logic touched.
- Full test suite: 613/613 passing, unaffected. The one existing test that
  exercises the "DR" fallback (`components/spriteMap.test.ts`'s "a dropdown
  piece with no registered art falls back to the text-label placeholder")
  deliberately asserts against a synthetic *empty* asset map, not this
  skin's real registry, so it correctly continues to pass and needed no
  changes — it tests the fallback mechanism's own correctness, not this
  skin's specific art coverage.
