// The documents Studio's help shows, and loading them. No Angular here: the
// help dialog, help windows and tests all share it.
import { APP_VERSION } from '../../app-version';
import { HELP_ARCHIVE_TITLE, helpPageTitle } from './help-pages';

export type HelpDocumentKind = 'studio-help' | 'known-issues' | 'changelog';

export interface HelpDocument {
  title: string;
  fileName: string;
  // Fetched first, so the newest copy shows (Known Issues and the Change Log
  // only grow). Without one, the bundled copy shows, which describes this
  // version of Studio.
  remoteUrl?: string;
  fallbackUrl: string;
  // Studio's help: several pages in one archive (help-pages.ts), each also on mdzip.org.
  pages?: boolean;
}

export const HELP_DOCUMENTS: Record<HelpDocumentKind, HelpDocument> = {
  'studio-help': {
    title: HELP_ARCHIVE_TITLE,
    fileName: 'help.mdz',
    fallbackUrl: 'assets/help/help.mdz',
    pages: true,
  },
  'known-issues': {
    title: 'Known Issues',
    fileName: 'KNOWN_ISSUES.md',
    remoteUrl: 'https://raw.githubusercontent.com/mdzip-project/mdzip-studio/main/src/assets/help/known-issues.md',
    fallbackUrl: 'assets/help/known-issues.md',
  },
  changelog: {
    title: 'Change Log',
    fileName: 'CHANGELOG.md',
    remoteUrl: 'https://raw.githubusercontent.com/mdzip-project/mdzip-studio/main/CHANGELOG.md',
    fallbackUrl: 'assets/help/CHANGELOG.md',
  },
};

export interface LoadedHelpDocument {
  bytes: Uint8Array;
  // Where it came from, for the strip or dialog: "Updated from GitHub", the version it describes...
  status: string;
  error: boolean;
}

// The newest copy when there's a remote one, else the bundled copy, else a
// page saying it couldn't be loaded.
export async function loadHelpDocument(kind: HelpDocumentKind): Promise<LoadedHelpDocument> {
  const doc = HELP_DOCUMENTS[kind];
  if (doc.remoteUrl) {
    try {
      return { bytes: await fetchBytes(doc.remoteUrl), status: 'Updated from GitHub', error: false };
    } catch {
      // Offline or unreachable: the bundled copy below.
    }
  }
  try {
    const bytes = await fetchBytes(doc.fallbackUrl);
    return { bytes, status: doc.remoteUrl ? 'Showing bundled copy' : `For MDZip Studio ${APP_VERSION}`, error: false };
  } catch {
    return {
      bytes: new TextEncoder().encode(`# ${doc.title}\n\nCould not load this help document.`),
      status: `Could not load ${doc.title}`,
      error: true,
    };
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

export interface HelpLinkDescription {
  text: string;
  external: boolean;
}

// What the help strip says about the link under the pointer: another help
// page, a section of this one, or a page that opens in the browser.
export function describeHelpLink(href: string | null): HelpLinkDescription | null {
  if (!href) return null;
  if (/^(https?:|mailto:)/i.test(href)) {
    return { text: `Opens in your browser: ${href.replace(/^https?:\/\//i, '').replace(/^mailto:/i, '')}`, external: true };
  }
  if (href.startsWith('#')) return { text: 'Goes to a section of this page', external: false };
  const page = helpPageTitle(href.split('#')[0]);
  return page ? { text: `Goes to the help page ${page}`, external: false } : null;
}
