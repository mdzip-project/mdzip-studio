# MDZip Studio Release Checklist

Use this before shipping a new Windows build.

## 1. Prepare the tree

- Confirm the working tree only contains intended release changes.
- Verify `package.json` has the release metadata you expect:
  - `version`
  - `description`
  - `author`

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

- **Confirm the version.** `scripts/bump-version.js` auto-increments the patch
  on the `prebuild` hook, so the version in `package.json` *after* the build is
  the one you are releasing. Capture it as `<version>`:
  ```
  node -e "console.log(require('./package.json').version)"
  ```
- **Commit and push** any release changes to the default branch.
- **Tag the release** (or let `gh release create` create the tag):
  ```
  git tag v<version>
  git push origin v<version>
  ```
- **Gather all three artifacts** from `dist/` — do not skip the `.blockmap`,
  which the 0.1.14 release accidentally omitted (it enables differential
  auto-updates):
  - `MDZip Studio Setup <version>.exe`     (the installer)
  - `MDZip Studio Setup <version>.exe.blockmap`
  - `latest.yml`                           (auto-update metadata)
- **Create the release.** Either drag the three files into a new release on tag
  `v<version>` in the GitHub web UI, or:
  ```
  gh release create v<version> \
    "dist/MDZip Studio Setup <version>.exe" \
    "dist/MDZip Studio Setup <version>.exe.blockmap" \
    "dist/latest.yml" \
    --repo mdzip-project/mdzip-studio \
    --title "MDZip Studio <version>" \
    --notes "Release notes here"
  ```
  (GitHub renames spaces to dots in uploaded asset names, e.g.
  `MDZip.Studio.Setup.<version>.exe` — this is expected.)
- **Record the released version** for your own tracking.

> Note: `latest.yml` is only *consumed* once `electron-updater` is wired into
> the app's main process. Until then it is informational — the app does not yet
> check for or install updates on its own.
