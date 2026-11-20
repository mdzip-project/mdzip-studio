import { MdzPackagerCore } from '@mdzip/core-js';
import { describe, expect, it } from 'vitest';
import { readDocumentContents, resolveArchiveLink } from './document-contents';

async function buildMdz(files: { path: string; text: string }[], mode: 'document' | 'project', entryPoint = 'index.md') {
  const built = await MdzPackagerCore.buildArchive(files, 'Guide', {
    createIndex: false, mapFiles: false, filters: ['**/*'], title: 'Guide', mode, entryPoint,
  });
  return new Uint8Array(await built.blob.arrayBuffer());
}

describe('readDocumentContents', () => {
  it('orders a project by its links from the entry point, then the rest alphabetically', async () => {
    const bytes = await buildMdz([
      { path: 'index.md', text: '# The Guide\n\nRead [setup](docs/setup.md#install), then [usage](usage.md).\n' },
      { path: 'usage.md', text: '# Usage\n\n## Basics\n\n## Advanced\n\nBack to [setup](./docs/setup.md).\n' },
      { path: 'docs/setup.md', text: '# Setup\n\n## Install\n\nSee the [FAQ](../faq.md) and [mdzip.org](https://mdzip.org).\n' },
      { path: 'faq.md', text: '# FAQ\n' },
      { path: 'appendix.md', text: 'No heading here.\n' },
      { path: 'README.md', text: '# Readme\n' },
    ], 'project');

    const contents = await readDocumentContents(bytes, 'guide.mdz');

    expect(contents.map((page) => page.file)).toEqual(['index.md', 'docs/setup.md', 'usage.md', 'faq.md', 'appendix.md']);
    expect(contents.map((page) => page.title)).toEqual(['The Guide', 'Setup', 'Usage', 'FAQ', 'appendix']);
    expect(contents[2].sections).toEqual([{ id: 'basics', text: 'Basics' }, { id: 'advanced', text: 'Advanced' }]);
  });

  it('lists only the entry point of a document-mode archive', async () => {
    const bytes = await buildMdz([
      { path: 'index.md', text: '# Report\n\n## Summary\n\nSee [notes](notes.md).\n' },
      { path: 'notes.md', text: '# Notes\n' },
    ], 'document');

    const contents = await readDocumentContents(bytes, 'report.mdz');
    expect(contents).toEqual([{ file: 'index.md', title: 'Report', sections: [{ id: 'summary', text: 'Summary' }] }]);
  });

  it('reads a .md file as one page, with its # headings as sections when it has no ## ones', async () => {
    const contents = await readDocumentContents(new TextEncoder().encode('# Notes\n\nText\n\n# Later\n'), 'notes.md');
    expect(contents).toEqual([{ file: 'notes.md', title: 'Notes', sections: [{ id: 'later', text: 'Later' }] }]);
  });

  it('leaves out YAML front matter, and takes the title from it when there is no # heading', async () => {
    const withHeading = '---\ntitle: Understanding Front Matter\nauthor: Someone\n---\n\n# Front Matter\n\n## Basic syntax\n';
    expect(await readDocumentContents(new TextEncoder().encode(withHeading), 'front-matter.md')).toEqual([
      { file: 'front-matter.md', title: 'Front Matter', sections: [{ id: 'basic-syntax', text: 'Basic syntax' }] },
    ]);
    const withoutHeading = '---\ntitle: Understanding Front Matter\n---\n\n## Basic syntax\n';
    expect((await readDocumentContents(new TextEncoder().encode(withoutHeading), 'front-matter.md'))[0].title).toBe('Understanding Front Matter');
  });

  it('uses the titles it is given', async () => {
    const contents = await readDocumentContents(new TextEncoder().encode('# Getting Started with Studio\n'), 'getting-started.md', {
      titles: { 'getting-started.md': 'Getting Started' },
    });
    expect(contents[0].title).toBe('Getting Started');
  });
});

describe('resolveArchiveLink', () => {
  it('resolves relative links from the page folder, and leaves URLs and paths past the root alone', () => {
    expect(resolveArchiveLink('docs/', '../faq.md#top')).toBe('faq.md');
    expect(resolveArchiveLink('docs/', './a%20b.md')).toBe('docs/a b.md');
    expect(resolveArchiveLink('', 'https://mdzip.org/x.md')).toBeNull();
    expect(resolveArchiveLink('', '../outside.md')).toBeNull();
    expect(resolveArchiveLink('', '/abs.md')).toBeNull();
    expect(resolveArchiveLink('', '#section')).toBeNull();
  });
});
