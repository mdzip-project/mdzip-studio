# Changelog

All notable changes to MDZip Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.14] - 2026-06-17

### Fixed

- Auto-update could detect a new version but failed to download it with HTTP
  404. The installer file name in `latest.yml` used hyphens while the asset
  uploaded to GitHub had spaces converted to dots, so the two never matched.
  Installer artifacts are now built without spaces
  (`MDZip-Studio-Setup-<version>.exe`), so the update feed and the uploaded
  asset names line up.

## [1.3.13] - 2026-06-17

### Fixed

- The Save button stayed disabled for a document that only lives in memory and
  has never been written to disk — a new document, a packed folder, or a `.md`
  just converted to `.mdz` — even though the status bar said to save it. Save is
  now enabled (and dotted) whenever there are unsaved edits *or* the document
  isn't on disk yet. (Ctrl+S and File → Save were never affected.)

## [1.3.12] - 2026-06-17

### Changed

- **Help → Check for Updates…** now reports its result in a dialog ("You're up
  to date", an update was found, or an error) instead of a native notification,
  so the outcome is always visible. The silent startup check still uses
  notifications.

## [1.3.11] - 2026-06-17

### Fixed

- The packaged Windows app failed to launch with "Cannot find module
  'electron-updater'" — no runtime dependencies were being bundled into the
  app. The build now ships `electron-updater` (the only runtime dependency) in
  the package; the renderer libraries remain bundled by the Angular build.

## [1.3.10] - 2026-06-17

### Added

- Automatic updates via `electron-updater`: a silent check runs shortly after
  launch, and **Help → Check for Updates...** triggers one on demand. Updates
  download in the background and install on restart, with native OS
  notifications for "update available", "update ready", "up to date", and
  errors. Updates are delivered from this repo's GitHub Releases.
- The Save button now reflects unsaved state: it is disabled when there is
  nothing to save and shows a dot when you have unsaved edits.
- A prompt to save (or discard) unsaved edits when closing, creating, or
  opening a document.
- A "Saving…" status message while a save is in progress.
- **Show in File Manager** to reveal the saved document on disk.
- Convert a Markdown document to an MDZip archive (with a confirmation
  dialog), embedding the document's relative images so the archive is
  self-contained.
- Relative images referenced by a Markdown document now render in the preview.

### Fixed

- Preview images no longer re-run their reveal animation (fade/slide) on every
  keystroke while editing.

## [1.3.0] - 2026-06-16

### Added

- Pack-a-folder workflow and recent-file management.

### Changed

- Reworked the GitHub release process and checklist.

## [0.1.14] - 2026-06-14

### Added

- First public release: create, view, edit, and validate MDZip archives, with
  Markdown editor/preview, asset browser, and manifest editing.

[Unreleased]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.14...HEAD
[1.3.14]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.13...v1.3.14
[1.3.13]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.12...v1.3.13
[1.3.12]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.11...v1.3.12
[1.3.11]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.10...v1.3.11
[1.3.10]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.0...v1.3.10
[1.3.0]: https://github.com/mdzip-project/mdzip-studio/compare/v0.1.14...v1.3.0
[0.1.14]: https://github.com/mdzip-project/mdzip-studio/releases/tag/v0.1.14
