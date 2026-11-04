# MDZip Studio for macOS — implementation plan

Branch: `macOS`. Status: plan, not started. Written 2026-11-04.

## Decisions (from the owner)

- **Never pay Apple.** No Developer ID, no notarization. Builds are **ad-hoc signed** (`codesign -s -`), which on Apple Silicon is required to run at all and gets the milder "Apple could not verify…" dialog (with Open Anyway) instead of "is damaged".
- **Universal** build (Apple Silicon + Intel), `.dmg` + `.zip` on GitHub Releases.
- **Homebrew** via our own tap (`mdzip-project/homebrew-tap`). The official `homebrew/cask` has disabled casks that fail Gatekeeper since Sept 2026, so it's not an option.
- **Updates: best free experience.** Squirrel.Mac (electron-updater's mac install path) requires a real signature, so no in-place install. Instead: check → "Update available" → download the `.dmg` in-app with progress → open it and offer to quit so the user drags the new app over. Homebrew installs are told to run `brew upgrade --cask mdzip-studio`.
- Owner has a Mac from 2026-11-05 for testing.

## Out of scope (v1)

- Quick Look preview of `.mdz` in Finder (native Swift extension; later).
- "Set as default Markdown editor" — no public API on macOS; already hidden there. Help text points to Get Info → Open With → Change All.
- Mac App Store (needs paid account).

## Phases

Each phase is done by a sub-agent on the `macOS` branch, uncommitted; the manager session reviews the diff before the next phase. Nothing is committed or pushed without the owner's explicit say-so.

### Phase 1 — pure helpers + tests (Windows; Sonnet)

All in `electron/lib/` so they're testable with `npm run test:electron` (main.js has no tests).

1. **Menu (`menu.js`)** — when `platform === 'darwin'`:
   - prepend an app menu: About (`role: 'about'`), Check for Updates…, Settings if any, Services, Hide / Hide Others / Show All, Quit (`Cmd+Q`);
   - drop File → Exit; move About / Check for Updates out of Help;
   - append a Window menu (`role: 'windowMenu'`); add Select All to Edit;
   - "Show in File Manager" → "Reveal in Finder";
   - `recentLabel` doubles `&` only on win32/linux.
2. **Open-file queue (new `open-file-queue.js`)** — collects paths from `open-file` events that arrive before the app/window is ready, then drains them into `openOrFocus`. Filters to `.md`/`.mdz` like `document-path.js`.
3. **Mac updater helpers (`updater.js`)** — pick the `-universal.dmg` asset from a release; detect a Homebrew install (`/opt/homebrew/Caskroom/mdzip-studio` or `/usr/local/Caskroom/mdzip-studio`); dialog builders for "update available (download / open release page / later)", "Homebrew: run brew upgrade", "downloaded — open installer and quit?".
4. **Fix Windows-only tests** — `jump-list.test.js` and `menu.test.js` (`recentLabel` with `C:\…` paths) must pass on macOS: use `path.win32` where the code is Windows-only, or pass the platform. Add darwin cases for every new branch.
5. **Renderer (`src/app/app.component.ts`)** — tooltip shortcut labels use `⌘`/`⇧` on darwin (`bridge.platform`); keyboard handler uses `metaKey` only on darwin, `ctrlKey` elsewhere. Confirm the default-editor prompt can't appear on darwin.

Done when: `npm test` passes on Windows; new code has darwin tests.

### Phase 2 — wire it into `electron/main.js` (Windows; Sonnet, after Phase 1)

1. Register `app.on('open-file')` at top level (before `ready`), `preventDefault`, feed the queue. Dock-click `activate` drains pending paths before making an empty window.
2. Menus on darwin: the app menu is global, so rebuild and `Menu.setApplicationMenu` on window focus and on document/recent changes, bound to the focused window's handlers (fixes the `handlers(null)` dead-menu issue noted at main.js ~1547). Keep the null-handler menu for the no-window state. Same for the print-preview window.
3. Recent files / Dock: `app.addRecentDocument(path)` alongside the jump list; `app.dock.setMenu` with New Markdown / New MDZip / New Window.
4. Updater on darwin: skip `downloadUpdate`/`quitAndInstall`. Check via `autoUpdater.checkForUpdates()` (reads `latest-mac.yml`) or the GitHub releases API; then the Phase 1 dialogs; download the `.dmg` to `~/Downloads` with progress (reuse the existing progress UI), `shell.openPath` it, offer to quit.
   - **Verify on the Mac:** whether a file our app downloads gets the quarantine flag. If it doesn't, updates skip the Gatekeeper prompt entirely — a nice bonus, but don't promise it until tested.

Done when: tests pass on Windows; manager reviews; then the owner smoke-tests on the Mac (Phase 5).

### Phase 3 — build, CI and docs (Windows authoring; Sonnet; parallel with Phase 1)

1. **`package.json` `build.mac`**: targets `dmg` + `zip`, arch `universal`; `identity: "-"` (ad-hoc), `hardenedRuntime: false`, `gatekeeperAssess: false`, `notarize: false`; `category: public.app-category.productivity`; `mac.artifactName` `MDZip-Studio-${version}-universal.${ext}`; DMG layout (app + Applications link). If `identity: "-"` gets skipped on our electron-builder version, add an `afterSign` hook running `codesign --force --deep -s -`.
2. **Icons**: `build/icon.icns` (from a 1024px PNG; check `build/icon.png` size) and an `.icns` document icon for `.mdz`.
3. **File associations** (`mac.extendInfo` / `fileAssociations`): export UTI `org.mdzip.mdz` for `.mdz` (role Editor, Owner); import `net.daringfireball.markdown` for `.md` with `LSHandlerRank: Alternate` so we don't fight other editors.
4. **`.github/workflows/release.yml`**: add a `macos` job on pinned `macos-15` (free for public repos): `npm ci`, prebuild, `build:angular`, `electron-builder --mac --universal --publish always` into the same draft release. Verify steps: `lipo -archs` (expects `x86_64 arm64`) and `codesign --verify --deep --strict` + `codesign -dv`. Also run `npm test` on the mac runner.
5. **Docs**: README "Installing (macOS)" with first-launch steps (open → Done → System Settings → Privacy & Security → Open Anyway; Terminal fallback `xattr -dr com.apple.quarantine "/Applications/MDZip Studio.app"`), plus the Homebrew line. Same text in release notes template. Update `RELEASE_CHECKLIST.md`, `CLAUDE.md`, `AGENTS.md` for the three-platform matrix.

Done when: config validates (`electron-builder --help`-level check on Windows can't build mac — the first real build is a CI run on a pushed branch, which needs the owner's OK to push).

### Phase 4 — Homebrew tap (Haiku for the cask; Sonnet for the workflow)

1. New public repo `mdzip-project/homebrew-tap` (**owner creates or approves**) with `Casks/mdzip-studio.rb`: `url` to the universal `.dmg`, `sha256`, `app "MDZip Studio.app"`, `zap` paths, and `caveats` with the Open Anyway / `xattr` steps. No `auto_updates`. **No quarantine-stripping `postflight`** by default (Homebrew discourages it; owner may override).
2. Release workflow step that bumps version + sha256 in the tap after a release is published (needs a token with write access to the tap — owner sets the secret).
3. Users: `brew install --cask mdzip-project/tap/mdzip-studio`, upgrade with `brew upgrade --cask mdzip-studio`.

### Phase 5 — test on the Mac (owner, with a checklist from the manager)

Clean install from the CI `.dmg` on Apple Silicon (and under Rosetta / an Intel Mac if available): first-launch dialog and Open Anyway; double-click `.mdz` with the app closed and open; drag a file on the Dock icon; Open With → `.md`; all menus and `⌘` shortcuts with two windows open; Cmd-Q with unsaved changes; print/preview; recent documents in Dock; update flow (against a fake older version); Homebrew install + upgrade.

### Afterwards (other repos, separate issues)

- `mdzip.org` `templates/ecosystem.json` — add macOS to Studio's platforms; download page link.
- `.github` `docs/workspace.md` if platform notes live there.
- winget/chocolatey unaffected.

## Model assignment

| Work | Model | Why |
|---|---|---|
| Plan, reviews, merging decisions | Opus (manager) | judgment across phases |
| Phases 1–3 | Sonnet | multi-file code + tests, moderate reasoning |
| Cask file, doc wording tweaks | Haiku | small templated edits |

## Risks

- Ad-hoc + universal merge is untested by us — the first CI run is the real test.
- Gatekeeper wording/steps keep changing across macOS releases; recheck the README steps on the owner's Mac.
- Claiming `.md` will rarely make us the default; that's intended.

## Progress (2026-11-04)

Phases 1–3 done on `macOS` (uncommitted), reviewed by the manager session. `npm test` passes on Windows (Angular + 102 electron tests). Nothing has run on a Mac yet. Spots that couldn't be checked are marked `UNVERIFIED` in `electron/main.js`.

Next: push the branch → `mac-build.yml` builds a test `.dmg` (no release) → Mac test below → Phase 4 (tap).

## Mac test checklist

Install from the `mac-build` workflow's `.dmg` artifact.

**Install**
- [ ] CI log: `lipo` shows `x86_64 arm64`; `codesign` shows `Signature=adhoc`
- [ ] First launch: "Apple could not verify…" (not "damaged") → Done → System Settings → Privacy & Security → Open Anyway works; README steps match what you see
- [ ] App and Dock icons look right (512px source, may be soft)

**Opening files**
- [ ] Double-click an `.mdz` with the app closed: one window with the file, no extra blank window
- [ ] Double-click / drop on Dock icon with the app running: opens or focuses
- [ ] `.mdz` shows the MDZip document icon in Finder; `.md` → Open With lists Studio
- [ ] Dock click with no windows: exactly one new window

**Menus and keys**
- [ ] App menu (About, Check for Updates, Hide, Quit ⌘Q), File, Edit (incl. Select All in the editor), View, Window, Help
- [ ] With two windows, the menu follows focus; ⌘N, ⌘O, ⌘S, ⌘W, ⌘P act on the focused window
- [ ] Toolbar tooltips show ⌘/⇧
- [ ] Close the last window: New, Open, Pack, Unpack, About, Change Log still work from the menu
- [ ] Print preview: its menu shows while focused and goes back after
- [ ] ⌘Q with unsaved changes prompts

**Dock / recents**
- [ ] Dock menu: New Markdown, New MDZip, New Window
- [ ] Recent documents appear (Dock right-click) and Clear empties them

**Updates** (needs a published release newer than the build — or temporarily lower the version)
- [ ] Check for Updates finds it; Download shows Dock progress and saves the `.dmg` to Downloads
- [ ] Open Installer and Quit opens the `.dmg` and quits (unsaved prompt respected)
- [ ] Does the downloaded `.dmg` carry the quarantine flag? (`xattr -l ~/Downloads/MDZip-Studio-*.dmg`)
- [ ] Homebrew install shows the `brew upgrade` dialog instead (after Phase 4)

**Intel**
- [ ] Repeat a quick launch + open under Rosetta or on an Intel Mac if available

Known gaps: no Cancel for the update download; preview-window menu can be replaced by the no-window menu if the last document window closes while the preview is open.
