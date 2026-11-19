#!/usr/bin/env node
// Copies Studio's help pages from the mdzip.org repo, where they're written and
// published, into src/assets/help/, where Studio bundles them. Run it after
// changing a page on mdzip.org (npm run sync:help); --check only reports
// whether the bundled copies match. Needs mdzip.org checked out next to this
// repo (../mdzip.org), or its path in MDZIP_ORG_DIR.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.resolve(process.env.MDZIP_ORG_DIR || path.join(ROOT, '..', 'mdzip.org'));
// [source in mdzip.org, bundled copy in this repo]
const PAGES = [['docs-src/system-integration.mdz', 'src/assets/help/system-integration.mdz']];
const check = process.argv.includes('--check');

let stale = 0;
for (const [from, to] of PAGES) {
  const source = path.join(SITE, from);
  const target = path.join(ROOT, to);
  if (!fs.existsSync(source)) {
    console.error(`Not found: ${source}. Check out mdzip.org next to this repo, or set MDZIP_ORG_DIR.`);
    process.exit(2);
  }
  const same = fs.existsSync(target) && fs.readFileSync(source).equals(fs.readFileSync(target));
  if (same) {
    console.log(`Up to date: ${to}`);
  } else if (check) {
    console.log(`Out of date: ${to} (run npm run sync:help)`);
    stale += 1;
  } else {
    fs.copyFileSync(source, target);
    console.log(`Updated: ${to} from mdzip.org/${from}`);
  }
}
process.exit(stale ? 1 : 0);
