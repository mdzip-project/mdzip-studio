# MDZip Studio

Reference desktop application for the MDZip ecosystem.

## Installing (Windows)

Download the latest `MDZip Studio Setup <version>.exe` from the
[Releases page](https://github.com/mdzip-project/mdzip-studio/releases/latest)
and run it.

> **"Windows protected your PC" / "isn't commonly downloaded"** — the installer
> is not signed with a reputation-bearing certificate, so Microsoft SmartScreen
> warns on first download. This is expected and does not indicate a problem with
> the file. To proceed: in the browser's download list choose **Keep**, then on
> the SmartScreen prompt click **More info → Run anyway**.

Once installed, MDZip Studio **updates itself**: it checks for new releases on
startup (and via **Help → Check for Updates…**), then downloads and installs
them on the next restart.

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

> **After updating a bundled `@mdzip/*` dependency (editor, editor-ng, core-js),
> fully restart `npm start`.** The Angular dev server bundles these into the app
> when it boots and does **not** pick up `node_modules` changes while running, so
> the editor in the Electron window keeps showing the old version until the dev
> server is restarted. If a restart doesn't seem to take effect, make sure there
> isn't an **orphaned `ng serve` still holding port 4300** from a previous
> session — a stale server makes Electron load the old bundle. Check with
> `Get-NetTCPConnection -LocalPort 4300 -State Listen` and stop that process, or
> clear `.angular/cache` and restart. (`npm start` now uses
> `concurrently --kill-others`, so closing the Electron window also stops the dev
> server — this should keep orphans from accumulating.)

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
- Render Mermaid diagrams (` ```mermaid ` blocks) inline in the preview
- Manage embedded assets and images
- Edit archive manifest metadata
- Validate archives against the MDZip specification
- Convert a Markdown file into an `.mdz` archive
- Read-only files are indicated in the title and protected from accidental
  in-place saves (Save As writes a copy)

### Desktop integration (Windows)

- `.mdz` file association — double-click to open in MDZip Studio
- `.md` files list MDZip Studio under **Open with**; an optional installer
  checkbox can also make it the default `.md` editor (Windows protects an
  existing default, so it applies only when `.md` has no current association)
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
