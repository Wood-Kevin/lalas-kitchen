# How-to-play onboarding tutorial — verification

`fresh-save-level1-onboarding.png` verifies the genuine first-time onboarding
tutorial — the calm, once-ever "here's the base mechanic" card shown the very
first time a genuinely fresh save's level 1 loads, before the player has ever
made a move. It's distinct from every other tutorial in this project: the
blocker card and the three special-piece cards (plus `chain_reaction`) all
assume the player already knows how to swap tiles; this is the one that
teaches that mechanic itself.

Captured by driving the **real running Expo-web app** over CDP (per the
established WSL2 screenshot procedure — headless Windows Chrome, not a
synthetic harness), not a mocked component tree:

1. Loaded the real app once, then `localStorage.clear()` — wiping the real
   `lalas-kitchen:save:cooking-lalas-kitchen` key entirely, the same "no save
   has ever existed" state a brand-new install has (not just the dev-only
   reset flow, which presumes a save existed to reset from).
2. Reloaded so the real `App.tsx` boot path (`applyLoadedSave(null)`) ran
   against a genuinely fresh save, landing on Home.
3. Dispatched a real mouse click (CDP `Input.dispatchMouseEvent`, not a
   synthetic `.click()`) on Home's real "Start cooking" button.
4. Captured the real rendered board underneath the overlay.

## What the screenshot shows

`fresh-save-level1-onboarding.png` — level 1 ("Tomato Toss": Target 0/15,
Moves 20, Lives 5 — the real `LEVEL_QUEUE[0]` config) with the real
`SpecialTutorialOverlay` up: headline "Tap and Swap", the exact copy from
`components/SpecialTutorialOverlay.tsx`'s `SPECIAL_TUTORIAL_CONTENT.how_to_play`,
and the "HO" placeholder icon (`spriteLabel('how_to_play')`, since — like
`chain_reaction` — this tutorial has no single piece to anchor an icon to).
The board is visible but dimmed underneath, exactly like every other tutorial
in this family.

## The "shown once ever" guarantee, also verified live

A second run (`after-dismiss-no-repeat-on-relaunch.png`) continued from the
same fresh save:

1. Tapped "Start cooking" on the real app — the overlay was up (`Got it`
   found).
2. Clicked the real "Got it" button. The real persisted save immediately
   showed `"seenTutorials":["how_to_play"]` with `"completedLevels":[]` —
   confirming dismissal is tracked independently of ever winning a level.
3. Fully reloaded the page (a genuine app relaunch, not just a re-render) and
   re-tapped "Start cooking" into the same level 1 again.
4. No "Got it" button was found, and the board rendered immediately
   interactive (Target 0/15, Moves 20, Lives 5, no overlay) — the tutorial
   correctly does not resurface once dismissed, even though `levelIndex === 1`
   and `completedLevels` is still empty on this exact same save.

## Why `completedLevels.length === 0`, not just `levelIndex === 1`

Investigated and confirmed before implementing: a player who already finished
level 1 (or further) and later replays it — from All Levels, or Board's own
"Play again" — would also have `levelIndex === 1`. Gating on `levelIndex`
alone would incorrectly resurface this card for an experienced player who
already knows how to play. `completedLevels.length === 0` is the actual
"genuinely fresh save" signal: it's never empty again once the player has won
anything, so this can never resurface once a save is no longer genuinely
fresh — see `appPersistence.ts`'s `shouldShowOnboardingTutorial` and
`engine/DECISIONS.md`'s "How-to-play onboarding tutorial" entry.

## Where the logic and tests live

- `appPersistence.ts` — `HOW_TO_PLAY_TUTORIAL_ID`, `shouldShowOnboardingTutorial`.
- `components/SpecialTutorialOverlay.tsx` — the `how_to_play` entry in
  `SPECIAL_TUTORIAL_CONTENT` (reused, not a new file — the same component
  already generalized once for `chain_reaction`'s `piece: null` shape).
- `components/Board.tsx` — mount-time `showOnboardingTutorial` state (same
  shape as `showBlockerTutorial`), gates `canAcceptMove`/`dragEnabled`/the
  post-move special-tutorial effect, and renders with top priority over the
  blocker and special-piece overlays.
- `App.tsx` — threads the existing `completedLevels` state through as a new
  `Board` prop.
- Tests: `appPersistence.test.ts`'s `shouldShowOnboardingTutorial` and
  `markTutorialSeen` describe blocks. All 370 tests pass (`npm test`).
