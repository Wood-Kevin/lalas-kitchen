# Publishing an OTA update (EAS Update) — runbook

This is the operational how-to for pushing a JS/asset-only change to production
via `eas update`, on this project's actual Windows + WSL setup. Read
`CLAUDE.md`'s "OTA Updates (EAS Update)" section first for *why* this exists
(runtimeVersion policy, what qualifies as OTA-eligible vs. needs a full native
build). This doc is the *how*, kept separate per "CLAUDE.md points to
source-of-truth docs rather than duplicating them."

## Before you start: does this change even qualify?

Only JS/asset changes can ship this way. Any change that adds a new native
module, changes a native config plugin, or touches `android/`'s or `ios`'s own
build configuration forces a real EAS Build + store resubmission — publishing
those via `eas update` will not do what you want (the installed binary can't
run code it was never compiled with).

## Step 1 — commit the change (Windows checkout)

Normal commit, on `master`, from `C:\Users\kevin\Desktop\claude-projects\lala-refactor`.

## Step 2 — sync into the WSL clone

**Publish from the WSL clone, never the Windows checkout.** `node_modules`
resolves differently on Windows vs. Linux, and `app.json`'s
`runtimeVersion.policy: "fingerprint"` hashes resolved dependency state as
part of the fingerprint — a Windows-resolved fingerprint will not match what
the real (Linux-built) production binaries were fingerprinted with, and
`expo-updates` will silently decline to serve a mismatched update.

The WSL clone lives at `~/lalas-kitchen-build` (WSL distro: `Ubuntu`), and its
`origin` remote points at the **Windows checkout's local path**
(`/mnt/c/Users/kevin/Desktop/claude-projects/lala-refactor`), not GitHub
directly:

```bash
wsl -d Ubuntu -- bash -lc 'cd ~/lalas-kitchen-build && git pull origin master'
```

If the WSL clone has its own pre-existing local edits in the way (check
`git status` first — there was a stray uncommitted `android/`
`AndroidManifest.xml` edit sitting there for a while, see the fingerprint gotcha
below), stash them first with a clearly-labeled message, pull, and pop them
back after — don't discard them blind.

## Step 3 — use the real Linux Node toolchain, not Windows-via-interop

**This WSL distro has no working Node on `PATH` by default.**
`/usr/local/bin/node` and `/usr/local/bin/npx` are dangling symlinks pointing
at `~/.hermes/node/bin/node` — a portable toolchain from an earlier local
Android build session that no longer exists. Without a Linux `node` resolvable,
WSL's automatic interop silently falls through to the **Windows-side**
`npx.cmd` (from `/mnt/c/Program Files/nodejs`), which then tries to spawn
`cmd.exe` against a UNC working-directory path and fails immediately with:

```
CMD.EXE was started with the above path as the current directory.
UNC paths are not supported.  Defaulting to Windows directory.
```

The fix is a real, working Linux Node 22 install already present at
`~/node22/bin` — just never wired onto `PATH`. Prepend it explicitly for
every command in this workflow (this session didn't make it permanent via
`~/.bashrc`; consider doing so if this keeps coming up):

```bash
export PATH="$HOME/node22/bin:$PATH"
node -v   # should print v22.14.0, not error
```

## Step 4 — verify the Android fingerprint BEFORE trusting a publish

**This is the step that was skipped the night this got stuck, and the one
that actually matters.** A successful `eas update` output (`✔ Published!`)
is not evidence the update will reach a real device — only a matching
fingerprint is. Compare against the most recent real Android build:

```bash
cd ~/lalas-kitchen-build
npx eas-cli@latest build:list --platform android --limit 1 --non-interactive --json
# note the build's "id" field, then:
npx eas-cli@latest fingerprint:compare --build-id <that-id> --non-interactive
```

If it reports a match, proceed. **If it reports a mismatch, do not publish
yet** — find out why first. The one root cause found and fixed so far (see
`engine/DECISIONS.md`'s "Android OTA fingerprint mismatch" entry): **a
comment-only, functionally-inert edit to any file under `android/` can shift
the computed fingerprint away from what the real cloud build used**, even
though `git status`/`git diff` show nothing alarming (the drift is in how the
fingerprint tool treats the file's raw bytes, not in repo state). This is not
limited to comments specifically — any raw-byte change to a checked-in
`android/` file is now suspect until proven otherwise by this same compare
step. (iOS never has this problem on this project: there's no checked-in
`ios/` folder, so its fingerprint is computed only from `app.json`/
`package.json`, never from raw native source files.)

If you do hit a mismatch and can't find an inert-edit cause, don't guess —
this is exactly the kind of genuine fork ("what changed the fingerprint, and
is it safe to just match it vs. does it reflect a real native change that
needs a new build") that should be confirmed with Kevin rather than resolved
silently either direction.

## Step 5 — publish

```bash
cd ~/lalas-kitchen-build
npx eas-cli@latest update --branch production \
  --message "<clear summary of the change>" \
  --platform <ios|android|all> \
  --non-interactive
```

Scope `--platform` to just the platform(s) that actually changed and were
re-verified — don't republish a platform that already matched and wasn't
touched, it just clutters the update history with a redundant identical
bundle.

`--non-interactive` note: pass it as a CLI flag, not `$CI=1` — the CLI
sometimes warns `--non-interactive is not supported, use $CI=1 instead` but
the flag still works.

## Step 6 — verify on a real device (the actual signal, not the CLI exit code)

`expo-updates`' default behavior is silent and non-interrupting by design:
check for an update on cold start, apply on the **next** launch. To confirm a
push actually landed:

1. Force-close the app.
2. Reopen it once (fetches the update in the background — you won't see
   anything different yet).
3. Fully close and reopen a second time — this launch should be running the
   new bundle.

## Step 7 — push the commit to GitHub

The WSL clone's `origin` is the local Windows checkout, not GitHub — syncing
into WSL and publishing does **not** push anything to the real remote. Do
that separately from the Windows checkout:

```bash
git push origin master
```

Skip this if you're intentionally keeping the change local for now, but don't
assume a successful OTA publish means the commit is backed up anywhere but
locally.
