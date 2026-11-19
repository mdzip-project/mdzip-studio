// The help window's contents dropdown: each help page and its main sections
// (## headings), read from the bundled help archive, with the heading ids the
// preview gives them, so a click can go straight to one.
import { MdzArchiveCore } from '@mdzip/core-js';
import { collectMdzipHeadings, tokenizeMdzipMarkdown } from '@mdzip/renderer';
import { HELP_PAGES } from './help-pages';

export interface HelpContentsPage {
  file: string;
  title: string;
  sections: { id: string; text: string }[];
}

export async function readHelpContents(bytes: Uint8Array): Promise<HelpContentsPage[]> {
  const archive = await MdzArchiveCore.open(bytes);
  const pages: HelpContentsPage[] = [];
  for (const page of HELP_PAGES) {
    if (!archive.hasEntry(page.file)) continue;
    const headings = collectMdzipHeadings(tokenizeMdzipMarkdown(await archive.readText(page.file)));
    pages.push({
      file: page.file,
      title: page.title,
      sections: headings.filter((heading) => heading.level === 2).map(({ id, text }) => ({ id, text })),
    });
  }
  return pages;
}
