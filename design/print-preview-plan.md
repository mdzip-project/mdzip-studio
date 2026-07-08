# Print with Print Preview for MDZip Studio

## Context

MDZip Studio (Electron + Angular, `mdzip-studio/`) has no way to print an open document. Goal: **File → Print… (Ctrl+P)** that opens a **paginated, page-accurate print preview**, from which the user prints (or saves a PDF). Decisions confirmed with the user:

- **Preview style**: PDF-based — render the document to PDF via Electron's `printToPDF`, show it in a preview window using Chromium's built-in PDF viewer (zoom, page nav, print button → system print dialog, plus free "Save as PDF").
- **Page setup**: V1 uses defaults only (Letter, portrait, default margins); no page-setup UI.

## Architecture

```
Ctrl+P / File→Print (native menu, main.js)
  → dispatchAppEvent('mdzip-studio:print')                    [existing pattern]
  → AppComponent handler:
      1. flushWorkspaceEdits()                                 [existing, app.component.ts:2446 — pulls unsaved typing into bytes]
      2. bytes = latestWorkspaceBytes() ?? workspaceBytes(); for .mdz where
         snapshot.currentPath ≠ manifest entryPoint, patch entryPoint into the
         bytes (same MdzArchiveCore.updateFiles pattern as patchManifestIntoBytes,
         app.component.ts:2468) so print renders the entry being viewed
      3. mount a hidden, off-screen read-only <mdzip-workspace> with those bytes:
         controls="preview" initialLayout="preview" initialColorScheme="light"
         [markdownExtensions]="markdownExtensions" imageHydrationAnimation="off"
      4. on (assetsHydrated): capture its `.preview-content` element
      5. PrintService.buildPrintDocument(element, title):
         clone DOM → inline blob: images as data: URIs (fetch → base64) →
         wrap in standalone HTML with embedded print CSS
      6. window.mdzipStudio.printPreview({ html, title })      [new preload API]
      7. tear down the hidden workspace
  → main.js 'mdzip:print-preview' handler:
      temp .html → hidden BrowserWindow → did-finish-load + document.fonts.ready
      → printToPDF({ printBackground: true, pageSize: 'Letter' }) → temp .pdf
      → preview BrowserWindow (plugins: true) loads the PDF in Chromium's viewer
```

