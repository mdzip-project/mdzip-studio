# MDZip Studio Release Checklist

Releases are built by CI. You bump the version and push a tag; the
`.github/workflows/release.yml` matrix builds **Windows + Linux + macOS** and uploads
every artifact to a **draft** GitHub release named after the tag. You review the
draft and publish it — `electron-updater` only sees published releases, so
nothing reaches users until you click Publish.

Steps tagged **(Windows)** / **(Linux)** / **(macOS)** are platform-specific; everything else
applies to the release as a whole.

## 1. Prepare the tree

- Confirm the working tree only contains intended release changes, on `main`.
- Update `CHANGELOG.md`: rename `[Unreleased]` to the version being shipped with
  today's date (e.g. `## [1.3.22] - 2026-09-09`), add a fresh empty
  `[Unreleased]` section above it, and update the compare links at the bottom.
  Commit this.
- Sanity-check `package.json` metadata (`description`, `author`, `build.publish`).

## 2. Bump the version and tag

`npm version` bumps `package.json` + `package-lock.json`, runs the `version`
hook (which regenerates `src/app/app-version.ts` and stages it), commits, and
creates the `v<version>` tag. The old auto-increment on `prebuild` is gone —
the version only ever changes here.

```bash
npm version patch          # 1.3.21 -> 1.3.22  (or: minor / major)
git push --follow-tags
```

Pushing the `v*` tag triggers the release workflow. A safety step in the
workflow fails the build if the tag and `package.json` version disagree.

## 3. Watch the build

- GitHub → Actions → **Release** run for the tag.
- The **windows** job builds first (it also compiles the shell preview handler
  from `mdzip-project/mdzip-win-prev@main` via `dotnet publish`), then **linux**
  builds and uploads into the same draft release, then **macos** (on
  `macos-15`; needs neither dotnet nor `mdzip-win-prev`) runs `npm test`,
  builds a universal app and uploads the same way. Its verify step checks
  `lipo -archs` shows both `x86_64` and `arm64` and that the ad-hoc
  signature is valid (`codesign --verify --deep --strict`).
- All three jobs run `electron-builder --publish always`, whose GitHub publisher
  defaults to a **draft** release, so the two jobs converge on one draft (the jobs are chained with `needs:` so they never race to create it).
- To test the Mac build without a release, run the **Mac build (test)** workflow (`mac-build.yml`; also runs on pushes to the `macOS` branch). It builds, verifies and uploads the `.dmg`/`.zip` as run artifacts, with no publishing.

Artifacts that must end up on the release (electron-builder produces all of
these — do not add or rename any by hand):

- **(Windows)** `MDZip-Studio-Setup-<version>.exe`, `.exe.blockmap`, `latest.yml`,
  and `MDZip-Studio-<version>-portable.exe` (the portable version, since 1.6.0;
  smoke-test it too: it should start from any folder and create a
  **MDZip Studio Data** folder beside itself)
