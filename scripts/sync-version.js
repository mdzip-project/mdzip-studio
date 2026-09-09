#!/usr/bin/env node
// Writes src/app/app-version.ts from the current package.json version.
// Does NOT change the version — bumping is an explicit release step
// (`npm version patch`, which then runs this via the "version" hook).
// Also runs on the "prebuild" hook so a dev build always embeds the
// version that is actually in package.json.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const versionFile = path.join(root, 'src', 'app', 'app-version.ts');
const next = `export const APP_VERSION = '${pkg.version}';\n`;

const current = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8') : '';
if (current !== next) {
  fs.writeFileSync(versionFile, next);
  console.log(`app-version.ts synced to ${pkg.version}`);
} else {
  console.log(`app-version.ts already at ${pkg.version}`);
}
