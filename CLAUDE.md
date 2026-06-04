# MDZip Studio - Development Guide

## Project Overview

MDZip Studio is a reference desktop application for the MDZip ecosystem, built with Electron, Angular, and TypeScript. It demonstrates best practices for creating, viewing, editing, and validating MDZip archives.

**References:**
- [MDZip Specification](https://github.com/mdzip-project/mdzip-spec)
- [MDZip Organization](https://github.com/mdzip-project)
- [MDZip Website](https://mdzip.org)

## Architecture

### Dependency Stack
```
mdzip-core-js (archive format library)
      ↓
mdzip-editor (markdown editor component)
      ↓
mdzip-studio (Electron + Angular desktop app)
```

### Technology Stack
- **Electron 27+**: Desktop application runtime
- **Angular 17**: UI framework with standalone components
- **TypeScript 5.2+**: Type-safe development
- **SCSS**: Styling
- **RxJS**: Reactive state management

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
│   │   │   ├── workspace/          # Main editor/preview container
│   │   │   ├── editor/             # Markdown editor
│   │   │   ├── preview/            # Markdown preview
│   │   │   ├── assets/             # Asset browser
│   │   │   ├── manifest/           # Manifest editor
│   │   │   ├── validation/         # Validation results display
│   │   │   └── dialogs/            # Dialog container
│   │   ├── app.component.ts        # Root component
│   │   ├── app.config.ts           # Angular app configuration
│   │   └── app.routes.ts           # Route configuration
│   ├── main.ts                     # Angular bootstrap
│   ├── index.html                  # Entry HTML
│   └── styles.scss                 # Global styles
├── electron/
│   ├── main.js                     # Electron main process
│   └── preload.js                  # IPC preload script
├── design/
│   └── MDZip Studio Plan.md        # Project plan and goals
├── package.json                    # Dependencies and scripts
├── angular.json                    # Angular CLI configuration
├── tsconfig.json                   # TypeScript configuration
├── karma.conf.js                   # Test runner
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
AppComponent (root)
├── NavigationComponent (left sidebar)
├── WelcomeComponent (home screen)
├── WorkspaceComponent (when archive open)
│   ├── EditorComponent (markdown editor)
│   ├── PreviewComponent (rendered markdown)
│   └── AssetBrowserComponent (file management)
├── DialogContainerComponent (modals)
│   ├── ManifestEditorComponent
│   └── ValidationResultComponent
└── StatusBar (footer)
```

## Phase 1 Implementation Status

### ✅ Complete
- [x] Project structure and setup
- [x] Electron main process
- [x] Angular app configuration
- [x] Core services (Archive, Validation, File, Storage, Dialog)
- [x] UI components (Navigation, Editor, Welcome, Workspace)
- [x] Manifest editor
- [x] Validation display
- [x] Asset browser
- [x] Document management

### 🔄 In Progress / TODO
- [ ] Electron IPC implementation (file dialogs, file I/O)
- [ ] Real markdown parser integration (marked or markdown-it)
- [ ] Archive save/load from filesystem
- [ ] Recent files persistence
- [ ] Theme support (light/dark mode)
- [ ] Keyboard shortcuts
- [ ] Settings dialog
- [ ] Split view (editor + preview side-by-side)

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
# 1. Start Angular dev server on http://localhost:4200
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

# Test configuration in karma.conf.js
```

## Key Implementation Notes

### State Management
- Uses RxJS BehaviorSubjects for reactive state
- AppComponent subscribes to services for state updates
- Components receive data via dependency injection

### Styling
- SCSS for component styles
- Global styles in `src/styles.scss`
- CSS variables for theming (planned)
- Flexbox for layout

### IPC (Electron ↔ Renderer)
- Preload script exposes safe API via `window.electronAPI`
- Main process handles file dialogs, file I/O
- Stubs in FileService need IPC implementation

## Next Steps for Implementation

1. **Implement Electron IPC**
   - File open/save dialogs
   - File system read/write
   - Archive loading and saving

2. **Integrate MDZip Libraries**
   - Add mdzip-core-js for archive parsing
   - Add mdzip-editor for markdown editing
   - Update Archive/File services to use them

3. **Add Markdown Parser**
   - Integrate `marked` or `markdown-it`
   - Update PreviewComponent rendering
   - Add syntax highlighting

4. **Enhance Editor**
   - Document tabs management
   - Unsaved changes detection
   - Save on Ctrl+S

5. **Settings/Preferences**
   - Create settings dialog
   - Theme selection
   - Keyboard shortcuts configuration

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

- [Angular 17 Docs](https://angular.io)
- [Electron Docs](https://www.electronjs.org/docs)
- [RxJS Docs](https://rxjs.dev)
- [MDZip Spec](https://github.com/mdzip-project/mdzip-spec)
