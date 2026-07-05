# components/ — Rendering Decisions

Choices made building the presentation layer that are about *rendering*,
not about the engine's shape — see `engine/DECISIONS.md` for engine-side
decisions and API mismatches this phase surfaced.

## App shell scaffolding (not part of the original Board.tsx plan)

CLAUDE.md's build spec calls for "React Native + Reanimated" but the repo
had no app shell at all before this session — no `react`, `react-native`,
`react-native-reanimated`, no entry point, no native or web config of any
kind. None of that was in `lalas-kitchen-build-spec.md`'s Phase 5
description, which only asks for `components/Board.tsx` and friends.
Getting anything on screen at all required standing up a minimal runnable
app first. That work is listed separately here so it's easy to tell apart
from the actual Phase 5 deliverable below.

**What got added, and why Expo specifically:** asked the user to choose
between Expo, bare React Native CLI, or no runnable shell at all (component
code only). This sandbox has no Xcode/Android SDK either way, so a real
device/simulator run was off the table regardless of choice — the decision
was really about your future workflow. Picked Expo on your confirmation,
since Expo Go lets you test on your own phone later by scanning a QR code,
with no native build step.

Concretely, this session added:
- **New dependencies** (`package.json`): `expo`, `react`, `react-dom`,
  `react-native`, `react-native-web` (installed via plain `npm install`),
  plus `react-native-reanimated` and `react-native-safe-area-context`
  (installed via `npx expo install`, which pins versions compatible with
  the installed Expo SDK). `@types/react` added as a dev dependency for
  JSX type-checking.
- **`app.json`** — minimal Expo config (app name, slug, web bundler set to
  Metro).
- **`babel.config.js`** — `babel-preset-expo` plus the
  `react-native-reanimated/plugin` (must be listed last per Reanimated's
  own setup requirement).
- **`App.tsx`** (repo root) — the actual host entry point Expo's
  `AppEntry.js` loads by convention. Builds a `LevelConfig` from
  `skins/lalas-kitchen/config.json` and renders `<Board>`. This file exists
  purely to make `Board.tsx` mountable and runnable; it isn't itself part
  of the engine/skin/components architecture in CLAUDE.md.
- **`tsconfig.json`** — added `"jsx": "react-native"` and `App.tsx` to
  `include`, so the existing project-wide type-check (`npx tsc --noEmit`)
  covers the new UI code too.
- **`package.json` scripts** — added `start` (`expo start`) and `web`
  (`expo start --web`) for you to actually run this later; verification
  this session used `expo export -p web` plus a locally-served static
  build instead, screenshotted with a headless Chromium (installed via
  `npm install --no-save puppeteer`, then removed — never touched
  `package.json`), since no simulator exists in this environment.

None of this touched `engine/` or `skins/`, and nothing here is Board.tsx
logic — it's the stage Board.tsx performs on.

## Sprite rendering pipeline: static require() registry + label fallback

`skins/lalas-kitchen/sprites/` is still an empty folder, but the real
`<Image>` rendering path is now built (not deferred) — the missing files
are exercised as the pipeline's fallback case, not worked around by
skipping images entirely.

**Why not a plain runtime path lookup:** `config.json`'s `sprite` field
(e.g. `"tomato.webp"`) is just a string, but Metro (Expo's bundler, on both
native and the web target we test against) only resolves `require()` calls
whose argument is a literal string — it flatly cannot `require()` a path
built from a variable at runtime. That rules out something like
`require('../skins/lalas-kitchen/sprites/' + spriteName)` outright; it
would fail to bundle at all, not just at runtime.

