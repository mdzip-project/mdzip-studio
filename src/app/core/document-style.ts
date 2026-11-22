// A document's own stylesheet: the manifest's `"styles": "path/to.css"`, the
// one-file form proposed for the MDZip spec (mdzip-spec#19, not in the spec
// yet, so Studio-only for now). The stylesheet is written as if the document
// were a web page of its own; this fits it to where Studio shows it, and
// keeps it from reaching anything else:
//
// - every rule applies only inside the document (the preview, or the print
//   page's .print-root); html, body and :root mean the document itself;
// - @import is dropped, and url() only reaches files in the archive (made
//   into data: URIs) or data: URIs; a declaration pointing anywhere else is
//   dropped, so a stylesheet can't load from the web or the disk;
// - @media (prefers-color-scheme: dark) follows Studio's own theme rather
//   than the system's; for print, the light colours are used.
//
// The preview also gets `contain: layout` (app styles), so a fixed-position
// element stays inside the document instead of covering Studio's controls.

/** The archive path a manifest names as the document's stylesheet, or null. */
export function documentStylePath(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const value = (manifest as Record<string, unknown>)['styles'];
  if (typeof value !== 'string') return null;
  const path = value.replace(/^\.\//, '');
  if (!/\.css$/i.test(path) || !isArchivePath(path)) return null;
  return path;
}

function isArchivePath(path: string): boolean {
  return !!path && !path.startsWith('/') && !path.includes('\\') && !/^[a-z][a-z0-9+.-]*:/i.test(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export type DocumentStyleTarget = 'preview' | 'print';

/** Where the preview's document is, in Studio's main window. */
export const PREVIEW_SCOPE = '.workspace-panel.studio-document-style .mdzip-root';
const ROOTS: Record<DocumentStyleTarget, { any: string; dark: string | null; light: string }> = {
  preview: {
    any: `${PREVIEW_SCOPE} .preview-content`,
    dark: `${PREVIEW_SCOPE}.mdzip-theme-dark .preview-content`,
    light: `${PREVIEW_SCOPE}.mdzip-theme-light .preview-content`,
  },
  print: { any: '.print-root', dark: null, light: '.print-root' },
};

const URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*?))\s*\)/gi;

// A url() in the stylesheet at `cssPath`, as the archive path it names, a
// data: URI as it is, or null when it points outside the archive.
function archiveTarget(url: string, cssPath: string): { path: string } | { data: string } | null {
  const value = url.trim();
  if (/^data:/i.test(value)) return { data: value };
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.includes('\\')) return null;
  const parts = cssPath.split('/').slice(0, -1);
  for (const part of value.replace(/[?#].*$/, '').split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== '.') {
      parts.push(part);
    }
  }
  const path = parts.join('/');
  return path && isArchivePath(path) ? { path } : null;
}

// Selectors written for a page of its own, for inside `root`.
export function scopeSelector(selectorText: string, root: string): string {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selectorText.length; i++) {
    const c = selectorText[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      selectors.push(selectorText.slice(start, i));
      start = i + 1;
    }
  }
  selectors.push(selectorText.slice(start));
  return selectors.map((selector) => {
    let rest = selector.trim();
    let isRoot = false;
    for (const page of [/^(?::root|html)(?![\w-])/i, /^\s*>?\s*body(?![\w-])/i]) {
      const match = page.exec(rest);
      if (match) {
        rest = rest.slice(match[0].length);
        isRoot = true;
      }
    }
    if (!isRoot) return `${root} ${rest}`;
    if (!rest.trim()) return root;
    // `body.wide` is the document with a class; `body p` is inside it.
    return /^[\s>+~]/.test(rest) ? `${root} ${rest.trim().replace(/^>\s*/, '> ')}` : `${root}${rest}`;
  }).join(', ');
}

/**
 * The stylesheet at `cssPath`, fitted to the preview or the print page.
 * `readDataUri` reads an archive file as a data: URI (null when it's missing).
 */
