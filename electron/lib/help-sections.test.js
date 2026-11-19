// Every "Learn more" in Help > System Integration must land on a heading in
// the bundled help page. A renamed heading on mdzip.org (synced in with
// npm run sync:help) changes its id, and fails here instead of silently
// opening the page at the top.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MdzArchiveCore } from '@mdzip/core-js';
import { assignMdzipHeadingIds, collectMdzipHeadingIds, tokenizeMdzipMarkdown } from '@mdzip/renderer';
import { HELP_SECTIONS } from '../../src/app/modules/system-integration/help-sections';

const PAGE = path.join(__dirname, '..', '..', 'src', 'assets', 'help', 'system-integration.mdz');

async function headingIds(file) {
  const archive = await MdzArchiveCore.open(new Uint8Array(fs.readFileSync(file)));
  const manifest = await archive.readManifest();
  const tokens = tokenizeMdzipMarkdown(await archive.readText(manifest.entryPoint));
  assignMdzipHeadingIds(tokens);
  return collectMdzipHeadingIds(tokens);
}

describe('System Integration help page', () => {
  it('has a heading for every card’s Learn more', async () => {
    const ids = await headingIds(PAGE);
    const missing = Object.entries(HELP_SECTIONS).filter(([, anchor]) => !ids.includes(anchor));
    expect(missing).toEqual([]);
  });
});
