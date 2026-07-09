# Privacy Policy link on Settings — verification

Verifies `engine/DECISIONS.md`'s Privacy Policy entry: a new "Privacy Policy"
row on `components/Settings.tsx`, styled as its own card matching the
existing Sound/Haptics card, opening `https://lalas-kitchen.vercel.app/` in
the device's default browser (`Linking.openURL`) — never an in-app webview.

## How this was captured

The Expo web dev server on `localhost:8081`, driven from WSL2 over raw CDP
against headless Windows Chrome (`node_modules/ws`), the same rig prior
sessions in this repo already established (see `docs/verification/settings-screen/`).

Steps performed, in order, against the real running app:

1. Loaded the app fresh, clicked the real "Settings" card on Home via a
   genuine CDP-dispatched mouse click (not a synthetic DOM `.click()`).
2. `settings-screen-with-privacy-link.png` — the Settings screen renders
   Sound, Haptics, and the new "Privacy Policy" row as its own card directly
   below, right-aligned with a muted "›" disclosure arrow in place of a
   Switch, using the exact same card background/border/corner-radius and row
   title typography as the Sound/Haptics card above it. The screen's own
   `document.body.innerText` at this point read exactly:
   ```
   ‹
   Settings
   Sound
   Haptics
   Privacy Policy
   ›
   ```
3. Before the tap, `window.open` was overridden in-page to record its calls
   instead of actually navigating, so the real click could be observed
   without leaving the harness. A genuine CDP-dispatched mouse click on the
   "Privacy Policy" row (real mousedown/mouseup at the row's own
   `getBoundingClientRect()` center, not a synthetic event) triggered exactly
   one `window.open` call, with the argument:
   ```json
   ["https://lalas-kitchen.vercel.app/"]
   ```
   confirming `Linking.openURL` resolves to the correct, real production URL
   on tap — react-native-web's own `Linking.openURL` implementation is
   `window.open(url)`, the web-platform equivalent of "hand off to the
   system browser" a real iOS/Android device would perform natively.

## What this does and doesn't confirm

Confirmed: the row exists, is visually consistent with the rest of the
screen, and tapping it resolves to the exact real Privacy Policy URL with no
demo/placeholder value anywhere. **Not confirmed, and not confirmable in this
environment**: that a real iOS/Android device's OS-level `Linking.openURL`
call actually launches the system default browser app to that URL — the same
standing native-only verification gap every other native-facing feature in
this project carries (see `engine/DECISIONS.md`). Full test suite: 613/613
passing, unaffected (this file has never been test-reachable).
