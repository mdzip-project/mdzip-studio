# MDZip Studio Release Checklist

Use this before shipping a new Windows build.

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
- Confirm the installer is created under `dist/`

## 3. Smoke test

- Confirm `dist/mdzip-studio/index.html` contains `<base href="./">`
- Launch `dist/win-unpacked/mdzip-studio.exe`
- Confirm the app UI renders instead of showing a blank window
- Confirm DevTools does not report `ERR_FILE_NOT_FOUND` for the generated JS or CSS bundles
- Open and save a sample archive if you want a slightly deeper sanity check

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
- **Gather all three artifacts** from `dist/` — do not skip the `.blockmap`,
  which the 0.1.14 release accidentally omitted (it enables differential
  auto-updates):
  - `MDZip Studio Setup <version>.exe`     (the installer)
  - `MDZip Studio Setup <version>.exe.blockmap`
  - `latest.yml`                           (auto-update metadata)
- **Create the release.** `gh release create` creates and pushes the `v$VERSION`
  tag for you, so no separate `git tag` step is needed. The release must be
  **published, not a draft** — `electron-updater` only sees published releases:
  ```powershell
  gh release create "v$VERSION" `
    "dist/MDZip Studio Setup $VERSION.exe" `
    "dist/MDZip Studio Setup $VERSION.exe.blockmap" `
    "dist/latest.yml" `
    --repo mdzip-project/mdzip-studio `
    --title "MDZip Studio $VERSION" `
    --notes "Release notes go here"
  ```
  Use the matching `CHANGELOG.md` section as the source for `--notes` (paste the
  entries, or `--notes-file` a trimmed copy) so the release and changelog match.
  (GitHub renames spaces to dots in uploaded asset names, e.g.
  `MDZip.Studio.Setup.<version>.exe` — this is expected.)
- **Record the released version** for your own tracking.

## 6. Auto-updates

`electron-updater` is wired into the app's main process (Help → "Check for
Updates...", plus a silent check on startup). It reads the `publish` config in
`package.json` and polls this repo's published GitHub releases, so:

- The three artifacts above are **required** every release — `latest.yml` and the
  `.blockmap` are what the installed app reads to detect and differentially
  download an update.
- Tag must be `v$VERSION` and the release must be **published** (not a draft).
- An update only reaches users running a build that already contains the updater
  code, so the first auto-update lands for whoever installed *this* release or
  later — not for older installs.