**What's built instead:** `skins/lalas-kitchen/spriteRegistry.ts` is a
hand-maintained `SpriteAssetMap` — a `{ filename: require(...) }` object —
one line per real asset file. It lives under `skins/lalas-kitchen/`, not
`components/`, since it's fundamentally skin-specific data (a specific
skin's `require()` calls), the same reasoning that keeps piece names out of
`Board.tsx`. `components/spriteAsset.ts`'s `resolveSpriteAsset(spritePath,
assets)` is the one skin-agnostic function that turns a filename + that map
into either `{ kind: 'image', source }` or `{ kind: 'label', label }` —
falling back to the exact same `spriteLabel()` placeholder as before
whenever the filename isn't in the map (file not dropped in yet, or a
typo). `Tile.tsx`, `Board.tsx`, and `Hud.tsx` only ever call
`resolveSpriteAsset()` and render whichever variant comes back; none of
them know the registry exists, so nothing here fails the leak test — the
registry is the one place allowed to know skin-specific filenames, exactly
like `getSpriteForMatchType` is the one place allowed to treat `matchType`
as meaningful.

**Verified against the web target:** exported via `expo export -p web`,
served statically, and screenshotted headlessly. With the registry empty,
every tile renders its placeholder label, pixel-identical to before this
session (confirmed, not assumed). With one scratch sprite file added and
one registry line added (both reverted afterward — no real art or
committed registry entries came out of that session), Metro bundled it as
a static asset, `<Image>` rendered it via `react-native-web`'s `<img>`
mapping, and only tomato tiles (board + the HUD's Target panel, since it
shares the identical `resolveSpriteAsset` call) switched to the image
while every other piece type kept its label — with zero changes to
`Tile.tsx`, `Board.tsx`, or `Hud.tsx`. That scratch file was `.svg` at the
time, back before the format decision below — the mechanism is identical
for any format Metro treats as a plain asset (`png`, `webp`, `svg`, ...
all live in the same `assetExts` list, see `getDefaultConfig().resolver`),
since neither `spriteAsset.ts` nor `spriteRegistry.ts` branch on extension
at all; they just pass whatever `require()` returns straight to `<Image>`.

**Sprite format: WebP, not SVG.** `config.json` and the flame icon
reference now use `.webp` — decided explicitly to close the native
rendering gap this pipeline originally flagged: React Native's native
`Image` component (iOS/Android) doesn't decode raw SVG the way a browser
does, and would have needed `react-native-svg` plus a Metro SVG transformer
just to rasterize vector art, none of which this project has installed.
WebP avoids that dependency entirely — it's a normal raster format Metro
and native `Image` already handle out of the box — while still compressing
better than PNG for the same visual quality. This closes the gap outright
rather than deferring it further; the corresponding `DEFERRED_COMPLEXITY.md`
entry has been removed, not just reworded, since there's nothing left
pending on it.

**The actual file-drop workflow, going forward:** drop `tomato.webp` into
`skins/lalas-kitchen/sprites/`, then add one line to
`skins/lalas-kitchen/spriteRegistry.ts`:
`'tomato.webp': require('./sprites/tomato.webp'),`. That's the only file
that changes. `Tile.tsx`/`Board.tsx`/`Hud.tsx`/`config.json` are untouched,
and every tile of that piece type (plus the HUD if it's the objective's
target or the lives icon) switches from its label to the real image
immediately.

## `cascadeFallSpeed` → milliseconds mapping

`config.animationProfile.cascadeFallSpeed` is a qualitative string
(`'slow' | 'medium' | 'fast'`), not a duration. `cascadeTiming.ts` maps
these to `{ slow: 500, medium: 480, fast: 220 }` — `medium` was retuned up
from its original 350 (and `lalas-kitchen`'s own `matchDurationMs` from 220
to 300 alongside it, in `config.json`) so a cascade chain resolves slowly
enough for a player to actually follow what's clearing and why as a chain
unfolds, rather than reading as a blur. `swapDurationMs` (140) was
deliberately left alone — that duration is a direct response to the
player's own tap, not a passive animation they're just watching, so it
stays snappy. Reads as calm rather than snappy per CLAUDE.md's "calm and
satisfying, not frantic" constraint (a faster, gamier cascade would
undercut that). These specific numbers aren't specified anywhere in the
build spec — a judgment call, easy to retune since every duration flows
through this one function.

## `swapDurationMs` is reserved for the tapped pair; everything else uses cascade timing

A resolved move often moves many pieces at once (the two tapped tiles,
everything that fell during cascades, everything newly spawned), but
`applyMove` only returns the final settled board — there's no per-step
breakdown of "this motion was the swap, this one was a cascade fall" (see
`engine/DECISIONS.md`). Rather than pick one duration arbitrarily for
every moved piece, `Board.tsx` tracks which two piece ids were the ones
the player actually tapped and gives *only those* `swapDurationMs`; every
other moved or spawned piece in the same settle uses
`cascadeFallDurationMs`. This is the one place both distinct duration
values in the config actually get used for what they're named after,
rather than one of them going unused.

## Illegal-move feedback: optimistic swap-and-snap-back, no engine state touched

`applyMove`'s contract returns the *identical* state object (by reference)
for a rejected swap (documented in `engine/DECISIONS.md`). `Board.tsx`
relies on that reference equality (`result.state === gameState`) as its
signal to play a purely visual swap-then-revert using `swapDurationMs`,
without ever calling `setGameState`. This gives the player feedback that
their tap did *something* (rather than silently failing) while staying
completely faithful to the engine's "no move spent, no state change"
contract for illegal moves.

## Bonus grant amounts are placeholders

`pauseActions.ts` hardcodes `+5 moves` / `+1 life` as the bonus amounts a
tap on the pause overlay's button grants. The task explicitly scoped this
as "simple placeholder UI... just functionally correct," and nothing in
CLAUDE.md or the build spec specifies real bonus amounts (that's presumably
tied to whatever rewarded-ad or IAP integration eventually triggers the
grant — out of scope here per CLAUDE.md's explicit list). Kept in one
small pure function so retuning or wiring up a real reward-amount source
later is a one-line change, not a hunt through JSX.

## No "won" overlay this session

Only `paused_awaiting_input` got an explicit visible-state requirement this
phase. Reaching `'won'` currently just stops accepting further taps (since
`Board.tsx`'s tap handler checks `status !== 'in_progress'`) with no
celebratory UI — arguably part of the "recipe box meta layer" that
CLAUDE.md lists as out of scope for V1. Logged to `DEFERRED_COMPLEXITY.md`
rather than built, since it wasn't asked for this session.

## Board sizing: measured layout, not `Dimensions.get('window')`

`tileSize` used to come from `Dimensions.get('window').width` alone, sized
to fit 6 columns, then top-aligned — which left whatever vertical space
wasn't consumed by `rows * tileSize` collapsing to a dead zone below the
board, and (as a direct consequence) made `PausedOverlay`'s full-container
backdrop look like it was cutting into the board rather than centering on
the screen, since the board's own bounds ended well above the container's
true bottom edge.

Fixed by measuring the actual leftover space via `onLayout` on a `flex: 1`
wrapper around the board (`boardArea`), rather than guessing it from raw
screen dimensions minus an assumed HUD height — the HUD's real rendered
height (safe-area insets included) is whatever `onLayout` reports, not a
number this file should hardcode. `tileSize` is then
`min(availableWidth / cols, availableHeight / rows)`, and the grid is
centered (not top-aligned) inside that measured area.

This does not make the board literally edge-to-edge on all four sides:
for an 8-row/6-col grid on a typical tall phone screen, width is the
binding constraint (6 columns is narrower relative to the screen than 8
rows is tall), so there's still vertical slack at max tile size — it's
now split evenly above and below instead of dumped below. Logged in
`DEFERRED_COMPLEXITY.md` since closing that gap needs either non-square
tiles or a different row/col ratio, neither of which was asked for.

## Known cosmetic issue: spawned tiles can render behind the HUD

A freshly spawned tile's entry animation starts at `enterFromRow = landingRow - 2`
so it visibly falls in from above the board (see `Tile.tsx`). For a piece
landing in row 0 or 1, that start position is negative, and the board
container doesn't clip overflow — so for one brief moment (well under
`cascadeFallDurationMs`) the entering tile can render faintly behind the
HUD panels instead of appearing to originate from just off the top edge.
Cosmetic only (confirmed visually in the mid-animation screenshot from this
session's verification pass), not a functional bug. Logged to
`DEFERRED_COMPLEXITY.md` — the fix is either clipping the board container's
overflow or capping `enterFromRow` at 0, deferred since it doesn't affect
correctness and this session's scope was about getting a real, working
interaction loop rather than final animation polish.

## Home.tsx's recipe-book progress had an implied ceiling that doesn't exist

`buildProgressCopy`/`buildProgressDots` used to take a `totalCount` derived
from `resolveVisibleLevelIndices(handBuiltLevelCount, completedLevels).length`
— the hand-built count plus however many generated levels happen to be
completed so far. Since generated levels continue indefinitely, that
"total" isn't a real ceiling at all: it's just today's visible-row count,
which grows by exactly one every time a generated level is completed — so
`completedCount` almost always equals it except for a brief in-progress
moment, making the "X of Y" header, the "Every recipe cooked" copy branch,
and the dot row all claim a false "you've finished everything" state that
silently resets and repeats forever. `buildProgressCopy` now takes only
`completedCount` and reports an open running count ("N recipes cooked so
far") with no denominator and no "fully caught up" branch — there is
nothing to be fully caught up on. `buildProgressDots` was removed outright
rather than reworked: a row of dots is a total by shape (a bounded row
that visually "completes" is the same ceiling as a numeric denominator,
just drawn differently), so there was no version of it that wasn't the
same lie. `handBuiltLevelCount` came out of `HomeProps` entirely — its
only caller was the now-deleted `totalCount` line.

## Striped sweep reads as a travelling glow, not a flat all-at-once wash

A striped piece's row/column clear is an *engine* mechanic — `gameState.ts`'s
`resolveMatchEffects` just adds the whole line to the pass's clear set, so the
presentation layer originally saw those cells as an ordinary batch of clears and
popped them all simultaneously. Live play feedback: that read as a flat wash
appearing and vanishing, never like a beam that actually travelled and did
something. Two other passes at the striped piece hadn't touched this — the
direction badge (a pre-move cue) and the general cascade-pacing slowdown — so the
sweep itself still had no motion of its own.

The fix is entirely presentation-side, no engine change: a matched striped piece
survives into `diffBoards`' `cleared` list still carrying its `type: 'striped'`
and `direction`, so `sweepAnimation.ts`'s `sweepDelaysForClears` treats its
position as the beam origin and gives every other cleared cell on that same
row/column a stagger delay proportional to its distance (in tiles) from the
origin. `Board.tsx` threads that per-tile delay into each `ExitingTile`, whose
sweep branch waits the delay, then brightens-and-swells (a soft accent glow +
slight scale pop), then shrinks away like any cleared tile. Staggering the delays
down the line is what makes the glow read as travelling — each tile reacts at its
own moment rather than the whole line changing at once. The off-axis cells of the
match that *triggered* the striped piece get no delay and clear immediately, so
the trigger pops while the beam runs.

Timing (`cascadeTiming.ts`): `SWEEP_TILE_STAGGER_MS = 55` per tile — the 8-row
board's worst case (an edge-origin column sweep across 7 tiles) travels for
~385ms, deliberately the same unhurried register as the 480ms between-cascade
beat. `SWEEP_GLOW_POP_MS = 110` is the brighten phase, folded into the front of
the normal 300ms pop-and-shrink so a swept tile still takes the normal clear time
*after* the beam reaches it. This is a travel cadence, not a speed-up — per
CLAUDE.md the player wants more visual weight, not more intensity. A blocker
cleared on the swept line keeps its own highlight beat (`isBlockerClear`) rather
than joining the beam. Verified live (real `ExitingTile` under Expo web, frames
captured at several times) in `docs/verification/striped-sweep/`.
