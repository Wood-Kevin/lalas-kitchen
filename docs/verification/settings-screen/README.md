# Dedicated settings screen — verification

Verifies `engine/DECISIONS.md`'s "Dedicated settings screen" entry: Home's
inline Sound/Haptics toggle card is replaced by a "Settings" nav card that
opens a new `components/Settings.tsx` screen, where both toggles now live.

## How this was captured

The Expo web dev server on `localhost:8082`, driven from WSL2 over raw CDP
against headless Windows Chrome, using this repo's own `node_modules/ws` —
the same rig as `docs/verification/manual-shuffle/`.

Steps performed, in order:

1. Loaded the app fresh. `home-settings-card.png` — Home shows a "Settings"
   card ("Sound, haptics, and more") in place of the old inline toggle rows;
   the "Your recipe book" card is unaffected.
2. Clicked the real "Settings" card. `settings-screen.png` — the new screen
   renders a back arrow, a "Settings" title, and both Sound/Haptics switches,
   both off (matching the fresh save's defaults), with no further navigation
   needed to reach them.
3. Dispatched a real mouse press+release directly on the Sound `<input
   role="switch">` element's own coordinates (found via
   `getBoundingClientRect()`, not the text label beside it — clicking the
   label alone is inert, same as it always was on Home).
4. Read the real persisted save back from `localStorage` immediately after:
   `JSON.parse(localStorage.getItem('save:cooking-lalas-kitchen')).soundEnabled`
   → `true`. `sound-toggled-on.png` — the switch visually reflects the flip
   (accent-colored track, thumb moved right).
5. Clicked the real back arrow (found by locating the literal `‹` glyph's
   own element, not a guessed coordinate). `back-to-home.png` — returned to
   Home, "Settings" card still present, Lives badge unchanged.
6. Toggled Sound back off (same real-switch-click method) to leave the save
   in its original state; confirmed `soundEnabled: false` in `localStorage`
   afterward.

## What was confirmed

- Home no longer renders the inline Sound/Haptics toggle card — only a
  single "Settings" nav card.
- The Settings screen shows both toggles immediately on entry, no sub-menu —
  preserving the original build-spec's "easy one-tap mute" property even
  though the toggle no longer lives directly on Home.
- A real tap on the Sound switch flips it and `saveProgress` immediately
  persists the change to `localStorage` — the same persistence path
  `handleToggleSound`/`handleToggleHaptics` always used, now called from a
  different screen.
- Back navigation returns to Home with no state loss.

## Where the logic lives

- `components/Settings.tsx` — new screen component.
- `components/Home.tsx` — inline toggle card removed; replaced with a single
  `onOpenSettings` nav card.
- `App.tsx` — new `'settings'` screen state, `handleOpenSettings`, render
  branch. `handleToggleSound`/`handleToggleHaptics` themselves are unchanged.

No React component-test harness exists in this project (see CLAUDE.md's
Testing Philosophy), so this is verified live only. No engine-level logic
changed; full suite unchanged at 552 tests passing.
