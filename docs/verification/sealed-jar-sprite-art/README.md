# sealed_jar blocker real art — verification

Verifies real illustrated art now replaces the "SE" text-label placeholder
the `sealed_jar` blocker (the `specialOnly` variant from the blocker-depth
feature — see `engine/DECISIONS.md`'s blocker-depth entry) has shown since
that feature first shipped. A real playtest report of a piece rendering as
"SE" text led to investigating whether this was a regression — it wasn't:
`config.json` declared `"sprite": "sealed_jar.webp"` from the start, but the
asset and its `spriteRegistry.ts` line were never created, confirmed via
`git log --all -p -S "sealed_jar" -- skins/lalas-kitchen/spriteRegistry.ts`
returning nothing at any point in history. The gap was disclosed at the
time — `engine/DECISIONS.md` and `docs/verification/blocker-depth/` both
name the "SE" placeholder directly — but, like dropdown's equivalent gap,
was never promoted into `DEFERRED_COMPLEXITY.md`'s itemized list.

## The fix

One line in `skins/lalas-kitchen/spriteRegistry.ts`, following the exact
same filename-keyed pattern as the other three blockers (`cling.webp`,
`dish_stack.webp`, `pot_lid.webp`):

```ts
'sealed_jar.webp': require('./sprites/sealed_jar.webp'),
```

plus the real `sealed_jar.webp` asset itself, already placed in
`skins/lalas-kitchen/sprites/`. No other code changes anywhere.

## How this was captured

The Expo web dev server on `localhost:8081`, driven from WSL2 over raw CDP
against headless Windows Chrome (`node_modules/ws`), the same rig every
other verification doc in this project uses.

1. Injected a crafted save (`completedLevels: [1..19]`, `currentLevel: 20`)
   directly into `localStorage`, routing straight to real generated level 20
   (generated level 12 — `sealed_jar`'s own difficulty gate,
   `appPersistence.ts`'s `BLOCKER_MIN_LEVEL_NUMBER`), the same level the
   original blocker-depth verification session used.
2. Reloaded so `App.tsx` booted from that save, then dispatched a genuine
   CDP mouse click on "Start cooking".
3. `generated-level-20-real-jar-art.png` — the real level loaded and
   rendered **four** real illustrated jar sprites (glass jar, metal lid, red
   seal band) at their generated positions — the same count
   (`docs/verification/blocker-depth/`) confirmed for this exact seed
   originally, now with real art instead of placeholder text.
4. A direct DOM check confirmed this wasn't just visually plausible:
   `document.querySelectorAll('*')` found **zero** leaf elements with
   `textContent.trim() === 'SE'` anywhere on the page, while exactly
   **four** real `<img>` elements had a `src` containing `sealed_jar.webp`
   (matching the four generated blockers), and four elements' computed
   `backgroundImage` also referenced it — real registered art rendering
   through the same asset pipeline every other piece uses.

## What was confirmed

- The registry line resolves correctly for real, live-rendered `sealed_jar`
  blockers on a real generated level — not just checked against
  `spriteMap.ts`'s pure function in isolation.
- The pre-existing "SE" fallback is completely gone from the real running
  app; zero placeholder text nodes remain.
- The blocker-depth mechanic itself (generation gating, `specialOnly`
  damage rules) is unaffected — this was purely a presentation-layer fix,
  no engine logic touched.
- Full test suite: 617/617 passing, unaffected. No existing test asserts
  against this skin's real registry for `sealed_jar` (the engine-level
  generator tests in `appPersistence.test.ts`/`engine/gameState.test.ts`
  only ever check gating/`blockerSpecialOnly` plumbing, never sprite
  resolution), so none needed changes.
