// A Studio window showing help (Help > MDZip Studio Help, a (?), Open in New
// Window): which document and page it shows, the section it went to, its
// contents, and what the help strip says. The window's own editor shows the
// document; `navigate` moves it to a page or section.
import { Signal, computed, signal } from '@angular/core';
import type { MdzipControlPolicy } from '@mdzip/editor';
import { HelpContentsPage, readHelpContents } from './help-contents';
import { HELP_DOCUMENTS, HelpDocumentKind, LoadedHelpDocument, describeHelpLink, loadHelpDocument } from './help-documents';
import { HELP_ARCHIVE_TITLE, helpPageOnlineUrl, helpPageTitle } from './help-pages';

export interface HelpStrip {
  title: string;
  status: string;
  onlineUrl: string | null;
  hover: ReturnType<typeof describeHelpLink>;
}

export class HelpWindow {
  // This window shows a help document: read-only, preview only, no menu,
  // toolbar or status bar.
  readonly active = signal(false);
  // The document and its version note.
  readonly document = signal<{ doc: HelpDocumentKind; status: string } | null>(null);
  // The help page showing (a file of help.mdz) and the section it went to.
  readonly page = signal<string | null>(null);
  readonly anchor = signal<string | null>(null);
  // Studio's help: its pages and their sections, for the strip's contents dropdown.
  readonly contents = signal<HelpContentsPage[]>([]);
  // The editor's file pane, which lists every file in the help archive. Off
  // unless asked for (the contents dropdown's last item).
  readonly filesShown = signal(false);
  readonly controls = computed<MdzipControlPolicy | 'preview'>(() =>
    this.filesShown() ? { preset: 'preview', navigation: true } : 'preview');

  // The strip's title, version note, link to the page online, and where the
  // link under the pointer goes.
  readonly strip = computed<HelpStrip | null>(() => {
    const help = this.document();
    if (!help || !this.active()) return null;
    const doc = HELP_DOCUMENTS[help.doc];
    const page = this.page();
    return {
      title: (doc.pages && page && helpPageTitle(page)) || doc.title,
      status: help.status,
      onlineUrl: doc.pages && page ? helpPageOnlineUrl(page, this.anchor()) : null,
      hover: describeHelpLink(this.hoverUrl()),
    };
  });

  // The window title: "MDZip Studio Help", or "MDZip Studio Help: <page>".
  readonly title = computed(() => {
    const strip = this.strip();
    if (!strip) return null;
    return strip.title === HELP_ARCHIVE_TITLE ? strip.title : `${HELP_ARCHIVE_TITLE}: ${strip.title}`;
  });

  constructor(
    private readonly hoverUrl: Signal<string | null>,
    private readonly navigate: (page: string | null, anchor: string | null) => void,
  ) {}

  // Loads `kind` for this window, at `page` and `anchor`. The caller shows the
  // returned bytes in the window's editor, then calls showLoaded().
  async load(kind: HelpDocumentKind, page: string | null, anchor: string | null): Promise<LoadedHelpDocument> {
    const doc = HELP_DOCUMENTS[kind];
    const loaded = await loadHelpDocument(kind);
    this.document.set({ doc: kind, status: loaded.status });
    this.contents.set(doc.pages ? await readHelpContents(loaded.bytes).catch(() => []) : []);
    this.page.set(doc.pages ? page ?? 'index.md' : null);
    this.anchor.set(anchor);
    return loaded;
  }

  // After the editor has the document: go to the page and section asked for.
  showLoaded(): void {
    this.navigate(this.page() === 'index.md' ? null : this.page(), this.anchor());
  }

  // A page or section, from the contents dropdown or the main process (a (?)
  // for a help window that's already open).
  goTo(page: string | null, anchor: string | null): void {
    if (page) this.page.set(page);
    this.anchor.set(anchor);
    this.navigate(page, anchor);
  }

  // The editor moved to another page (a link): the strip follows it.
  pageShown(path: string | null): void {
    if (path && path !== this.page()) {
      this.page.set(path);
      this.anchor.set(null);
    }
  }

  toggleFiles(): void {
    this.filesShown.update((shown) => !shown);
  }
}
