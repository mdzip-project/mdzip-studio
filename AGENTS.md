# MDZip Studio - Development Guide

## Project Overview

MDZip Studio is a reference desktop application for the MDZip ecosystem, built with Electron, Angular, and TypeScript. It demonstrates best practices for creating, viewing, editing, and validating MDZip archives.

**References:**
- [MDZip Specification](https://github.com/mdzip-project/mdzip-spec)
- [MDZip Organization](https://github.com/mdzip-project)
- [MDZip Website](https://mdzip.org)

## Repository Boundaries

Do not modify sibling repositories (for example `mdzip-editor`, `mdzip-core-js`,
or `mdzip-mark`) unless the user explicitly asks for cross-repository edits.
When a requested change belongs in another MDZip repo, the normal procedure is
to file a GitHub issue or enhancement request in that repo and keep Studio
changes limited to this repository.

**Design documents** — read these before working on features or UI:
- [design/MDZip Studio Plan.md](design/MDZip%20Studio%20Plan.md) — goals, scope, and phased roadmap
- `design/UX.mdz` — UX designs and interaction specs (open in MDZip Studio to view)
- `design/Enhancements.mdz` — proposed enhancements and feature ideas (open in MDZip Studio to view)

## Architecture

### Dependency Stack
```
@mdzip/core-js (archive format library)
      ↓
@mdzip/editor (framework-independent workspace engine)
      ↓
@mdzip/editor-ng (Angular component wrapper)
      ↓
mdzip-studio (Electron + Angular desktop app)
```

### Technology Stack
- **Electron 42+**: Desktop application runtime
- **Angular 21**: UI framework with standalone components
- **TypeScript 5.9+**: Type-safe development
- **SCSS**: Styling
- **RxJS**: Reactive state management
- **PrimeNG 21**: UI component library

## Project Structure

```
mdzip-studio/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   └── services/           # Core business logic
│   │   │       ├── archive.service.ts     # Archive state management
│   │   │       ├── validation.service.ts  # Validation logic
│   │   │       ├── file.service.ts        # File I/O (Electron IPC)
│   │   │       ├── storage.service.ts     # Local storage/preferences
│   │   │       └── dialog.service.ts      # Modal dialogs
│   │   ├── modules/
│   │   │   ├── welcome/            # Home screen
│   │   │   ├── navigation/         # Left sidebar
│   │   │   ├── workspace/          # Workspace container
│   │   │   ├── editor/             # Markdown editor
│   │   │   ├── preview/            # Markdown preview
│   │   │   ├── assets/             # Asset browser
│   │   │   ├── manifest/           # Manifest editor
│   │   │   ├── validation/         # Validation results display
│   │   │   └── dialogs/            # Dialog container
│   │   ├── app.component.ts        # Root component (hosts MdzipWorkspaceComponent)
│   │   ├── app.config.ts           # Angular app configuration
│   │   └── app.routes.ts           # Route configuration
│   ├── main.ts                     # Angular bootstrap
│   ├── index.html                  # Entry HTML
│   └── styles.scss                 # Global styles
├── electron/
│   ├── main.js                     # Electron main process
│   └── preload.js                  # IPC preload script
├── design/
│   ├── editor-ng-request.md        # Open issues filed against @mdzip/editor-ng
│   └── MDZip Studio Plan.md        # Project plan and goals
├── package.json                    # Dependencies and scripts
├── angular.json                    # Angular CLI configuration
├── tsconfig.json                   # TypeScript configuration
├── vitest.config.ts                # Test runner (Vitest)
└── README.md                       # Usage documentation
```

## Core Services

### ArchiveService
Central state management for MDZip archives using RxJS BehaviorSubjects.

**Key Methods:**
- `createNewArchive(name, mode)` - Create new archive
- `openArchive(path)` - Load archive from file
- `addDocument(document)` - Add document to archive
- `updateDocument(id, content)` - Update document content
- `removeDocument(id)` - Delete document
- `addAsset(asset)` - Add asset to archive
- `removeAsset(id)` - Delete asset
- `updateManifest(manifest)` - Update archive manifest
- `saveArchive()` - Save archive to file
- `closeArchive()` - Close current archive

**Observable Streams:**
- `currentArchive$` - Current archive state
- `recentFiles$` - Recent files list

### ValidationService
Validates archives against MDZip specification.

**Key Methods:**
- `validateArchive(archive)` - Full archive validation
- `validateManifest(manifest)` - Manifest validation
- `validateMarkdown(content)` - Markdown content validation

Returns `ValidationResult` with errors array and valid flag.

### FileService
File I/O operations (currently stubs - needs Electron IPC implementation).

**Key Methods:**
- `openFile(filters)` - Show file open dialog
- `saveFile(defaultPath, filters)` - Show save dialog
- `readFile(path)` - Read file contents
- `writeFile(path, data)` - Write file contents
- `fileExists(path)` - Check file existence
- `directoryExists(path)` - Check directory existence

### StorageService
Local storage wrapper for preferences and state.

**Key Methods:**
- `setItem(key, value)` - Save to localStorage
- `getItem<T>(key, defaultValue)` - Load from localStorage
- `getRecentFiles()` - Get recent files list
- `addRecentFile(path)` - Add to recent files
- `setTheme(theme)` - Save theme preference

### DialogService
Modal dialog management.

**Key Methods:**
- `openManifestDialog(manifest)` - Edit manifest
- `openValidationDialog(data)` - Show validation results
- `closeDialog()` - Close modal
- `confirmDialog(message)` - Confirmation dialog

## Component Hierarchy

```
AppComponent (root — manages all archive state)
├── MdzipWorkspaceComponent (@mdzip/editor-ng, selector: mdzip-workspace)
│   └── MdzipWorkspaceView (@mdzip/editor — full editor UI rendered into a host div)
└── p-dialog (PrimeNG — "Create Document" modal)
```

The sidebar, tabs, media panel, and internals panel are all inline in `AppComponent`'s template. Standalone Angular modules from `src/app/modules/` exist but are not yet wired into the main app shell.

## Phase 1 Implementation Status

### ✅ Complete
- [x] Project structure and setup
- [x] Electron main process with IPC (open/save dialogs, file I/O)
- [x] Angular 21 app configuration with PrimeNG
- [x] Core services (Archive, Validation, Storage, Dialog)
- [x] `@mdzip/editor-ng` integrated as the workspace editor
- [x] `@mdzip/core-js` used for archive parsing and packaging
- [x] Archive open/save (Electron IPC + web file picker)
- [x] Internals panel (manifest fields, validation summary)
- [x] Media panel (asset tile/list view)
- [x] Document sidebar with tree view

### 🔄 In Progress / TODO
- [ ] Theme support (light/dark mode)
- [ ] Keyboard shortcuts
- [ ] Settings dialog
- [ ] Recent files list in welcome screen

### 📋 Phase 2+ (Future)
- [ ] Archive-wide search
- [ ] Manifest designer UI
- [ ] Archive inspector
- [ ] Spec conformance reporting
- [ ] AI context package builder
- [ ] Token analysis

## Development Workflow

### Running the Application

```bash
# Install dependencies
npm install

# Start development (Angular + Electron)
npm start

# This will:
# 1. Start Angular dev server on http://localhost:4300
# 2. Launch Electron app once Angular is ready
# 3. Open DevTools in Electron window
```

### Building for Production

```bash
# Build and package
npm run build

# Creates optimized bundles and Electron package
```

### Testing

```bash
# Run unit tests
npm test

# Test configuration in vitest.config.ts
```

## Key Implementation Notes

### State Management
- Uses Angular signals (`signal`, `computed`) for reactive state in `AppComponent`
- `ArchiveService` holds the in-memory `MDZipArchive` model (documents, assets, manifest)
- `workspaceBytes` signal holds the raw `.mdz` bytes passed to `<mdzip-workspace>`
- `latestWorkspaceBytes` caches the most recent bytes emitted by the editor (used for save)

### MDZip Library Integration
- `@mdzip/editor-ng` provides `<mdzip-workspace>` — pass `[bytes]`, `[mode]`, `[controls]`, etc.
- `@mdzip/editor` provides `MdzipWorkspaceView`, types (`MdzipWorkspaceSnapshot`, `MdzipWorkspaceChange`, etc.)
- `@mdzip/core-js` provides `MdzPackagerCore.buildArchive()` and `MdzArchiveCore.open()` for building/parsing `.mdz` files

### Styling
- SCSS for component styles
- Global styles in `src/styles.scss`
- PrimeNG theming via `@primeng/themes`
- Flexbox for layout

### IPC (Electron ↔ Renderer)
- Preload script exposes `window.mdzipStudio` with `openDocument` and `saveDocument`
- Main process handles file dialogs and file system read/write via `ipcMain.handle`

## Next Steps for Implementation

1. **Theme support**
   - Wire light/dark toggle to `initialColorScheme` on `<mdzip-workspace>`
   - Persist preference via `StorageService`

2. **Recent files welcome screen**
   - Surface `StorageService.getRecentFiles()` on the empty state
   - Allow reopening from the list

3. **Settings dialog**
   - Theme selection
   - Keyboard shortcuts reference

## Testing Strategy

- Unit tests for services (validation logic)
- Component tests for UI interactions
- Integration tests for archive workflow
- E2E tests for complete user flows

## Performance Considerations

- Archive loaded entirely in memory (OK for Phase 1)
- Lazy load large documents if needed
- Debounce markdown preview rendering
- Virtual scrolling for large asset lists (future)

## Security Notes

- Electron: contextIsolation enabled for security
- IPC: Explicit allowlist of exposed APIs
- File access: Only through Electron IPC (no direct FS)
- No eval/unsafe inline scripts

## Debugging

- DevTools open in Electron window (development)
- Console logs in both main and renderer processes
- Chrome DevTools for Angular component debugging
- Angular DevTools browser extension recommended

## Additional Resources

- [MDZip Studio Plan](design/MDZip%20Studio%20Plan.md)
- [Angular 21 Docs](https://angular.io)
- [Electron Docs](https://www.electronjs.org/docs)
- [RxJS Docs](https://rxjs.dev)
- [PrimeNG Docs](https://primeng.org)
- [MDZip Spec](https://github.com/mdzip-project/mdzip-spec)
