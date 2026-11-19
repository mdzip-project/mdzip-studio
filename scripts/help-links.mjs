// Rewrites the links in an mdzip.org docs page for Studio's help archive:
// a link to another help page becomes a link to its file in the archive
// (studio-getting-started.html#images → getting-started.md#images), and any
// other link into the site becomes a full mdzip.org address, since the help
// archive has nothing else of the site's. Links to the page's own images,
// anchors and full URLs are left alone.

const SITE = 'https://mdzip.org/';

// `pages`: [{ slug, file }]. `markdown`: a docs page (published at docs/<slug>.html).
export function rewriteHelpLinks(markdown, pages) {
  const fileFor = new Map(pages.map((page) => [page.slug, page.file]));
  return markdown.replace(/(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (whole, open, target, close) =>
    `${open}${rewriteTarget(target, fileFor)}${close}`);
}

function rewriteTarget(target, fileFor) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return target;
  const [pathPart, anchor] = splitAnchor(target);
  const fragment = anchor === null ? '' : `#${anchor}`;
  if (pathPart.startsWith('../')) {
    // A site page outside docs/.
    return `${SITE}${pathPart.slice(3)}${fragment}`;
  }
  const html = /^([a-z0-9-]+)\.html$/i.exec(pathPart);
  if (html) {
    // Another docs page: in the archive when it's a help page, else online.
    const file = fileFor.get(html[1]);
    return file ? `${file}${fragment}` : `${SITE}docs/${pathPart}${fragment}`;
  }
  // The page's own files (images/…), kept with it in the archive.
  return target;
}

function splitAnchor(target) {
  const hash = target.indexOf('#');
  return hash === -1 ? [target, null] : [target.slice(0, hash), target.slice(hash + 1)];
}
