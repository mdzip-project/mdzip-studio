#!/usr/bin/env node
// Builds Studio's help archive, src/assets/help/mdzip-studio-help.mdz, from
// the mdzip.org docs pages listed in src/app/modules/help/help-pages.ts: one
// project-mode .mdz with each page as its own file and index.md as the
// contents page, so the help window moves between pages with the editor's
// file list and links.
// Links between help pages point inside the archive; other site links go to
// mdzip.org (scripts/help-links.mjs).
//
//   npm run sync:help             rebuild it after changing a page on mdzip.org
//   npm run sync:help -- --check  only report whether it's up to date
//
// Needs mdzip.org checked out next to this repo (../mdzip.org), or its path in
// MDZIP_ORG_DIR, and Node 22.18 or later (it imports help-pages.ts directly).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MdzArchiveCore, MdzPackagerCore } from '@mdzip/core-js';
import { rewriteHelpLinks } from './help-links.mjs';
import { HELP_ARCHIVE_TITLE, HELP_PAGES } from '../src/app/modules/help/help-pages.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.resolve(process.env.MDZIP_ORG_DIR || path.join(ROOT, '..', 'mdzip.org'));
const TARGET = path.join(ROOT, 'src', 'assets', 'help', 'mdzip-studio-help.mdz');
const check = process.argv.includes('--check');

// Every file the help archive should hold: path → bytes.
async function helpFiles() {
  const files = new Map();
  const encoder = new TextEncoder();
  for (const page of HELP_PAGES) {
    const source = path.join(SITE, 'docs-src', `${page.slug}.mdz`);
    if (!fs.existsSync(source)) {
      throw new Error(`Not found: ${source}. Check out mdzip.org next to this repo, or set MDZIP_ORG_DIR.`);
    }
    const archive = await MdzArchiveCore.open(new Uint8Array(fs.readFileSync(source)));
    const manifest = await archive.readManifest();
    const entryPoint = manifest?.entryPoint;
    if (!entryPoint) throw new Error(`${source}: no entry point in its manifest`);
    files.set(page.file, encoder.encode(rewriteHelpLinks(await archive.readText(entryPoint), HELP_PAGES)));
    // The page's own files (images), at the same paths. Its README.md,
    // AGENTS.md and other Markdown aren't help pages.
    for (const entry of archive.listPaths()) {
      if (entry === 'manifest.json' || MdzArchiveCore.isMarkdownFile(entry)) continue;
      if (files.has(entry)) throw new Error(`${source}: ${entry} is also in another help page; give one of them another name`);
      files.set(entry, await archive.readBytes(entry));
    }
  }
  return files;
}

// The help archive's files now, or null when there isn't one.
async function currentFiles() {
  if (!fs.existsSync(TARGET)) return null;
  const archive = await MdzArchiveCore.open(new Uint8Array(fs.readFileSync(TARGET)));
  const files = new Map();
  for (const entry of archive.listPaths()) {
    if (entry !== 'manifest.json') files.set(entry, await archive.readBytes(entry));
  }
  return files;
}

function sameFiles(a, b) {
  if (!a || !b || a.size !== b.size) return false;
  for (const [entry, bytes] of a) {
    const other = b.get(entry);
    if (!other || Buffer.compare(Buffer.from(bytes), Buffer.from(other)) !== 0) return false;
  }
  return true;
}

const wanted = await helpFiles();
if (sameFiles(wanted, await currentFiles())) {
  console.log(`Up to date: ${path.relative(ROOT, TARGET)} (${HELP_PAGES.length} pages)`);
  process.exit(0);
}
if (check) {
  console.log(`Out of date: ${path.relative(ROOT, TARGET)} (run npm run sync:help)`);
  process.exit(1);
}

const result = await MdzPackagerCore.buildArchive(
  [...wanted].map(([entry, bytes]) => ({ path: entry, data: bytes })),
  HELP_ARCHIVE_TITLE,
  {
    createIndex: false,
    mapFiles: false,
    filters: ['**/*'],
    title: HELP_ARCHIVE_TITLE,
    mode: 'project',
    entryPoint: 'index.md',
    language: 'en',
  },
);
fs.writeFileSync(TARGET, new Uint8Array(await result.blob.arrayBuffer()));
console.log(`Updated: ${path.relative(ROOT, TARGET)} from ${HELP_PAGES.length} mdzip.org pages (${result.archivePaths.length} files)`);
