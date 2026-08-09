# SPEC.md — RN-vs-Unity Game-Feel Comparison

<!--
This file is the contract between the architect (me + conversational Claude)
and the runner (Claude Code). The runner implements against this file, not
against chat memory. Drift is defined as code that disagrees with this spec.
If the spec is wrong, change the spec first, then the code. Never the reverse
silently.

Status meanings:
  DRAFT      = still being shaped in conversation, do not implement
  AGREED     = frozen enough to build against
  SUPERSEDED = replaced; link the successor
-->

**Status:** AGREED
**Date agreed:** 2026-08-09 (Kevin: "use your defaults" — resolves the scenario, timebox, audio-source, and Unity-project-path forks; Unity Hub installed same session, editor/license activation left to Kevin per the interactive-login blocker)
**Owner:** Kevin

---

## 1. Problem

**Problem:** A feasibility review of migrating Lala's Kitchen from React
Native/Expo to Unity (see the `unity-migration-exploration` branch's plan
history) concluded that distribution reach (Steam/itch.io) is **not** a
real motivation for this project — the only real driver is closing the
gap between how the game currently feels ("rookie") and how a commercial
match-3 title feels ("polished/professional"). That review could not
settle whether this gap is a genuine **platform ceiling** (RN/Reanimated
structurally can't produce particle systems, shader-driven effects, or
physics-based tile motion the way Unity can) or **unbuilt scope** (the
current implementation ships 3 placeholder synthesized SFX, no particle
system, no screen shake, no combo-escalation visual language, and hasn't
been pushed anywhere near RN's own ceiling yet). Spending months on a
full engine migration before answering that question risks solving the
wrong problem. This build is two small, time-boxed, parallel tracks that
build the *same* representative slice of gameplay twice — once with a
focused RN game-feel investment, once as a throwaway Unity prototype —
so the comparison is evidence, not a guess.

**Lane:** Joy (felt game-quality, and an actual answer to a question
Kevin cares about) — with real career-evidence potential in the
comparison itself: an engine/platform decision made from a controlled,
side-by-side build rather than intuition is an unusually strong,
transferable story.

## 2. Scope

**In scope (this build):**
- A single **fixed comparison scenario**, pinned by default (Kevin: "use
  your defaults"): a 6×6 board, a swap that completes a horizontal
  4-run into a striped piece, which is immediately caught in the same
  move's cascade and fires its row sweep — giving both tracks one real
  cascade pass plus one special-piece trigger to show off, without
  reaching for the most complex case (chains/combos). Captured as a
  shared JSON fixture (`experiments/game-feel-comparison/scenario.json`)
  and used, unmodified, by both tracks, so the only variable between
  them is the juice implementation, not the gameplay moment shown.
- A **timebox**, pinned by default: roughly 3 focused sessions per
  track (RN juice pass; Unity port + juice pass), capped — if a track
  isn't at a capturable state by then, stop and compare whatever exists
  rather than letting either side quietly expand into a full build.
- **Track A (RN):** rebuild that one scenario's presentation with a real
  game-feel investment on the existing stack — a genuine particle/burst
  effect (via `react-native-skia` and/or Lottie/Rive — runner picks at
  implementation time per the existing "naming/library TBD by the
  runner" precedent this project already uses), a deliberate
  combo-escalation or hit-stop treatment, and improved audio for the
  match/cascade/special-trigger beats — sourced by default (Kevin: "use
  your defaults") the same way the existing placeholder SFX were made:
  `scripts/generate-sound-assets.js`-style procedural synthesis, tuned
  for more character than the current placeholders, not a licensed/paid
  asset pack (avoids a purchase decision inside an experiment whose
  outcome is still undecided). Built as a real, reusable slice inside
  the existing `components/`/`engine/` architecture (not a disposable
  demo) so it graduates directly into the game if RN wins the
  comparison.
- **Track B (Unity, throwaway):** a new Unity project at
  `C:\Users\kevin\Desktop\claude-projects\lala-kitchen-unity-prototype`
  (sibling directory to this repo, pinned by default), containing only
  the minimal C# port of `engine/matrix.ts`/`gameState.ts` needed to run
  the one fixed scenario (not a full engine port), plus a Unity-native
  juice pass (particle system, Shader Graph, DOTween or Unity's built-in
  tweening) matching Track A's ambition level. Explicitly disposable —
  may be deleted after the comparison is made. Blocked until Kevin
  completes Unity Hub sign-in and installs an editor version (Unity
  Hub itself was installed this session via winget; the account
  login/license/editor-download steps are GUI-interactive and are
  Kevin's to complete).
- A short **side-by-side capture** (screen recordings of both tracks
  running the identical scenario) and a **written comparison**, judged
  against the open questions already logged in the feasibility plan
  (does Unity's ceiling actually get reached in a way RN structurally
  can't match; is the RN gap closeable with focused investment; what's
  the real effort delta for the ambition shown).

**Explicitly out of scope:**
- A full engine port to C# (only the slice needed for one scenario).
- Any UI/navigation, save/persistence, ads, or store-integration work in
  either track.
- Committing to or executing a migration — this spec covers building the
  comparison only. The actual go/no-go decision is a separate, later
  step once Kevin has seen both tracks.
- Porting or adapting the ~9,000-line test suite for Track B — the
  throwaway C# slice is unverified-by-design; it exists to look and feel
  right, not to be trusted as production logic.
- Any change to Track A's underlying engine logic/scoring/rules — this
  is a presentation-layer investment only, same boundary the project's
  existing "Leak Test" already enforces.

## 3. Architecture decisions

### Decision: Track A's particle burst deliberately overrides the "calm, not frantic" constraint, opt-in only
- **Choice:** `components/Tile.tsx`'s `ExitingTile` carries an explicit
  comment: "deliberately no particle burst or flash, per CLAUDE.md's
  'calm, not frantic' design constraint" — a real, intentional design
  decision for this game's actual audience (Kevin's mom, who plays to
  relax, often with sound off), not an oversight. Track A's particle
  effect overrides this constraint FOR THE COMPARISON ONLY: it ships as
  an additive, opt-in prop (not a default-on behavior change to
  `ExitingTile`), wired ONLY through the dev harness's scenario path.
  Ordinary gameplay's clear/sweep animation is byte-identical to before
  this spec — the calm constraint stays fully intact for every real
  player.
- **Why:** Kevin explicitly chose to see the "louder" end of the
  spectrum for this comparison ("override the constraint for this
  test") rather than silently building within it or silently ignoring
  it — the whole point of the comparison is an honest side-by-side, and
  a version that pulls its punches to respect a constraint neither track
  is actually bound by defeats that. But the constraint is real product
  intent, not a straw man, so nothing here is allowed to change what a
  real player sees by default.
- **Rejected alternative and why:** (a) Building Track A's polish
  entirely within the calm constraint (weightier easing, glow, audio,
  no bursts) — closer to what would actually ship, but wouldn't
  honestly test the "professional genre game" motion language Kevin
  asked to see. (b) Quietly changing `ExitingTile`'s default behavior —
  would silently break a real, documented design decision for
  production players the moment this code merged, which "Scope
  Discipline" and "No silent failures" both rule out.

### Decision: A shared JSON fixture pins the exact comparison scenario
- **Choice:** One JSON file defines the fixed starting board and the
  move played, generated once (from `engine/generator.ts` and/or
  hand-authored for a specific board shape) and treated as ground truth
  for both tracks.
- **Why:** Without an identical starting board and move, "Unity felt
  punchier" vs. "RN felt punchier" isn't a fair claim — pinning the
  input means the only variable across the comparison is the juice
  implementation, not incidental differences in cascade depth or board
  complexity.
- **Rejected alternative and why:** Each track independently picks its
  own "typical" moment — introduces a confound (different visual
  complexity) that would undermine any conclusion drawn from the
  comparison.

### Decision: Track A ships in the real codebase; Track B lives outside this repo
- **Choice:** Track A's game-feel work is built directly inside
  `lala-refactor`'s existing `components:`/`engine:` architecture, so it
  graduates into production with no rework if RN wins. Track B is a new
  Unity project in a sibling directory (not nested inside this repo),
  gitignored for its `Library:`/`Temp:`/`obj:` caches, kept fully
  separate from this repo's git history.
- **Why:** Track A's investment is real production work regardless of
  outcome — no reason to throw it away. Track B is explicitly
  disposable and Unity's generated caches are large binary churn that
  don't belong in a repo optimized for a JS/TS project's history.
- **Rejected alternative and why:** Nesting the Unity project inside
  `lala-refactor` — keeps everything in one place, but risks bloating
  this repo's git history with Unity binary caches and blurs a boundary
  (this repo is the RN game; Unity is a comparison artifact, not a
  sibling implementation of the same game) that's worth keeping clean
  precisely because Track B may be deleted.

### Decision: Track B ports logic only, not tests
- **Choice:** The C# port covers exactly the functions needed to
  reproduce the one fixed scenario's match/cascade/special-trigger
  result, hand-verified against the fixture's expected output — no
  NUnit/Unity Test Framework suite.
- **Why:** Track B's purpose is answering "does this look and feel more
  polished," not "is this a trustworthy engine" — building a real test
  suite for throwaway code is exactly the kind of premature investment
  the prototype-first strategy exists to avoid.
- **Rejected alternative and why:** Porting a slice of the real test
  suite for confidence — would be the right call if Track B were
  headed to production, but that decision hasn't been made yet, which
  is the entire point of doing this comparison first.

## 4. Data model

No database — both tracks are local, client-only prototypes.

| Table | Owned by | Access rule | Enforcement |
|-------|----------|-------------|-------------|
| `experiments/game-feel-comparison/scenario.json` | Shared fixture | Read-only ground truth for both tracks | Generated/hand-authored once; both tracks' scenario setup asserts against it |
| Track A's game-feel components (new, inside `components:`) | Presentation layer | Follows existing skin/engine boundary (Leak Test) | Same convention as existing `components:` code |
| Track B's C# scenario port | Unity project (sibling dir, outside this repo) | Throwaway — not merged into any production system | N/A — explicitly disposable |

## 5. Security posture

**Above the floor:** Nothing new. No network surface, no new backend, no
persistence change. Track B is a local Unity Editor prototype, not
deployed anywhere.

**Floor deferrals (should be empty):** None.

**Adversarial pass scheduled:** No — no attack surface changes.

## 6. Verification plan

| Behavior | Command / probe | Signal that proves it |
|----------|----------------|-----------------------|
| Both tracks run the identical scenario | Diff each track's scenario setup against `scenario.json` | Board state and move match byte-for-byte in both |
| Track A's juice pass runs on the real app | Live capture (screen recording or CDP screenshot sequence) of the scenario playing in the running RN app | Recording exists, shows the new particle/audio/combo treatment firing |
| Track B's juice pass runs in Unity | Live capture (screen recording) of the scenario playing in the Unity Editor or a local build | Recording exists, shows the new particle/shader/tween treatment firing |
| The comparison is evidence-based, not impressionistic | Written comparison doc, scored against the feasibility plan's open questions (ceiling reached vs. investment-closeable vs. effort delta) | Doc exists, references both recordings directly, gives an explicit answer to each open question |
| A decision gets made | This SPEC's change log | A dated entry recording Kevin's actual decision (continue on RN / commit to Unity / inconclusive, try again) once both tracks are seen |
| Ordinary gameplay's calm-not-frantic behavior is unaffected by Track A's particle override | `npx jest` (full suite) plus a live check of a real hand-built level's ordinary match/sweep clear | Full test suite green; a real level's clear animation is visually identical to before this spec (no particle burst outside the dev scenario) |

## 7. Career evidence

- [ ] Side-by-side video/gif of both tracks playing the identical scenario
- [ ] Written comparison narrative: "making an evidence-based engine
      decision instead of guessing" — pairs directly with the existing
      feasibility-analysis plan as a two-part story (analysis → test →
      decision)
- [ ] If Unity is chosen: this spec becomes the seed for a future
      full-migration SPEC.md

## 8. Change log

| Date | Change | Why |
|------|--------|-----|
| 2026-08-09 | Drafted, status DRAFT. Prior `SPEC.md` (HUD reward texture & character redesign) archived, fully AGREED and implemented — a separate, completed initiative, not overwritten. | New, distinct initiative per the spec skill's "do not overwrite an existing spec" rule |
| 2026-08-09 | DRAFT → AGREED. Kevin resolved all four open forks with "use your defaults": scenario pinned (6×6 board, 4-run → striped piece, fires in-cascade), timebox pinned (~3 sessions/track, capped), Track A audio sourced via procedural synthesis (no paid/licensed pack), Track B project path pinned to a sibling directory. Unity Hub installed via `winget install --id Unity.UnityHub` this session; editor download/account sign-in/license activation left to Kevin (GUI-interactive, not automatable). | Kevin's explicit go-ahead; Unity account login cannot be completed non-interactively |
| 2026-08-09 | Shared fixture built and verified (`experiments/game-feel-comparison/scenario.ts` + `scenario.json`, real `applyMove` call, 792/792 tests green). Board.tsx's `initialGameStateOverride` dev seam added, wired to a hidden footer-tap on Home (`__DEV__`-only, mirrors the existing long-press dev-reset pattern). Verified live over CDP: the scripted swap fires the 4-run → striped spawn → in-cascade row sweep exactly as the fixture predicts (score 263). Found `components/Tile.tsx`'s `ExitingTile` carries an explicit "deliberately no particle burst or flash, per CLAUDE.md's calm-not-frantic constraint" comment — added the "Track A's particle burst deliberately overrides..." decision block (section 3) resolving this in Kevin's favor (override for the comparison, opt-in only, ordinary gameplay untouched) after asking directly rather than guessing either way. | Real debugging story (nondeterministic shuffle-rescue root-caused and fixed) plus a real, documented design-constraint conflict surfaced and resolved before writing code that would have silently broken it |
| 2026-08-09 | This branch was discovered to be based on a stale `origin/master` (a second local checkout, `lalas-kitchen/`, had 14 unpushed commits plus uncommitted sprite/asset changes). Kevin committed and pushed that work; this branch was then fast-forwarded onto the real `origin/master` (`017c35a` → `5c36b2d`). That merge brought in a concurrent, unrelated real initiative's own root `SPEC.md` ("Loop Variety, Win-Tier Rewards & Recipe Engagement," AGREED, already implemented on master) — archived unchanged to `docs/specs/SPEC-loop-variety-win-tier-rewards-recipe-engagement-2026-08-09.md` rather than overwritten, and this spec restored as the root file (this branch's own active initiative). Also discovered and removed a duplicate: my own earlier manual archive of the HUD-redesign spec was redundant with the authoritative one that came in from master (`docs/specs/SPEC-hud-reward-texture-and-character-2026-08-08.md`) — deleted mine, kept upstream's. `components/Board.tsx` had a real merge conflict (upstream added substantial new reward/celebration functionality in the same region as this branch's `initialGameStateOverride`/`experimentalJuice` additions) — reconciled by hand, both sides' changes kept, `npx jest` green after. | Kevin's explicit go-ahead to reconcile the two checkouts; a stale base would have made this branch's eventual integration story worse the longer it went unaddressed |
