// A Studio window for reading, not editing: Studio's help (Help > MDZip
// Studio Help, a (?)), or a document from View > Read as Document. The window's
// own editor shows the document read-only and preview-only, with no menu,
// toolbar or status bar; a strip across the top names the page and opens the
// contents. `navigate` moves the editor to a page or section.
import { Signal, computed, signal } from '@angular/core';
import type { MdzipControlPolicy } from '@mdzip/editor';
import { DocumentContentsPage, resolveArchiveLink } from './document-contents';

// What's being read, and what the strip and window title say about it.
export interface ReaderSource {
  // The strip's first word or name: "Help", or the document's title.
  label: string;
  // The page title when the contents don't name the page (a one-page help document).
  title: string;
  // Right of the strip: the help's version note, or when the snapshot was taken.
  status: string;
  // The window title for the page showing (its title, when known).
  windowTitle: (pageTitle: string | null) => string;
  // The page online (Studio's help), at the section.
  onlineUrl?: (page: string | null, anchor: string | null) => string | null;
  // The strip offers Refresh (a document snapshot, which can fall behind).
  refreshable?: boolean;
}

export interface ReaderStrip {
  label: string;
  title: string;
  status: string;
  onlineUrl: string | null;
  hover: ReaderLinkDescription | null;
  refreshable: boolean;
}

export interface ReaderLinkDescription {
  text: string;
  external: boolean;
}

export class ReaderWindow {
  // This window is for reading.
  readonly active = signal(false);
  readonly source = signal<ReaderSource | null>(null);
  // The page showing (a file of the archive) and the section it went to.
  readonly page = signal<string | null>(null);
  readonly anchor = signal<string | null>(null);
  // Every page and its sections, for the strip's contents dropdown.
  readonly contents = signal<DocumentContentsPage[]>([]);
  // The editor's file pane, which lists every file in the archive. Off unless
  // asked for (the contents dropdown's last item).
  readonly filesShown = signal(false);
  readonly controls = computed<MdzipControlPolicy | 'preview'>(() =>
    this.filesShown() ? { preset: 'preview', navigation: true } : 'preview');

  readonly pageTitle = computed(() => {
    const contents = this.contents();
    if (contents.length === 1) return contents[0].title;
    return contents.find((page) => page.file === this.page())?.title ?? null;
  });

  readonly strip = computed<ReaderStrip | null>(() => {
    const source = this.source();
    if (!source || !this.active()) return null;
    return {
      label: source.label,
      title: this.pageTitle() ?? source.title,
      status: source.status,
      onlineUrl: source.onlineUrl?.(this.page(), this.anchor()) ?? null,
      hover: this.describeLink(this.hoverUrl()),
      refreshable: !!source.refreshable,
    };
  });

  readonly title = computed(() => {
    const source = this.source();
    return source && this.active() ? source.windowTitle(this.pageTitle()) : null;
  });

  constructor(
    private readonly hoverUrl: Signal<string | null>,
    private readonly navigate: (page: string | null, anchor: string | null) => void,
  ) {}

  // A document to read, at `page` (null: where the editor opens it) and `anchor`.
  show(source: ReaderSource, contents: DocumentContentsPage[], page: string | null, anchor: string | null): void {
    this.source.set(source);
    this.contents.set(contents);
    this.page.set(page ?? contents[0]?.file ?? null);
    this.anchor.set(anchor);
  }

  // After the editor has the document: go to the page and section asked for.
  // The first page is where the editor opens, so only a section goes there.
  showLoaded(): void {
    const page = this.page();
    this.navigate(page && page !== this.contents()[0]?.file ? page : null, this.anchor());
  }

  // A page or section: the contents dropdown, or the main process (a (?) for a
  // help window that's already open).
  goTo(page: string | null, anchor: string | null): void {
    // A one-page document: a section of it.
    const target = this.contents().length > 1 ? page : null;
    if (target) this.page.set(target);
    this.anchor.set(anchor);
    this.navigate(target, anchor);
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

  // What the strip says about the link under the pointer: another page, a
  // section of this one, or a page that opens in the browser.
  describeLink(href: string | null): ReaderLinkDescription | null {
    if (!href) return null;
    if (/^(https?:|mailto:)/i.test(href)) {
      return { text: `Opens in your browser: ${href.replace(/^https?:\/\//i, '').replace(/^mailto:/i, '')}`, external: true };
    }
    if (href.startsWith('#')) return { text: 'Goes to a section of this page', external: false };
    const current = this.page() ?? '';
    const folder = current.includes('/') ? current.slice(0, current.lastIndexOf('/') + 1) : '';
    const path = resolveArchiveLink(folder, href);
    const page = path ? this.contents().find((candidate) => candidate.file === path) : null;
    return page ? { text: `Goes to the page ${page.title}`, external: false } : null;
  }
}