- **(Linux)** `MDZip-Studio-<version>.deb`, `MDZip-Studio-<version>.AppImage`,
  `latest-linux.yml` (the AppImage's blockmap is embedded — no separate file)
- **(macOS)** `MDZip-Studio-<version>-universal.dmg`,
  `MDZip-Studio-<version>-universal.zip` (+ `.blockmap` files) and `latest-mac.yml`

## 4. Smoke test (MANDATORY — do not skip)

> The 1.3.10 release shipped broken because this step was skipped: the packaged
> app crashed on launch with "Cannot find module 'electron-updater'" — a runtime
> dependency that wasn't bundled. **Launching the packaged build catches this
> class of bug; the dev server (`npm start`) does not, because it runs from the
> full `node_modules`.** CI builds the package but does not run it.

Download the draft release's artifacts (or pull them from the Actions run) and,
on each platform you can reach:

- **Launch the installed/packaged app and confirm it actually starts** — not a
  blank window, not an Electron error dialog.
  - **(Windows)** install `MDZip-Studio-Setup-<version>.exe`, launch it.
  - **(Linux)** `sudo apt install ./MDZip-Studio-<version>.deb`, launch "MDZip
    Studio" from the app menu, and **double-click a `.mdz` in the file manager**
    — it must open in Studio (verifies the `application/vnd.mdzip` association).
    `sudo apt remove mdzip-studio` should leave no dangling associations. Also
    `chmod +x` the AppImage and run it directly, ideally once on a non-Debian
    distro.
  - **(macOS)** open the `.dmg`, drag the app to Applications, and follow the
    first-launch steps in the README (Done → Privacy & Security → Open
    Anyway). Check Apple Silicon and, if you can, an Intel Mac or Rosetta.
    **Double-click a `.mdz`** with the app closed and again with it open — it
    must open in Studio (verifies the `org.mdzip.mdz` type) — and check
    **Open With** on a `.md`.
- Open and save a sample archive.
- DevTools shows no `ERR_FILE_NOT_FOUND` for JS/CSS bundles.
- **(Windows)** right-click a `.mdz` in Explorer → the preview pane renders
  (the bundled preview handler registered on install).

If a smoke test fails: delete the draft release, delete the tag
(`git push --delete origin v<version>` and `git tag -d v<version>`), fix, and
start again from step 2 with the next patch number. Never publish a draft that
failed a smoke test.

## 5. Publish

- Title the release `MDZip Studio <version>` (electron-builder names the draft
  just `<version>`): `gh release edit v<version> --title "MDZip Studio <version>"`.
- Edit the draft release notes from the matching `CHANGELOG.md` section so the
  release and changelog agree.
- Confirm the asset list is complete (step 3) and the asset names are
  space-free — `artifactName` is set so they match the `url` in `latest.yml`
  exactly. A 404 on auto-update download almost always means a space crept into
  an asset name.
- **Publish** the release (not a draft — `electron-updater` ignores drafts).
- Record the released version for your own tracking.

### Package managers

- **Chocolatey** — automatic: publishing the release runs
  `.github/workflows/chocolatey.yml`.
- **WinGet** — manual, and only for minor/major releases or installer changes.
  See "Which releases need a WinGet update" in [winget-todo.md](winget-todo.md).

## 6. Auto-updates

`electron-updater` is wired into the main process. A quiet background check runs
~15s after launch and every 6h; it only marks the Help menu (never a dialog,
never an unattended download). Help → "Check for Updates..." is the user-driven
path. Nothing installs without two confirmation dialogs. It reads the GitHub
`publish` config baked into `app-update.yml` and queries this repo's **published**
releases, so:

- `latest.yml` / `latest-linux.yml` / `latest-mac.yml` and the Windows blockmap are **required**
  every release — they are what the installed app reads to detect and
  differentially download an update.
- **(Linux)** Both artifact types self-update:
  - **AppImage** — `AppImageUpdater` downloads the new `.AppImage` and swaps it
    in place on restart. The smooth path.
  - **`.deb`** — `DebUpdater` downloads the new `.deb` and, on restart, runs
    `pkexec dpkg -i <file>` (a graphical polkit password prompt every update),
    falling back to `apt-get install -f` for missing deps. Works, but newer /
    less battle-tested than the AppImage path.
- **(macOS)** The app is ad-hoc signed and not notarized, so it cannot swap
  itself in place (Squirrel.Mac needs a real signature). Check for Updates
  finds the new version and downloads the `.dmg` instead; the user installs
  it by hand. See the macOS code path in `electron/` for the exact behavior.
- The tag must be `v<version>` and the release **published**.
- An update only reaches users already running a build that contains the updater
  code — so the first auto-update lands for whoever installed *this* release or
  later, not for older installs.

## Signing

**macOS** builds are **ad-hoc signed** (`mac.identity` is `"-"`) and **not
notarized**, because the project has no Apple Developer account. Users see the
"Apple could not verify…" dialog on first launch and use **Open Anyway** (steps
in the README). Do not paste a Developer ID into the workflow; if the project
ever buys one, set `CSC_LINK`/`CSC_KEY_PASSWORD` and the `APPLE_*`
notarization variables, switch `identity`/`hardenedRuntime`/`notarize` in
`package.json`, and drop `CSC_IDENTITY_AUTO_DISCOVERY`.

Paste this into the release notes of each release (the README has the same text):

> **macOS:** download the `.dmg` and drag MDZip Studio to Applications. The app
> is not signed by Apple, so on first launch click **Done** on the "Apple could
> not verify…" dialog, then open **System Settings → Privacy & Security** and
> click **Open Anyway**. Or run
> `xattr -dr com.apple.quarantine "/Applications/MDZip Studio.app"`.
> Homebrew: `brew install --cask mdzip-project/mdzip/mdzip-studio`
> (upgrade with `brew upgrade --cask mdzip-studio`).

**Homebrew tap (automatic).** Publishing the draft release fires
`.github/workflows/bump-tap.yml`, which downloads the `-universal.dmg`, computes
its sha256 and commits the new `version` and `sha256` to
`Casks/mdzip-studio.rb` in `mdzip-project/homebrew-mdzip`. Check that the tap's
latest commit matches the release. It skips quietly if the release has no mac
`.dmg`. One-time setup:

1. Create the public repo `mdzip-project/homebrew-mdzip` and push the contents
   of the local `homebrew-mdzip` folder to `main`.
2. Create a fine-grained personal access token limited to that one repository
   with **Contents: Read and write**.
3. Add it to `mdzip-studio` as the Actions secret `HOMEBREW_TAP_TOKEN`.

Windows builds are currently **unsigned** (SmartScreen will warn on first run).
To sign, add `CSC_LINK` (base64-encoded `.pfx`) and `CSC_KEY_PASSWORD` as repo
secrets and uncomment the matching lines in `release.yml`. `win.signExts` already
lists the bundled native DLLs that should be signed alongside the app.

## Manual build (fallback)

If CI is unavailable, the local flow still works — `npm run build` runs
`prebuild` (sync version → generate About data → **(Windows)** build the preview
handler) then `build:angular` + `build:electron`. `electron-builder` builds for
the **host OS only**, so a three-platform release is three machines (the macOS
build needs a Mac). Publish with:

```bash
# from each build machine, after `npm run build`:
npx electron-builder --publish always        # uploads to the draft for the current tag
# GH_TOKEN must be set; the tag must already exist (step 2).
```

**(Linux)** `build:preview-handler` auto-skips off Windows — no `dotnet` or
`mdzip-win-prev` checkout needed. **(Windows)** it needs the .NET SDK and either
a sibling `../mdzip-win-prev` checkout or `MDZIP_WIN_PREV_DIR` pointing at one.
