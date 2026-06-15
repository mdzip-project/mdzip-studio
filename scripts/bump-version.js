#!/usr/bin/env node
// Increments the patch version in package.json and writes src/app/app-version.ts.
// Run automatically via the "prebuild" npm lifecycle hook.

const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const [major, minor, patch] = pkg.version.split('.').map(Number);
pkg.version = `${major}.${minor}.${patch + 1}`;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const versionFile = path.join(__dirname, '..', 'src', 'app', 'app-version.ts');
fs.writeFileSync(versionFile, `export const APP_VERSION = '${pkg.version}';\n`);

console.log(`Version bumped to ${pkg.version}`);
