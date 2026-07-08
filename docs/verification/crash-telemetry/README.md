# In-app crash log — verification

Verifies `engine/DECISIONS.md`'s "In-app crash log" entry: a real, uncaught
render crash is caught by the existing `ErrorBoundary`, persisted into the
real save as `SaveData.lastCrash` via `engine/gameState.ts`'s `recordCrash`,
and calmly surfaced later on `components/Settings.tsx`.

## How this was captured

The Expo web dev server on `localhost:8082`, driven from WSL2 over raw CDP
against headless Windows Chrome, using this repo's own `node_modules/ws` —
the same rig as the other verification docs in this session.

A temporary harness gate was added to `components/Home.tsx` for this capture
only, and removed immediately after (this project's established "temporary
gate, reverted after" convention):

```ts
if (typeof window !== 'undefined' && window.location.search.includes('forceCrash')) {
  throw new Error('Verification: forced crash for crash-telemetry test');
}
```

Steps performed, in order:

1. Loaded `http://127.0.0.1:8082/?forceCrash=1`. `crash-fallback.png` — the
   real `ErrorBoundary` fallback rendered ("Something went wrong" / "Start
   Fresh"), confirming the forced throw was actually caught, not just
   logged-and-crashed-anyway.
2. Read the real save straight from `localStorage` immediately after:
   `lastCrash` was present with a genuine `message` ("Verification: forced
   crash for crash-telemetry test"), a genuine multi-frame `stack` (the real
   V8 stack trace through `Home`/`renderWithHooks`/etc., with the React
   component stack folded in — `at Home`, `at ErrorBoundary`, `at AppRoot`),
   and a real `timestamp`. Every pre-existing field in the save
   (`skinId`, `lives`, `completedLevels`, `seenTutorials`, etc.) was
   untouched — confirming `recordCrash`'s patch-in-place behavior, not a
   full save rebuild that could have dropped them.
3. Reloaded `http://127.0.0.1:8082/` (no crash param). `home-after-revert.png`
   — Home rendered normally; the harness gate was removed from the source
   before this reload, so this also confirms the revert didn't leave the
   throw active.
4. Clicked the real "Settings" card. `settings-with-crash.png` — a new "A
   technical hiccup" card rendered, showing the calm "Safe to ignore" copy
   plus the real recorded timestamp and message in muted text — exactly the
   record written in step 2, now genuinely readable from the UI.

## What was confirmed

- A real render-time crash is caught by `ErrorBoundary` and does not lose
  any existing save data.
- `recordCrash` correctly patches `lastCrash` onto whatever save already
  exists, rather than requiring a full rebuild.
- The crash record survives a full page reload (i.e., it's genuinely
  persisted, not just in-memory).
- `Settings.tsx` renders the crash section only when a crash is actually on
  record, with calm, non-alarming copy.

## Where the logic and tests live

- `engine/gameState.ts` — `CrashRecord`, `SaveData.lastCrash`,
  `isValidCrashRecord`, `recordCrash`. Covered by `engine/gameState.test.ts`'s
  `recordCrash` describe block and a new malformed-`lastCrash` case in the
  existing corrupted-save-fallback describe block.
- `components/errorRecovery.ts` — `describeCrashRecord`. Covered by
  `components/errorRecovery.test.ts`.
- `appPersistence.ts` — `buildSaveData`'s new `lastCrash` passthrough param.
  Covered by `appPersistence.test.ts`'s new describe block.
- `components/ErrorBoundary.tsx` — the new `skinId` prop and the
  `recordCrash` call in `componentDidCatch`. No React component-test harness
  exists in this project (see CLAUDE.md's Testing Philosophy), so this
  wiring is verified live here.
- `components/Settings.tsx` — the conditional crash card.
- `App.tsx` — `lastCrashRef`, threaded through all five `buildSaveData` call
  sites and into `<ErrorBoundary skinId={...}>`/`<Settings lastCrash={...}>`.

Full suite: 561 tests passing.
