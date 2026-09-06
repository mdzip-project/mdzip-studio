# MDZip Studio Release Checklist

Use this before shipping a new release. Steps apply to every platform unless
tagged **(Windows)** or **(Linux)**; a release may ship one platform or both.
`npm run build:electron` builds for the host OS only, so a two-platform release
is two build machines uploading to one GitHub release.

## 1. Prepare the tree

- Confirm the working tree only contains intended release changes.
- Verify `package.json` has the release metadata you expect:
  - `version`
  - `description`
  - `author`
- Update `CHANGELOG.md`: rename the `[Unreleased]` heading to the version being
  shipped with today's date (e.g. `## [1.3.9] - 2026-06-17`), add a fresh empty
  `[Unreleased]` section above it, and update the compare links at the bottom.

## 2. Build

- Run `npm run build:angular`
- Run `npm run build:electron`
- Confirm the artifacts are created under `dist/`:
  - **(Windows)** `MDZip-Studio-Setup-<version>.exe` (+ `.exe.blockmap`, `latest.yml`)
  - **(Linux)** `MDZip-Studio-<version>.deb`, `MDZip-Studio-<version>.AppImage`,
    `latest-linux.yml`
- **(Linux)** The Windows shell preview-handler step (`build:preview-handler`)
  auto-skips off Windows — no `dotnet` toolchain or `mdzip-win-prev` checkout
  needed.

## 3. Smoke test (MANDATORY — do not skip)

> The 1.3.10 release shipped broken because this step was skipped: the packaged
> app crashed on launch with "A JavaScript error occurred in the main process —
> Cannot find module 'electron-updater'" because a runtime dependency wasn't
> bundled. **Launching the packaged build catches this class of bug; the dev
> server (`npm start`) does not, because it runs from the full `node_modules`.**

- Confirm `dist/mdzip-studio/index.html` contains `<base href="./">`
- **Launch the packaged app and confirm it actually starts** — **not** a blank
  window and **not** an Electron error dialog. A "Cannot find module …" dialog
  means a `require`d runtime dependency is missing from the package (check the
  `files` globs and that the module is a production `dependency` in
  `package.json`).
  - **(Windows)** `dist/win-unpacked/MDZip Studio.exe`
  - **(Linux)** `dist/linux-unpacked/mdzip-studio`
- Confirm DevTools does not report `ERR_FILE_NOT_FOUND` for the generated JS or CSS bundles
- Open and save a sample archive (deeper sanity check)
- If you changed anything touching `electron/main.js` requires or the build
  `files`/dependencies, also install the real packaged artifact and launch
  *that* before publishing:
  - **(Windows)** `dist/MDZip-Studio-Setup-<version>.exe`
  - **(Linux)** `sudo apt install ./dist/MDZip-Studio-<version>.deb`, then launch
    "MDZip Studio" from the application menu and **double-click a `.mdz` file in
    the file manager** — it must open in Studio (verifies the
    `application/vnd.mdzip` association). `sudo apt remove mdzip-studio` should
    leave no dangling associations. Also `chmod +x` and run the AppImage
    directly, ideally once on a non-Debian distro.

## 4. Review warnings

- `author is missed in the package.json` should not appear once `author` is set.
- `duplicate dependency references` from `electron-builder` is usually informational in current releases. Investigate only if the build fails or the packaged app is missing modules.
- `DEP0190` from `electron-builder` internals is a warning in the packager, not an app failure.

## 5. Create the GitHub release

There is no `publish` provider configured, so this is a **manual** flow:
electron-builder generates the artifacts locally and you upload them yourself.

- **Capture the version.** `scripts/bump-version.js` auto-increments the patch
  on the `prebuild` hook, so the version in `package.json` *after* the build is
  the one you are releasing. Read it into `$VERSION` and reuse it everywhere:
  ```powershell
  $VERSION = node -p "require('./package.json').version"; echo $VERSION
  ```
- **Commit and push** any release changes to the default branch.
- **Gather the artifacts** from `dist/` for each platform this release ships —
  do not skip the `.blockmap` / `latest*.yml`, which drive differential
  auto-updates (the 0.1.14 release accidentally omitted the blockmap):
  - **(Windows)** `MDZip-Studio-Setup-<version>.exe` (installer),
    `MDZip-Studio-Setup-<version>.exe.blockmap`, `latest.yml`
  - **(Linux)** `MDZip-Studio-<version>.deb`, `MDZip-Studio-<version>.AppImage`,
    `latest-linux.yml` (the AppImage carries its blockmap embedded — no separate
    file)
- **Create the release.** `gh release create` creates and pushes the `v$VERSION`
  tag for you, so no separate `git tag` step is needed. The release must be
  **published, not a draft** — `electron-updater` only sees published releases:
  ```powershell
  gh release create "v$VERSION" `
    "dist/MDZip-Studio-Setup-$VERSION.exe" `
    "dist/MDZip-Studio-Setup-$VERSION.exe.blockmap" `
    "dist/latest.yml" `
    --repo mdzip-project/mdzip-studio `
    --title "MDZip Studio $VERSION" `
    --notes "Release notes go here"
  ```
  When Linux ships in the same release, add its files (from the Linux build
  machine — `gh release upload "v$VERSION" ...` if the release already exists):
  ```bash
  gh release upload "v$VERSION" \
    "dist/MDZip-Studio-$VERSION.deb" \
    "dist/MDZip-Studio-$VERSION.AppImage" \
    "dist/latest-linux.yml" \
    --repo mdzip-project/mdzip-studio
  ```
  Use the matching `CHANGELOG.md` section as the source for `--notes` (paste the
  entries, or `--notes-file` a trimmed copy) so the release and changelog match.
- **Verify the asset names match `latest.yml`.** The `artifactName` build
  setting produces space-free names (`MDZip-Studio-Setup-<version>.exe`) so the
  uploaded asset matches the `url` in `latest.yml` exactly. If you ever see a
  404 on auto-update download, this is the first thing to check — GitHub
  rewrites spaces in asset names, which silently breaks the feed.
- **Record the released version** for your own tracking.

## 6. Auto-updates

`electron-updater` is wired into the app's main process. A quiet background check
runs ~15s after launch and every 6h; it only marks the Help menu (never a
dialog, never a download). Help → "Check for Updates..." is the user-driven path
and the only one that shows "up to date" / error dialogs. Nothing installs
without the two confirmation dialogs. It reads the GitHub `publish` config baked
into `app-update.yml` and queries this repo's published releases, so:

- The artifacts above are **required** every release — `latest.yml` /
  `latest-linux.yml` and the blockmap are what the installed app reads to detect
  and differentially download an update.
- **(Linux)** Both artifact types self-update:
  - **AppImage** — `AppImageUpdater` downloads the new `.AppImage` and swaps it
    in place on restart. The smooth path.
  - **`.deb`** — `DebUpdater` (electron-updater carries a `package-type: deb`
    marker in the package) downloads the new `.deb` and, on restart, runs
    `pkexec dpkg -i <file>` — a **graphical polkit password prompt every
    update** — falling back to `apt-get install -f` for missing deps. Works, but
    newer / less battle-tested than the AppImage path.
- Tag must be `v$VERSION` and the release must be **published** (not a draft).
- An update only reaches users running a build that already contains the updater
  code, so the first auto-update lands for whoever installed *this* release or
  later — not for older installs.
