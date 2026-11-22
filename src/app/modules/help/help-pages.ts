// Studio's help: these mdzip.org docs pages, packed into one project-mode
// archive (src/assets/help/mdzip-studio-help.mdz) by
// scripts/sync-help-docs.mjs, so the help window can move between them with
// the editor's file list and links.
// Plain data, no Angular: the sync script and the Electron tests import it too.

export interface HelpPage {
  // The page on mdzip.org: docs-src/<slug>.mdz, published at docs/<slug>.html.
  slug: string;
  // Its file in the help archive.
  file: string;
  // Its name in the help window's strip.
  title: string;
}

export const HELP_PAGES: readonly HelpPage[] = [
  { slug: 'studio-help', file: 'index.md', title: 'MDZip Studio Help' },
  { slug: 'studio-getting-started', file: 'getting-started.md', title: 'Getting Started' },
  { slug: 'studio-import-export', file: 'import-export.md', title: 'Import and Export' },
  { slug: 'studio-system-integration', file: 'system-integration.md', title: 'System Integration' },
];

export const HELP_ARCHIVE_TITLE = 'MDZip Studio Help';
export const HELP_SITE_DOCS = 'https://mdzip.org/docs/';

// The page online, at `anchor` when given; null for a file that isn't a help page.
export function helpPageOnlineUrl(file: string, anchor: string | null = null): string | null {
  const page = HELP_PAGES.find((candidate) => candidate.file === file);
  return page ? `${HELP_SITE_DOCS}${page.slug}.html${anchor ? `#${anchor}` : ''}` : null;
}

export function helpPageTitle(file: string): string | null {
  return HELP_PAGES.find((candidate) => candidate.file === file)?.title ?? null;
}
