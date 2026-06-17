#!/usr/bin/env node
// Generates src/app/app-about-data.ts from the libraries that ship in the build
// and the project LICENSE file. Run automatically via prestart/prebuild.
//
// The renderer libraries (Angular, PrimeNG, mermaid, etc.) are bundled into
// dist/ by the Angular build and live in devDependencies — only electron-updater
// is a real runtime node_modules dependency (see package.json). So we can't key
// the credits off `dependencies` alone: we credit everything across both
// sections except the pure build-time tooling listed below.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const FIRST_PARTY_SCOPE = '@mdzip/';

// Build-only tooling that never ships to users, so it isn't credited in About.
const BUILD_ONLY = new Set([
  '@angular/build',
  '@angular/cli',
  '@angular/compiler-cli',
  '@types/node',
  'concurrently',
  'electron-builder',
  'jsdom',
  'typescript',
  'vitest',
  'wait-on',
]);

function readDependency(name) {
  try {
    const depPkg = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')
    );
    return {
      name,
      version: depPkg.version ?? 'unknown',
      license: typeof depPkg.license === 'string' ? depPkg.license : 'see package',
      homepage: depPkg.homepage ?? `https://www.npmjs.com/package/${name}`,
    };
  } catch {
    return { name, version: 'unknown', license: 'unknown', homepage: `https://www.npmjs.com/package/${name}` };
  }
}

const allDeps = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]
  .filter((name) => !BUILD_ONLY.has(name))
  .filter((name, index, names) => names.indexOf(name) === index)
  .sort();
const firstParty = allDeps.filter((name) => name.startsWith(FIRST_PARTY_SCOPE)).map(readDependency);
const thirdParty = allDeps.filter((name) => !name.startsWith(FIRST_PARTY_SCOPE)).map(readDependency);

let licenseText = '';
try {
  licenseText = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
} catch {
  licenseText = 'LICENSE file not found.';
}

const banner = '// GENERATED FILE — do not edit. Produced by scripts/generate-about-data.js.';
const output = `${banner}

export interface LibraryInfo {
  name: string;
  version: string;
  license: string;
  homepage: string;
}

export const APP_LICENSE_NAME = ${JSON.stringify(pkg.license ?? 'Apache-2.0')};

export const FIRST_PARTY_LIBRARIES: LibraryInfo[] = ${JSON.stringify(firstParty, null, 2)};

export const OPEN_SOURCE_LIBRARIES: LibraryInfo[] = ${JSON.stringify(thirdParty, null, 2)};

export const APP_LICENSE_TEXT = ${JSON.stringify(licenseText)};
`;

fs.writeFileSync(path.join(root, 'src', 'app', 'app-about-data.ts'), output);
console.log(`About data generated (${firstParty.length} first-party, ${thirdParty.length} third-party libraries)`);