export async function scopeDocumentStyle(
  css: string,
  cssPath: string,
  target: DocumentStyleTarget,
  readDataUri: (path: string) => Promise<string | null>,
): Promise<string> {
  const rules = parseRules(css);
  if (!rules) return '';

  // The archive files its url()s name, read first.
  const resolved = new Map<string, string | null>();
  for (const match of css.matchAll(URL)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (resolved.has(url)) continue;
    const found = archiveTarget(url, cssPath);
    resolved.set(url, null);
    if (found && 'data' in found) resolved.set(url, found.data);
    else if (found) resolved.set(url, await readDataUri(found.path).catch(() => null));
  }
  // url()s as CSSOM writes them back, which may differ in quoting.
  const byPath = new Map<string, string | null>();
  for (const [url, result] of resolved) {
    const found = archiveTarget(url, cssPath);
    if (found && 'path' in found) byPath.set(found.path, result);
  }
  const urlOf = (value: string): string | null => {
    const direct = resolved.get(value);
    if (direct !== undefined) return direct;
    const found = archiveTarget(value, cssPath);
    if (!found) return null;
    return 'data' in found ? found.data : byPath.get(found.path) ?? null;
  };

  const roots = ROOTS[target];
  const out: string[] = [];
  const declarations = (style: CSSStyleDeclaration, zoom: boolean): string | null => {
    const lines: string[] = [];
    for (let i = 0; i < style.length; i++) {
      const name = style[i];
      let value = style.getPropertyValue(name);
      let blocked = false;
      value = value.replace(URL, (_match, a, b, c) => {
        const data = urlOf(String(a ?? b ?? c ?? '').trim());
        if (!data) blocked = true;
        return `url("${data ?? ''}")`;
      });
      if (blocked) continue;
      // Sizes in px or pt follow the preview's zoom.
      if (zoom && name === 'font-size' && /^-?[\d.]+(px|pt)$/.test(value.trim())) value = `calc(${value.trim()} * var(--mdz-zoom, 1))`;
      const important = style.getPropertyPriority(name) ? ' !important' : '';
      lines.push(`${name}: ${value}${important};`);
    }
    return lines.length ? lines.join(' ') : null;
  };

  const walk = (list: CSSRuleList, root: string, wrap: (text: string) => string) => {
    for (const rule of Array.from(list)) {
      switch (rule.type) {
        case 1: { // style
          const styleRule = rule as CSSStyleRule;
          const body = declarations(styleRule.style, target === 'preview');
          if (body) out.push(wrap(`${scopeSelector(styleRule.selectorText, root)} { ${body} }`));
          break;
        }
        case 4: { // @media
          const media = (rule as CSSMediaRule).media.mediaText.replace(/\s+/g, ' ').trim();
          const scheme = /prefers-color-scheme\s*:\s*(dark|light)/i.exec(media)?.[1]?.toLowerCase();
          if (scheme) {
            // Only "(prefers-color-scheme: x)", perhaps with "screen and".
            const other = media.replace(/\(\s*prefers-color-scheme\s*:\s*\w+\s*\)/i, '').replace(/\band\b/gi, '').replace(/\b(screen|all)\b/gi, '').trim();
            if (other) break;
            const schemeRoot = scheme === 'dark' ? roots.dark : roots.light;
            if (schemeRoot) walk((rule as CSSMediaRule).cssRules, schemeRoot, wrap);
            break;
          }
          walk((rule as CSSMediaRule).cssRules, root, (text) => wrap(`@media ${media} { ${text} }`));
          break;
        }
        case 12: { // @supports
          const condition = (rule as CSSSupportsRule).conditionText;
          walk((rule as CSSSupportsRule).cssRules, root, (text) => wrap(`@supports ${condition} { ${text} }`));
          break;
        }
        case 5: { // @font-face: whole, or not at all if a source is outside the archive
          let blocked = false;
          const text = rule.cssText.replace(URL, (_match, a, b, c) => {
            const data = urlOf(String(a ?? b ?? c ?? '').trim());
            if (!data) blocked = true;
            return `url("${data ?? ''}")`;
          });
          if (!blocked) out.push(text);
          break;
        }
        case 7: // @keyframes
          if (!/url\(/i.test(rule.cssText)) out.push(rule.cssText);
          break;
        case 6: // @page: print only
          if (target === 'print' && !/url\(/i.test(rule.cssText)) out.push(rule.cssText);
          break;
        default:
          // @layer blocks: their rules, in order. @import and the rest: dropped.
          if (rule.constructor?.name === 'CSSLayerBlockRule') walk((rule as CSSGroupingRule).cssRules, root, wrap);
      }
    }
  };
  walk(rules, roots.any, (text) => text);
  return out.join('\n');
}

// The stylesheet's rules, parsed by the browser into a sheet that isn't
// applied to anything (and drops @import), or null when it can't be.
function parseRules(css: string): CSSRuleList | null {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return sheet.cssRules;
  } catch {
    return null;
  }
}