**Why a hidden capture workspace instead of scraping the visible preview:** works in any layout (the visible preview isn't mounted in source-only layout — `setLayout` re-renders the whole view), always renders **light** (the visible preview in dark mode bakes dark colors into Mermaid SVGs), and the editor README explicitly steers hosts toward lifecycle signals (`assetsHydrated`) over scraping the live editor's internal DOM. Studio already runs a second preview-only `mdzip-workspace` for its Help dialog (app.component.ts:826), so this is an established pattern.

## Changes

### 1. `electron/main.js`
- **Menu**: in the `documentOpen`-gated block of `fileSubmenu` (after Save As…), add:
  `{ label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => dispatchAppEvent('mdzip-studio:print') }` + separator.
- **IPC** `ipcMain.handle('mdzip:print-preview', …)` with `{ html, title }`:
  - Write `html` to a temp file (`app.getPath('temp')`, unique name) — avoids `data:` URL size limits.
  - Hidden `BrowserWindow` (`show:false`, sandboxed, no node/preload), `loadFile`, await `did-finish-load`, then `executeJavaScript('document.fonts.ready.then(() => undefined)')` so fonts settle.
  - `printToPDF({ printBackground: true, pageSize: 'Letter' })`; destroy hidden window; delete temp html.
  - Write PDF to a temp file; open/reuse a single **preview window** (`~900×1000`, title `Print Preview — <title>`, `webPreferences: { plugins: true, contextIsolation: true, sandbox: true }`) and `loadURL(pathToFileURL(pdfPath))` — Chromium's PDF viewer supplies zoom/page-nav/print/save UI.
  - Cleanup: delete the PDF temp when the preview window closes; sweep leftover temp files on `will-quit`. Return `{ ok: true }` / `{ error }`.

### 2. `electron/preload.js`
- Add `printPreview: (payload) => ipcRenderer.invoke('mdzip:print-preview', payload)`.

### 3. New `src/app/core/services/print.service.ts`
- `buildPrintDocument(previewRoot: HTMLElement, title: string): Promise<string>`:
  - Deep-clone `previewRoot`, strip editor-only artifacts (image hydration slot wrappers/classes, any interactive chrome).
  - Replace every `img[src^="blob:"]` with a `data:` URI (fetch blob → base64). Keep `data:` srcs as-is; leave http(s) untouched.
  - Wrap in a full HTML document: `<title>`, `<meta charset>`, embedded `PRINT_CSS`.
- `PRINT_CSS`: light, GitHub-style document typography (headings, paragraphs, lists, tables with borders, blockquote, inline/fenced code, task lists, hr, images/SVG max-width 100%) + print pagination rules: `h1–h3 { break-after: avoid }`, `pre, table, blockquote, img, svg { break-inside: avoid }`. Code prints monochrome in V1 (highlight token colors are editor-internal CSS; acceptable for print, extensible later).
- Structure the blob→data resolution as an injectable/mockable step so it unit-tests under jsdom.

### 4. `src/app/app.component.ts`
- Register `mdzip-studio:print` window listener alongside the others (add/remove at app.component.ts:1228/1276 blocks) → `handlePrintCommand`.
- `printCapture` signal `{ bytes: Uint8Array } | null`; template gains an off-screen container (`position: fixed; left: -10000px; width: 900px` — needs real layout for Mermaid measurement, so not `display:none`) rendering the hidden capture `<mdzip-workspace>` when set, with `(assetsHydrated)` → capture + send, `(failed)` → error status.
- `handlePrintCommand`: guard `currentArchive()`; status message "Preparing print preview…" (existing `statusMessage` pattern); flush; compute bytes (+ entryPoint patch for .mdz when viewing a non-entry document); set `printCapture`; add a timeout guard (~15 s) so a stuck render doesn't leave the app wedged; on IPC result, clear status or show failure.
- Non-Electron (browser) mode: no-op in V1 — the in-app browser menubar doesn't get a Print item; native menu only exists in Electron.

### 5. Tests (`vitest`, colocated `*.test.ts` per existing convention)
- `print.service.test.ts`: wrapping produces a complete standalone document; blob images are inlined via the mocked resolver; editor-only artifacts are stripped; title is escaped.

### 6. `CHANGELOG.md`
- Add entry under a new version heading following the existing format.

## Edge cases handled
- Unsaved edits print correctly (`flushWorkspaceEdits` first, same as Save).
- .mdz: prints the **currently viewed document entry** (manifest entryPoint patched into the print-render bytes only; the real document is untouched).
- Dark mode: preview/PDF always renders light (hidden workspace forced `initialColorScheme="light"`; Mermaid `theme: 'auto'` follows it).
- Source-only layout: works — capture doesn't depend on the visible preview pane.
- Mermaid diagrams and archive/relative images: rendered + hydrated by the hidden workspace via the same `markdownExtensions`, then inlined as data: URIs.
- No document open: menu item hidden (existing `documentOpen` menu gating).

## Verification
1. `npm start` in `mdzip-studio/` (dev Electron + ng serve on :4300).
2. Open a `.md` with headings, a table, code fences, a Mermaid block, and relative images → Ctrl+P → preview window shows paginated light-theme pages with images + diagram; print button opens the system dialog; save button exports the PDF.
3. Type unsaved text, print again → new text appears.
4. Open a `.mdz`, select a non-entry document, print → that document (not the entry point) is rendered.
5. Switch the editor to source-only layout and dark mode → print still renders (light).
6. Close preview window and re-print → window reopens; temp files in `%TEMP%` are cleaned up after closing.
7. `npm test` for the new service tests; `npm run lint`.
