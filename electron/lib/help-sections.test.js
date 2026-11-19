// Studio's bundled help (src/assets/help/help.mdz, from npm run sync:help):
// every help page is in it, and every (?) in Help > System Integration lands
// on a heading of the System Integration page. A heading renamed on mdzip.org
// changes its id, and fails here instead of opening the page at the top.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MdzArchiveCore } from '@mdzip/core-js';
import { assignMdzipHeadingIds, collectMdzipHeadingIds, tokenizeMdzipMarkdown } from '@mdzip/renderer';
import { HELP_PAGES } from '../../src/app/modules/help/help-pages';
import { readHelpContents } from '../../src/app/modules/help/help-contents';
import { HELP_SECTIONS } from '../../src/app/modules/system-integration/help-sections';

const HELP = path.join(__dirname, '..', '..', 'src', 'assets', 'help', 'help.mdz');

async function openHelp() {
  return MdzArchiveCore.open(new Uint8Array(fs.readFileSync(HELP)));
}

async function headingIds(archive, file) {
  const tokens = tokenizeMdzipMarkdown(await archive.readText(file));
  assignMdzipHeadingIds(tokens);
  return collectMdzipHeadingIds(tokens);
}

describe('Studio help', () => {
  it('is a valid project with every help page, opening at the contents', async () => {
    const archive = await openHelp();
    expect((await archive.validate()).isValid).toBe(true);
    const manifest = await archive.readManifest();
    expect(manifest).toMatchObject({ mode: 'project', entryPoint: 'index.md' });
    for (const page of HELP_PAGES) expect(archive.hasEntry(page.file)).toBe(true);
  });

  it('lists every page and its main sections for the contents dropdown', async () => {
    const contents = await readHelpContents(new Uint8Array(fs.readFileSync(HELP)));
    expect(contents.map((page) => page.file)).toEqual(HELP_PAGES.map((page) => page.file));
    const integration = contents.find((page) => page.file === 'system-integration.md');
    expect(integration.sections.map((section) => section.id)).toEqual([
      'opening-md-files', 'explorer-previews', 'outlook-attachments', 'helper-programs', 'for-administrators',
    ]);
    expect(integration.sections[0].text).toBe('Opening .md files');
  });

  it('has a heading for every System Integration (?)', async () => {
    const ids = await headingIds(await openHelp(), 'system-integration.md');
    const missing = Object.entries(HELP_SECTIONS).filter(([, anchor]) => !ids.includes(anchor));
    expect(missing).toEqual([]);
  });

  it('links between pages only to files and headings that are there', async () => {
    const archive = await openHelp();
    const problems = [];
    for (const page of HELP_PAGES) {
      const text = await archive.readText(page.file);
      for (const [, file, anchor] of text.matchAll(/\]\(([a-z0-9-]+\.md)(?:#([^)\s]+))?\)/g)) {
        if (!archive.hasEntry(file)) problems.push(`${page.file}: ${file}`);
        else if (anchor && !(await headingIds(archive, file)).includes(anchor)) problems.push(`${page.file}: ${file}#${anchor}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
