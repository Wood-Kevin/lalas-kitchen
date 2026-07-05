# Dev-only reset — verification

A testing convenience (see `engine/DECISIONS.md`'s "Dev-only reset" entry and
CLAUDE.md is unchanged since this is deliberately **not** a player feature): a
hidden, `__DEV__`-gated action that wipes all saved progress and reinitializes
the game fresh from inside the app — no digging through the OS's app-storage
settings.

## How it's tucked away

- **`__DEV__`-gated.** App.tsx passes `onDevReset` to `Home` only when `__DEV__`
  is true, so the feature is compiled out of any release build. A real player
  cannot reach it at all.
- **No-affordance long-press.** In a dev build, the trigger is an 800 ms
  long-press on the Home footer line ("No timers. No rush. The kitchen keeps."),
  which renders as ordinary static text with no press feedback — nothing to
  stumble into. A confirm (`window.confirm` on web / RN `Alert` on device) guards
  an accidental long-press.

## What the images show (a real live trace, not a claim)

Captured by driving the **real Expo-web app over CDP** (`__DEV__` true in the dev
bundle): seed a save into the real `AsyncStorage` key
(`lalas-kitchen:save:cooking-lalas-kitchen`), reload so the real app loads it,
then dispatch the real footer long-press and auto-accept the confirm.

- **`home-before-reset.png`** — the seeded save is loaded: "3 of 9 recipes
  collected", **UP NEXT · LEVEL 4 · Cutting Board** (completed levels 1–3).
- **`home-after-reset.png`** — after the long-press → "[DEV] Reset all saved
  progress?" → accept: the localStorage save key is now `null` and Home is fresh:
  "A fresh recipe book, ready when you are.", **UP NEXT · LEVEL 1 · Tomato Toss**.

The footer looks identical in both shots — the reset affordance is invisible.

The driver's assertions on the live run: save present before (`true`), the
`[DEV] Reset all saved progress?` dialog fired, save present after (`false` /
`null`) → `PASS — save wiped by dev reset`.

## Where the logic and tests live

- `engine/gameState.ts` — `clearSave(skinId, storage)` (deletes the key, so the
  next `loadSave` is `null`); `AsyncStorageLike.removeItem` + its
  `createInMemoryStorage` implementation.
- `App.tsx` — `applyLoadedSave(save)` (the mount-init factored out so the reset
  reuses the exact fresh-install path) and `handleDevReset` (clear → re-init →
  Home), wired to `Home` only under `__DEV__`.
- `components/Home.tsx` — the footer's hidden long-press (`onDevReset`,
  `delayLongPress={800}`), inert when the prop is undefined (release builds).
- Tests: `engine/gameState.test.ts` — `clearSave deletes the save so the next
  load is null again` (round-trip + skin isolation). All 287 engine/component
  tests pass.
