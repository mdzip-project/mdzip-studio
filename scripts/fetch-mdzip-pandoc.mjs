// Downloads the mdzip-pandoc release Studio's Import and Export use (mdz.lua,
// docx.lua and the mdzip-core-lua library they need) into vendor/mdzip-pandoc.
// The folder is committed; run this to move to another release:
//
//   node scripts/fetch-mdzip-pandoc.mjs 0.7.0
//   node scripts/fetch-mdzip-pandoc.mjs 0.8.0 ../mdzip-pandoc/dist/mdzip-pandoc-0.8.0.zip
//
// The second form takes a release download built locally (pandoc lua
// tools/bundle.lua in mdzip-pandoc), to try a release before it's published.
//
// electron-builder copies the folder next to the app (extraResources), outside
// app.asar, because Pandoc, a separate program, reads the files.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Already installed: @mdzip/core-js depends on it.
import { unzipSync } from 'fflate';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: node scripts/fetch-mdzip-pandoc.mjs <version> [local release zip]   (for example 0.7.0)');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'vendor', 'mdzip-pandoc');
const url = `https://github.com/mdzip-project/mdzip-pandoc/releases/download/v${version}/mdzip-pandoc-${version}.zip`;

const localZip = process.argv[3];
let zipBytes;
if (localZip) {
  zipBytes = new Uint8Array(readFileSync(localZip));
} else {
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Could not download ${url}: HTTP ${response.status}`);
    process.exit(1);
  }
  zipBytes = new Uint8Array(await response.arrayBuffer());
}

const prefix = `mdzip-pandoc-${version}/`;
const files = unzipSync(zipBytes);
if (!files[`${prefix}mdz.lua`]) {
  console.error(`The release has no ${prefix}mdz.lua`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
for (const [name, bytes] of Object.entries(files)) {
  if (!name.startsWith(prefix) || name.endsWith('/')) continue;
  const relative = name.slice(prefix.length);
  if (relative.split('/').includes('..')) continue;
  const out = path.join(target, ...relative.split('/'));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, bytes);
}
writeFileSync(path.join(target, 'VERSION'), `${version}\n`);
console.log(`vendor/mdzip-pandoc is now mdzip-pandoc ${version}`);
