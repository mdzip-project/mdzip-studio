// A document's contents for the reader's dropdown: its pages, each with its
// main sections, and the heading ids the preview gives them.
//
// The format leaves reading order to the reader (spec: ordered navigation and
// tables of contents are out of scope), so the archive's own links set it:
// the entry point, then the pages it links to in the order it links them,
// then the pages those link to, and so on; any page nothing links to comes
// last, alphabetically. Support files (README, AGENTS...) appear only when
// something links to them. A document-mode .mdz is one page, its entry point,
// and so is a .md file.
import { MdzArchiveCore } from '@mdzip/core-js';
import { collectMdzipHeadings, tokenizeMdzipMarkdown, walkMdzipTokens } from '@mdzip/renderer';
import type { Token } from 'marked';

export interface DocumentContentsPage {
  file: string;
  title: string;
  sections: { id: string; text: string }[];
}

export interface DocumentContentsOptions {
  // Titles to use instead of each page's first heading, by file.
  titles?: Readonly<Record<string, string>>;
}

export async function readDocumentContents(
  bytes: Uint8Array,
  fileName: string,
  options: DocumentContentsOptions = {},
): Promise<DocumentContentsPage[]> {
  if (!/\.mdz$/i.test(fileName)) {
    return [describePage(fileName, new TextDecoder().decode(bytes), options)];
  }
  const archive = await MdzArchiveCore.open(bytes);
  const markdown = archive.listPaths().filter((path) => MdzArchiveCore.isMarkdownFile(path));
  const manifest = await archive.readManifest().catch(() => null);
  let entry: string;
  try {
    entry = MdzArchiveCore.resolveEntryPointStrict(markdown, manifest);
  } catch {
    // No entry point the reader can trust: the editor opens on its own choice,
    // so list the pages alphabetically.
    entry = [...markdown].sort()[0];
  }
  if (!entry) return [];
  const project = manifest?.mode === 'project';

  const texts = new Map<string, string>();
  const read = async (path: string) => {
    if (!texts.has(path)) texts.set(path, await archive.readText(path));
    return texts.get(path) as string;
  };

  const order = [entry];
  if (project) {
    const known = new Set(markdown);
    for (let i = 0; i < order.length; i++) {
      for (const linked of linkedPages(order[i], await read(order[i]))) {
        if (known.has(linked) && !order.includes(linked)) order.push(linked);
      }
    }
    const unlinked = markdown.filter((path) => !order.includes(path) && !MdzArchiveCore.isSupportFile(path)).sort();
    order.push(...unlinked);
  }

  const pages: DocumentContentsPage[] = [];
  for (const path of order) pages.push(describePage(path, await read(path), options));
  return pages;
}

function describePage(file: string, text: string, options: DocumentContentsOptions): DocumentContentsPage {
  const headings = collectMdzipHeadings(tokenizeMdzipMarkdown(text));
  const first = headings.find((heading) => heading.level === 1) ?? headings[0];
  let sections = headings.filter((heading) => heading.level === 2);
  // A page without ## headings: its # headings after the title.
  if (!sections.length) sections = headings.filter((heading) => heading.level === 1 && heading !== first);
  return {
    file,
    title: options.titles?.[file] ?? first?.text ?? file.replace(/^.*\//, '').replace(/\.(md|markdown|mdz)$/i, ''),
    sections: sections.map(({ id, text: sectionText }) => ({ id, text: sectionText })),
  };
}

// The archive pages `text` (the page at `from`) links to, in order: relative
// links only, resolved against the page's folder, without their #section.
function linkedPages(from: string, text: string): string[] {
  const hrefs: string[] = [];
  walkMdzipTokens(tokenizeMdzipMarkdown(text) as Token[], (token) => {
    if (token.type === 'link' && typeof token.href === 'string') hrefs.push(token.href);
  });
  const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const pages: string[] = [];
  for (const href of hrefs) {
    const path = resolveArchiveLink(folder, href);
    if (path && MdzArchiveCore.isMarkdownFile(path)) pages.push(path);
  }
  return pages;
}

// `href` from a page in `folder` ('' or 'docs/') as an archive path, or null
// for a link that leaves the archive (a URL, an absolute path, past the root).
export function resolveArchiveLink(folder: string, href: string): string | null {
  const target = href.split('#')[0].split('?')[0];
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    decoded = target;
  }
  const parts: string[] = [];
  for (const part of (folder + decoded).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length ? parts.join('/') : null;
}
