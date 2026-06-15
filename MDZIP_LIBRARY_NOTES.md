# MDZip Library Integration Notes

These came up while turning MDZip Studio into a working Angular app.

## Useful APIs Found

- `mdzip-core-js` exposes `MdzArchiveCore` and `MdzPackagerCore` for opening, validating, listing, reading, mutating, and building `.mdz` archives.
- `mdzip-editor` exposes archive helpers and `MdzipRenderingService`, which MDZip Studio now uses for preview rendering.

## Follow-Ups

- `mdzip-editor` currently opens a `.mdz` around a single resolved entry point. MDZip Studio needs a higher-level workspace open API that returns all Markdown documents, all assets with byte sizes/MIME types, manifest, validation, and orphaned asset analysis in one call.
- MDZip Studio tracks asset metadata in the UI, but it does not yet keep binary asset bytes in app state. A reusable browser-safe asset import/export workflow would help prevent each app from building this separately.
- `MdzipRenderingService` delegates to an injected renderer. A default safe Markdown renderer export from `mdzip-editor` would let MDZip Studio avoid maintaining a fallback renderer.

## Additional Library Wishes From Studio Work

### `mdzip-core-js`

- Provide a canonical "open workspace" model API for app shells. Studio currently reimplements flat ZIP entry parsing into documents, assets, MIME types, preview data URLs, editable metadata, and entry point selection. A `MdzArchiveCore.openWorkspace(bytes)` style helper could return a normalized object like `{ title, mode, manifest, documents, assets, validation }`.
- Provide a matching "build workspace" API. Studio now serializes manifest JSON in both the app shell and the `mdzip-editor` wrapper. A single `MdzPackagerCore.buildWorkspace(workspace)` API would prevent apps from duplicating manifest/spec/producer/title/mode/entryPoint behavior.
- Preserve and package binary assets from an in-memory workspace. Studio can list and thumbnail assets from opened `.mdz` files, but the simple packager path only rebuilds documents and `manifest.json`. Apps need a first-class way to round-trip untouched asset bytes and add imported assets.
- Expose MIME type and asset classification helpers. Studio currently maps image extensions to MIME types and guesses image assets in app code. This belongs close to archive entry metadata.
- Expose a browser-safe thumbnail/data URL helper at the workspace level. `readDataUri()` is useful, but apps still need to discover which entries are previewable and create media-library data efficiently.
- Provide spec-aware editable metadata helpers. Studio should not free-form edit the manifest, so it needs helpers to separate reserved MDZip fields from safe user metadata fields like author/description/tags.
- Provide a canonical manifest creation/update helper. Apps should be able to set title, mode, entry point, author, description, etc. without hand-assembling spec, producer, modified, and metadata fields.
- Provide a validation result shape that separates errors and warnings, plus status suitable for a save indicator. Studio currently adapts its own `ValidationService` and `mdzip-editor` snapshot validation into a common UI state.
- Consider path-tree utilities for documents/assets. Studio builds a tree from slash-delimited archive paths for the sidebar. That path normalization/sorting/folder inference could be shared.

### `mdzip-editor`

- Expose a host-friendly workspace wrapper or Angular component. Studio currently wraps `MdzipWorkspaceView` directly, wires callbacks, rebuilds bytes before opening, and manages lifecycle/revision tracking itself.
- Support opening a normalized workspace model directly, not only raw `.mdz` bytes. Studio already has documents/assets/manifest in memory, but has to repackage that model into bytes just to hand it back to the editor.
- Expose an explicit "get current bytes/snapshot" API for host Save. Studio relies on `onChanged`/`onSaved` callback payloads and caches the latest bytes. A direct `view.getCurrentArchive()` or `view.serialize()` would make native Save behavior cleaner.
- Provide a way for the host app to trigger editor save/flush before native file save. Desktop `Ctrl+S` should be able to ask the embedded editor for the latest edits, validation state, and bytes without opening a browser download.
- Make navigation pane behavior part of a documented host mode. Studio hides the built-in nav pane because it has its own document/media tree. A clear separation between embedded editor nav and host app nav would help.
- Surface all documents/assets/manifest changes as structured events. Studio needs to keep its sidebar, media tab, validation chip, and save state synchronized with editor changes.
- Provide asset/media-library primitives or events. The editor already understands embedded images; Studio needs a reusable way to add/import/delete/list media without duplicating asset management.
- Share manifest serialization with `mdzip-core-js`. The wrapper component and app shell both have local `toMdzManifest()` implementations. Editor-host integration should not require duplicating this logic.
- Provide a minimal desktop-host contract: dirty state, validation status, display title/current path, bytes, and lifecycle hooks for native Open/Save/Save As.
