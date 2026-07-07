# Real fonts + real hero gradient — verification

Closes the two font/gradient entries in `DEFERRED_COMPLEXITY.md` (font
loading, hero fade approximation). Both were reversible follow-ups noted
during earlier Home/Level Map sessions: text was rendered in the system
default font standing in for Baloo 2/Nunito Sans, and the hero's fade into
the screen background was five stacked opacity bands standing in for a real
CSS gradient.

## What changed

- `components/fonts.ts` — `useAppFonts()` loads exactly the three font files
  this skin's styles actually use (`Baloo2_700Bold`, `NunitoSans_400Regular`,
  `NunitoSans_700Bold`) via the first-party `@expo-google-fonts/baloo-2` and
  `@expo-google-fonts/nunito-sans` packages; `App.tsx` gates the existing
  `screen === 'loading'` splash on `fontsLoaded` the same way it already
  gates on the save-data load.
- `components/Home.tsx` / `components/LevelMap.tsx` — every heading style
  (title, card titles, level names, button labels, level-medallion numbers)
  now sets `fontFamily: Fonts.headingBold`; every body style (welcome text,
  progress lines, footer, status line) sets `Fonts.bodyRegular`; a few small
  bold labels that the mockup keeps in Nunito Sans rather than Baloo 2
  (`UP NEXT · LEVEL N`, `Browse all levels`, the `LEVEL N` caption pill,
  `PLAY`) use `Fonts.bodyBold`. Existing `fontSize`/`fontWeight` numbers were
  left untouched — `DEFERRED_COMPLEXITY.md`'s own entry already documented
  these as matching the mockup's weight/size choices, just rendered in the
  wrong font family; this session only swaps the family in, it doesn't
  re-derive sizes from the original (differently-sized) HTML mockup. Pure
  icon/glyph text (the back arrow, checkmark, lock, star, "×" markers) is
  left on the system font, since these aren't prose.
- `components/Home.tsx`'s hero fade is now a real `expo-linear-gradient`
  `LinearGradient` spanning the full hero height, with stops matching the
  mockup's actual CSS (`rgba(bg,0)` to 55%, `rgba(bg,0.85)` at 85%, solid at
  100%) via this codebase's existing hex+alpha color convention
  (`${bg}00`/`${bg}D9`/`${bg}FF`).

## How it was captured

Real running app, not a static mock: the project's already-running Metro web
server (`expo start --web`, port 8081) was driven from WSL2 via a headless
Windows Chrome instance over CDP (the established rig — see this session's
`screenshot-verification-in-wsl` memory note), since Puppeteer/Playwright
Chromium don't launch in this WSL2 environment.

1. Opened a new CDP target at `http://localhost:8081/`, forced a
   430×1400 mobile viewport via `Emulation.setDeviceMetricsOverride` (headless
   Chrome's `--window-size` flag doesn't reliably apply to tabs opened via
   `/json/new`), and polled `document.body.innerText` until real Home content
   ("Start cooking") rendered.
2. Captured `home-screen.png`.
3. Found the real "Browse all levels" `Pressable` DOM node (walking up from
   its text node to the ancestor carrying react-native-web's
   `r-cursor-*` pressable class) and dispatched a real
   `Input.dispatchMouseEvent` press+release at its actual on-screen
   coordinates — not a direct `setState`/navigation call.
4. Polled until the real Level Map screen rendered, then captured
   `level-map.png`.

## What the screenshots show

- **`home-screen.png`** — "Lala's Kitchen", "Your recipe book", "Sound",
  "Haptics", "Score Rush" (the real next-level name), and "Start cooking" all
  render in Baloo 2's rounded display face. The welcome quote, recipe count,
  "UP NEXT · LEVEL 5" label, "Browse all levels", and the footer render in
  Nunito Sans. The hero's fade from the photo into the tan background is a
  smooth continuous gradient with no visible discrete steps — the banding the
  old 5-band approximation showed is gone.
- **`level-map.png`** — "Level Map" and every level-medallion number (2, 3,
  4, 5) render in Baloo 2; "4 cooked · pick up wherever you like", the
  "LEVEL 5" caption pill, and "PLAY" render in Nunito Sans.

## Test suite

`npm test` — all 26 suites / 494 tests pass, unchanged (this project has no
React component-test infra, so Home/LevelMap's own rendering was never
covered by the suite; the font/gradient changes don't touch anything the
existing engine/service tests exercise).
