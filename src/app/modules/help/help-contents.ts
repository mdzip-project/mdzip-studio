// Studio's help contents: the reader's contents for help.mdz, with each page
// named as help-pages.ts names it ("Getting Started", not its first heading).
import { DocumentContentsPage, readDocumentContents } from '../reader/document-contents';
import { HELP_PAGES } from './help-pages';

const HELP_TITLES = Object.fromEntries(HELP_PAGES.map((page) => [page.file, page.title]));

export function readHelpContents(bytes: Uint8Array): Promise<DocumentContentsPage[]> {
  return readDocumentContents(bytes, 'help.mdz', { titles: HELP_TITLES });
}
