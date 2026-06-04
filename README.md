# MDZip Studio

Reference desktop application for the MDZip ecosystem.

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Electron 27+
- Angular 17+

### Installation

```bash
npm install
```

### Development

Start the development server and Electron:

```bash
npm start
```

This will:
1. Start the Angular dev server on `http://localhost:4200`
2. Launch the Electron application once Angular is ready

### Building

Build the application for distribution:

```bash
npm run build
```

This creates optimized Angular builds and prepares them for Electron packaging.

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
├── dist/                 # Build output
├── package.json          # Dependencies and scripts
├── angular.json          # Angular configuration
├── tsconfig.json         # TypeScript configuration
├── karma.conf.js         # Test runner configuration
└── README.md             # This file
```

## Architecture

MDZip Studio is built with:

- **Electron**: Desktop application shell
- **Angular**: UI framework
- **TypeScript**: Type-safe development
- **mdzip-core-js**: Archive format library
- **mdzip-editor**: Markdown editor component

### Dependency Hierarchy

```
mdzip-core-js
      ↓
mdzip-editor
      ↓
mdzip-studio (Electron + Angular)
```

## Phase 1 Features (MVP)

- [x] Application structure and setup
- [ ] Open MDZip archive
- [ ] Create new MDZip archive
- [ ] Browse archive contents
- [ ] View and edit Markdown
- [ ] Manage assets
- [ ] Edit manifest
- [ ] Validate archive
- [ ] Save archive

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

See LICENSE file for details
