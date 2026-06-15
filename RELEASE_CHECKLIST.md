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

## 5. Publish artifacts

- Include the installer from `dist/`
- Include `latest.yml` if you are publishing auto-update metadata
- Record the app version used for the release
