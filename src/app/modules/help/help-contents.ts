// Studio's help contents: the reader's contents for the help archive, with
// each page named as help-pages.ts names it ("Getting Started", not its
// first heading).
import { DocumentContentsPage, readDocumentContents } from '../reader/document-contents';
import { HELP_DOCUMENTS } from './help-documents';
import { HELP_PAGES } from './help-pages';

const HELP_TITLES = Object.fromEntries(HELP_PAGES.map((page) => [page.file, page.title]));

export function readHelpContents(bytes: Uint8Array): Promise<DocumentContentsPage[]> {
  return readDocumentContents(bytes, HELP_DOCUMENTS['studio-help'].fileName, { titles: HELP_TITLES });
}
