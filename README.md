# MDZip Studio

Reference desktop application for the MDZip ecosystem.

## Getting Started

### Prerequisites

- Node.js 20+ and npm (the Angular/Electron toolchain is installed via `npm install`)

For building the Windows installer only (see below), you also need:
- .NET 8 SDK
- The sibling [`mdzip-win-prev`](https://github.com/mdzip-project) repository checked out next to this one (or pointed to via `MDZIP_WIN_PREV_DIR`), which provides the Explorer preview handler

### Installation

```bash
npm install
```

### Development

Start the Angular dev server and Electron together:

```bash
npm start
```

This will:
1. Start the Angular dev server on `http://localhost:4300`
2. Launch the Electron application once Angular is ready

`npm start` does **not** require the preview-handler prerequisites above.

### Building

Build just the web bundle:

```bash
npm run build:angular
```

Build the full Windows installer:

```bash
npm run build
```

This bumps the patch version, regenerates about-data, builds the preview handler
(`dotnet publish` of the sibling `mdzip-win-prev` project into
`build/preview-handler/`), produces the production Angular bundle, and packages a
signed-capable NSIS installer under `dist/`.

> The full installer build requires the .NET 8 SDK and the `mdzip-win-prev`
> sibling repo. Without them the `build:preview-handler` step fails with a clear
> message — use `npm run build:angular` / `npm start` if you only need the app
> itself. Installers are currently shipped unsigned.

### Testing

Run the test suite:

```bash
npm test
```

## Project Structure

```
mdzip-studio/
├── src/                    # Angular application source
│   ├── app/               # Angular components and services
│   │   ├── app.component.ts
│   │   ├── app.config.ts
│   │   └── app.routes.ts
│   ├── styles.scss        # Global styles
│   ├── index.html         # Entry HTML
│   └── main.ts            # Angular bootstrap
├── electron/              # Electron main process
│   ├── main.js           # Main process entry
│   └── preload.js        # IPC preload script
├── scripts/              # Build helpers (version bump, about-data, preview handler)
├── build/                # Installer resources (icon, installer.nsh)
├── dist/                 # Build output (git-ignored)
├── package.json          # Dependencies and scripts
├── angular.json          # Angular configuration
├── tsconfig.json         # TypeScript configuration
├── vitest.config.ts      # Test runner configuration
└── README.md             # This file
```

## Architecture

MDZip Studio is built with:

- **Electron**: Desktop application shell
- **Angular**: UI framework
- **TypeScript**: Type-safe development
- **@mdzip/core-js**: Archive format library
- **@mdzip/editor**: Framework-independent workspace engine
- **@mdzip/editor-ng**: Angular component wrapper

## Markdown Support

MDZip Studio supports standard Markdown editing with CommonMark syntax and previews content with GitHub Flavored Markdown-style rendering.

- CommonMark-based editing
- GFM-style preview rendering
- Sanitized HTML output
- Highlighted fenced code blocks
- Common Markdown extras such as tables, task lists, strikethrough, and autolinks

### Dependency Hierarchy

```
@mdzip/core-js
      ↓
@mdzip/editor
      ↓
@mdzip/editor-ng
      ↓
mdzip-studio (Electron + Angular)
```

## Features

- Create, open, and save `.mdz` archives and standalone Markdown files
- Browse archive contents (documents and assets) in a tree view
- Edit Markdown with a live split editor/preview
- Manage embedded assets and images
- Edit archive manifest metadata
- Validate archives against the MDZip specification
- Convert a Markdown file into an `.mdz` archive
- Read-only files are indicated in the title and protected from accidental
  in-place saves (Save As writes a copy)

### Desktop integration (Windows)

- `.mdz` file association — double-click to open in MDZip Studio
- Optional Explorer **preview handler** for `.mdz` files (all-users install)
- Native Open/Save dialogs and menus

## References

- [MDZip Organization](https://github.com/mdzip-project)
- [MDZip Specification](https://github.com/mdzip-project/mdzip-spec)
- [MDZip Website](https://mdzip.org)

## Development Guidelines

- Favor simplicity and transparency
- Focus on spec compliance
- Demonstrate MDZip best practices
- Avoid feature bloat

## License

Apache License 2.0 — see the [LICENSE](LICENSE) file for details.
