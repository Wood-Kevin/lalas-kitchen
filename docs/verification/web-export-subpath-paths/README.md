# fix-web-export-paths — live subpath verification

`scripts/fix-web-export-paths.js` rewrites root-absolute paths in a real
`expo export -p web` output so the export loads correctly when served from a
subpath instead of a domain root (e.g. CrazyGames, which mounts each game
under its own folder). Verified against a real export, served from a real
subpath, driven by a real browser over CDP — not a curl-only or code-reading
check.

## Before: a real export has the bug

```
rm -rf dist && npx expo export -p web
```

produced a real `dist/` with:

- `index.html`'s script tag: `<script src="/_expo/static/js/web/AppEntry-....js" ...>`
- 29 root-absolute asset paths inside the bundled JS (`"/assets/skins/lalas-kitchen/sprites/....webp`, one per sprite)

## After: `node scripts/fix-web-export-paths.js`

```
fix-web-export-paths: rewrote 1 path(s) in index.html
fix-web-export-paths: rewrote 29 path(s) in _expo/static/js/web/AppEntry-....js
fix-web-export-paths: done — 30 root-absolute path(s) rewritten to relative across 2 file(s) checked.
```

Re-grepping the JS bundle afterward found zero remaining root-absolute
quoted paths, while react-native-web's hydration marker (`"/$`) and a
bundled comment-formatter's block-comment marker (`"/*`) both survived
untouched — confirming the regex's context-based safety claim against the
real bundle, not just the fixture strings in `fix-web-export-paths.test.js`.

## Live subpath serving (the actual bug this fixes)

Copied the rewritten `dist/` into a static webroot **one level below server
root** — `webroot/game/` (not `webroot/`) — and served `webroot/` with
`python3 -m http.server`, so the export is only reachable at
`http://localhost:8899/game/`, exactly the "mounted under its own folder"
scenario the fix targets. Confirmed the *bug* first: a request for the
export's JS bundle at the **root-absolute** path it would have used before
the fix —

```
curl http://localhost:8899/_expo/static/js/web/AppEntry-....js → 404
```

— 404s, since the file only exists under `/game/`. That 404 is exactly what
every real-browser request would have hit before this fix, on any subpath
deployment.

Then drove a real headless Chrome (over CDP, per this project's established
WSL2 verification approach — Windows `chrome.exe` with
`--remote-debugging-port`, profile directory on a native Windows path since
a `\\wsl.localhost` UNC profile path crashes Chrome's sandbox) to actually
load `http://localhost:8899/game/` and captured every network request the
page made via `Network.responseReceived`:

```
200 http://localhost:8899/game/
200 http://localhost:8899/game/_expo/static/js/web/AppEntry-....js
200 http://localhost:8899/game/assets/skins/lalas-kitchen/sprites/tomato....webp
200 http://localhost:8899/game/assets/skins/lalas-kitchen/sprites/home-hero-....webp
404 http://localhost:8899/favicon.ico
```

Every request the app itself made — the HTML, the JS bundle, both sprite
assets it loaded on the initial screen — resolved under `/game/` with a real
200. The one 404 (`/favicon.ico`, at the domain root) is the browser's own
automatic favicon probe, unrelated to the export and not a path the app
requests. `document.title` read back as `"Lala's Kitchen"` and `#root`'s
rendered HTML was 44,534 characters — the real app mounted and rendered
under the subpath, not a blank page.

## What this confirms

- A real `expo export -p web` output does contain root-absolute paths that
  break under a subpath, confirmed by both a direct grep and a live 404
  against the unrewritten path.
- `fix-web-export-paths.js` rewrites all of them (30/30 in this real
  export), verified by re-grepping the actual rewritten bundle, not a
  synthetic fixture.
- The two path shapes the script's own safety claim depends on — the
  react-native-web hydration marker and a comment-formatter's block-comment
  marker — are confirmed untouched in the real bundle.
- Serving the rewritten export from a real subpath one level below server
  root, driven by a real browser, produces zero failed requests for
  anything the app actually loads.

`scripts/fix-web-export-paths.test.js` covers the rewrite regex itself at
the unit level (hydration marker, comment marker, multi-path counting,
already-relative and non-root-absolute URLs left untouched) so this
contract has fast, deterministic regression coverage going forward; this
live pass is to confirm the *actual exported bundle and subpath serving*,
the same standard every other feature in this project gets.
