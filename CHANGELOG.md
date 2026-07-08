# Changelog

All notable changes to MDZip Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.21] - 2026-07-08

### Added

- **Find & Replace in the editor (Ctrl/Cmd+F)** — the search panel from
  `@mdzip/editor` 1.3.15, with a toolbar search button. Works in edit and
  read-only viewing alike; opening search from preview mode switches to a
  layout with the source visible.
- Added **File -> Print... (Ctrl+P)** in the desktop app. It opens a paginated
  print preview of the open document (rendered light, with images and Mermaid
  diagrams included), from which you can print via the system dialog or save a
  PDF. For `.mdz` archives it prints the document entry currently being viewed.
  Unsaved edits are included, the same as Save.
- The print preview window has a small **Print** menu: **Quick Print to
  Default Printer (Ctrl+P)** sends the document straight to the default
  printer with no further dialogs, and **Close Preview (Ctrl+W)** closes the
  preview (instead of falling through to the main window and closing the
  document).
- The manifest.json view (formerly "Document Internals") is now titled
  **Manifest** and has two tabs: the **Settings** form and a read-only
  **JSON** tab showing the manifest as it will be saved, pretty-printed with
  greyscale syntax highlighting.

### Fixed

- Images referenced only by raw HTML `<img>` tags no longer show as orphaned
  in the contents pane when it is first opened, and images referenced from a
  different document than the open one are no longer flagged either.
- The manifest Settings form no longer shows stale values after an edit when
  the manifest entry is reopened.

### Changed

- Updated the embedded MDZip editor libraries to the published
  `@mdzip/editor` / `@mdzip/editor-ng` **1.3.15** (from npm rather than local
  packages): find/replace search, raw HTML tag muting in the source pane,
  image layout attributes for raw HTML `<img>`, table alignment fixes, and
  contained Mermaid error rendering.

## [1.3.20] - 2026-06-22

### Added

- Added **File -> Unpack .mdz to Folder...** in the desktop app. It writes an
  archive into a normal folder using the archive-relative paths, so regular
  Markdown editors can open the unpacked `.md` files with local image links
  intact.
- Added **Help -> Known Issues** and **Help -> Change Log** views inside the
  app. The help viewer loads the current GitHub copy when available and falls
  back to bundled files when offline.
- Added a **View -> Line Numbers** toggle for the hosted editor.
- Added a design note for a possible future standalone Markdown Hints effort:
  portable Markdown comments carrying optional presentation hints, with MDZip
  Studio as a possible early testbed.

### Changed

- Updated the embedded MDZip editor libraries to `@mdzip/editor` /
  `@mdzip/editor-ng` 1.3.12.
- Tightened Studio's table preview behavior so ordinary Markdown tables use the
  available width, honor Markdown alignment markers, and avoid wrapping short
  right-aligned values such as prices.
- Raw HTML image layout in Studio preview now honors native `width`, `height`,
  and `align` attributes directly, instead of depending on Studio-specific
  source markup.

### Fixed

- Mermaid syntax errors no longer leave Mermaid's own large error SVGs stuck in
  the app layout after the source is edited or removed.
- Raw HTML image references such as `<img src="images/logo.svg">` are now
  accounted for when Studio corrects the navigation pane's orphaned-asset
  indicators.
- Raw HTML tags in the source editor now get the same muted styling treatment
  as existing `<br>` markers.
- Save As for a converted Markdown document now suggests the original Markdown
  folder instead of starting from a less helpful default location.
- OS-requested document opens, reloads, and dirty-state prompts now handle
  unsaved work more consistently.

## [1.3.19] - 2026-06-18

### Added

- The status bar now makes the open document's format clear: a format icon
  (document for Markdown `.md`, archive for MDZip `.mdz`) plus a clearer label —
  `Viewing/Editing <file>.md` for Markdown, and
  `Viewing/Editing <entry> (<file>.mdz)` for an MDZip archive (so it's obvious
  you're viewing one entry of a bundle).
- Recent files now show Markdown/MDZip file-type icons for faster scanning.

### Changed

- The native **File** menu now hides its document-only items (Save, Save As,
  Show in File Manager, Close Document) when no document is open, instead of
  showing them greyed — Electron's native menu has no clear disabled styling, so
  they looked enabled until hovered.
- Updates are no longer automatic. The app no longer checks for or downloads
  updates on startup, and nothing installs on its own. Use **Help → Check for
  Updates…** to check; if one is found you confirm the download, then choose
  when to restart and install. This keeps a release from reaching users before
  it's been vetted.

### Fixed

- Typing in a Markdown (`.md`) document that references images was laggy: the
  preview inlined each image as a multi-megabyte `data:` URI and re-emitted them
  on every keystroke, so the browser rebuilt a huge preview and re-decoded every
  image each time. The preview now references stable `blob:` object URLs
  (decoded once and reused); the data-URI cache is kept only for embedding
  images on conversion/save.
- Relative images in Markdown (`.md`) previews now keep working with that fast
  blob-backed preview path, including when the editor's progressive image
  placeholder removes the original relative `src` before extension mounting.

## [1.3.18] - 2026-06-17

### Fixed

- The "unsaved changes" prompt on Close / New / Open now also fires for a
  document that was converted, packed, or created but never written to disk —
  previously it only triggered after edits, so closing a just-converted `.mdz`
  discarded it without warning.
- The native **File** menu's document-only items (Save, Save As, Close
  Document, Show in File Manager) are now disabled on the welcome screen when no
  document is open.

## [1.3.17] - 2026-06-17

### Fixed

- Saving a plain Markdown (`.md`) file was slow: every save rebuilt a full
  `.mdz` archive — reading and compressing all referenced images — only to
  discard it when keeping the `.md` format. The archive is now built only when
  you Save As to `.mdz`; an in-place `.md` save just writes the text.

## [1.3.16] - 2026-06-17

### Fixed

- Opening a Markdown (`.md`) file flagged it as having unsaved changes (Save
  enabled and dotted) even though nothing was edited, because the file's on-disk
  path wasn't recorded. Opening a `.md` now records its path, so it isn't
  flagged unsaved and **Save** writes back to the same file instead of prompting
  Save As.

## [1.3.15] - 2026-06-17

### Fixed

- A freshly opened document could show the Save button's "unsaved" dot even
  though nothing had changed. The unsaved-edits state wasn't reset on load, so
  it could carry over from the previously open document; it's now synced from
  the editor whenever a document loads.

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

[Unreleased]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.21...HEAD
[1.3.21]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.20...v1.3.21
[1.3.20]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.19...v1.3.20
[1.3.19]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.18...v1.3.19
[1.3.18]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.17...v1.3.18
[1.3.17]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.16...v1.3.17
[1.3.16]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.15...v1.3.16
[1.3.15]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.14...v1.3.15
[1.3.14]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.13...v1.3.14
[1.3.13]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.12...v1.3.13
[1.3.12]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.11...v1.3.12
[1.3.11]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.10...v1.3.11
[1.3.10]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.0...v1.3.10
[1.3.0]: https://github.com/mdzip-project/mdzip-studio/compare/v0.1.14...v1.3.0
[0.1.14]: https://github.com/mdzip-project/mdzip-studio/releases/tag/v0.1.14
