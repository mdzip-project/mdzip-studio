import { describe, expect, it } from 'vitest';
import { rewriteHelpLinks } from './help-links.mjs';

const pages = [
  { slug: 'studio-help', file: 'index.md' },
  { slug: 'studio-getting-started', file: 'getting-started.md' },
  { slug: 'system-integration', file: 'system-integration.md' },
];

describe('rewriteHelpLinks', () => {
  it('points links to other help pages at their files in the archive', () => {
    expect(rewriteHelpLinks('See [System Integration](system-integration.html#opening-md-files).', pages))
      .toBe('See [System Integration](system-integration.md#opening-md-files).');
    expect(rewriteHelpLinks('[Start](studio-getting-started.html)', pages)).toBe('[Start](getting-started.md)');
  });

  it('sends other site links to mdzip.org', () => {
    expect(rewriteHelpLinks('[download page](../studio.html) and [the CLI](cli.html#install)', pages))
      .toBe('[download page](https://mdzip.org/studio.html) and [the CLI](https://mdzip.org/docs/cli.html#install)');
  });

  it('leaves full URLs, anchors and the page’s own images alone', () => {
    const text = '[a](https://pandoc.org) [b](#images) ![c](images/x.webp) [d](mailto:someone@example.org) [e](https://x.org "Title")';
    expect(rewriteHelpLinks(text, pages)).toBe(text);
  });
});
