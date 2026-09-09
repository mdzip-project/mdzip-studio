# MDZip Studio Release Checklist

Releases are built by CI. You bump the version and push a tag; the
`.github/workflows/release.yml` matrix builds **Windows + Linux** and uploads
every artifact to a **draft** GitHub release named after the tag. You review the
draft and publish it — `electron-updater` only sees published releases, so
nothing reaches users until you click Publish.

Steps tagged **(Windows)** / **(Linux)** are platform-specific; everything else
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
  builds and uploads into the same draft release.
- Both jobs run `electron-builder --publish always`, whose GitHub publisher
  defaults to a **draft** release, so the two jobs converge on one draft.

Artifacts that must end up on the release (electron-builder produces all of
these — do not add or rename any by hand):

- **(Windows)** `MDZip-Studio-Setup-<version>.exe`, `.exe.blockmap`, `latest.yml`
- **(Linux)** `MDZip-Studio-<version>.deb`, `MDZip-Studio-<version>.AppImage`,
  `latest-linux.yml` (the AppImage's blockmap is embedded — no separate file)

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
- Open and save a sample archive.
- DevTools shows no `ERR_FILE_NOT_FOUND` for JS/CSS bundles.
- **(Windows)** right-click a `.mdz` in Explorer → the preview pane renders
  (the bundled preview handler registered on install).

If a smoke test fails: delete the draft release, delete the tag
(`git push --delete origin v<version>` and `git tag -d v<version>`), fix, and
start again from step 2 with the next patch number. Never publish a draft that
failed a smoke test.

## 5. Publish

- Edit the draft release notes from the matching `CHANGELOG.md` section so the
  release and changelog agree.
- Confirm the asset list is complete (step 3) and the asset names are
  space-free — `artifactName` is set so they match the `url` in `latest.yml`
  exactly. A 404 on auto-update download almost always means a space crept into
  an asset name.
- **Publish** the release (not a draft — `electron-updater` ignores drafts).
- Record the released version for your own tracking.

## 6. Auto-updates

`electron-updater` is wired into the main process. A quiet background check runs
~15s after launch and every 6h; it only marks the Help menu (never a dialog,
never an unattended download). Help → "Check for Updates..." is the user-driven
path. Nothing installs without two confirmation dialogs. It reads the GitHub
`publish` config baked into `app-update.yml` and queries this repo's **published**
releases, so:

- `latest.yml` / `latest-linux.yml` and the Windows blockmap are **required**
  every release — they are what the installed app reads to detect and
  differentially download an update.
- **(Linux)** Both artifact types self-update:
  - **AppImage** — `AppImageUpdater` downloads the new `.AppImage` and swaps it
    in place on restart. The smooth path.
  - **`.deb`** — `DebUpdater` downloads the new `.deb` and, on restart, runs
    `pkexec dpkg -i <file>` (a graphical polkit password prompt every update),
    falling back to `apt-get install -f` for missing deps. Works, but newer /
    less battle-tested than the AppImage path.
- The tag must be `v<version>` and the release **published**.
- An update only reaches users already running a build that contains the updater
  code — so the first auto-update lands for whoever installed *this* release or
  later, not for older installs.

## Signing

Windows builds are currently **unsigned** (SmartScreen will warn on first run).
To sign, add `CSC_LINK` (base64-encoded `.pfx`) and `CSC_KEY_PASSWORD` as repo
secrets and uncomment the matching lines in `release.yml`. `win.signExts` already
lists the bundled native DLLs that should be signed alongside the app.

## Manual build (fallback)

If CI is unavailable, the local flow still works — `npm run build` runs
`prebuild` (sync version → generate About data → **(Windows)** build the preview
handler) then `build:angular` + `build:electron`. `electron-builder` builds for
the **host OS only**, so a two-platform release is two machines. Publish with:

```bash
# from each build machine, after `npm run build`:
npx electron-builder --publish always        # uploads to the draft for the current tag
# GH_TOKEN must be set; the tag must already exist (step 2).
```

**(Linux)** `build:preview-handler` auto-skips off Windows — no `dotnet` or
`mdzip-win-prev` checkout needed. **(Windows)** it needs the .NET SDK and either
a sibling `../mdzip-win-prev` checkout or `MDZIP_WIN_PREV_DIR` pointing at one.
