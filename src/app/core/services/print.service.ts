import { Injectable } from '@angular/core';

// Resolves a blob: object URL to a data: URI. Kept injectable so tests can
// substitute it — jsdom implements neither fetch of blob: URLs nor FileReader
// over real blobs.
export type BlobUrlResolver = (url: string) => Promise<string | null>;

// Light, GitHub-style document typography plus pagination rules for the PDF
// render. Code prints monochrome in V1: highlight token colors are
// editor-internal CSS that never reaches the captured preview HTML.
const PRINT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #1f2328;
  background: #ffffff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1, h2, h3, h4, h5, h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #d1d9e0; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: #59636e; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
p, ul, ol, dl, table, blockquote, pre { margin: 0 0 16px; }
ul, ol { padding-left: 2em; }
li + li { margin-top: 0.25em; }
li > input[type='checkbox'] { margin: 0 0.45em 0 0; vertical-align: middle; }
li:has(> input[type='checkbox']) { list-style: none; margin-left: -1.4em; }
a { color: inherit; text-decoration: underline; }
blockquote { padding: 0 1em; border-left: 4px solid #d1d9e0; color: #59636e; }
code, kbd, samp, pre {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
}
code, kbd, samp { font-size: 85%; background: #f0f1f3; padding: 0.2em 0.4em; border-radius: 4px; }
pre { font-size: 12px; line-height: 1.45; background: #f6f8fa; padding: 12px 14px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: break-word; }
pre code { font-size: 100%; background: transparent; padding: 0; border-radius: 0; }
table { border-collapse: collapse; max-width: 100%; }
th, td { border: 1px solid #d1d9e0; padding: 6px 13px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
hr { height: 0; margin: 24px 0; border: 0; border-top: 2px solid #d1d9e0; }
img, svg, video { max-width: 100%; height: auto; }
.mdzip-mermaid { margin: 16px 0; text-align: center; }
.mdzip-mermaid svg { max-width: 100%; height: auto; }
h1, h2, h3 { break-after: avoid; break-inside: avoid; }
pre, table, blockquote, img, svg, .mdzip-mermaid { break-inside: avoid; }
`;

/**
 * Turns a captured (hidden, light-scheme) preview DOM into a standalone HTML
 * document for the main process to render to PDF. The document must carry no
 * references back to this renderer: blob: object URLs are scoped to the
 * process that created them, so every blob image is inlined as a data: URI.
 */
@Injectable({ providedIn: 'root' })
export class PrintService {
  async buildPrintDocument(
    previewRoot: HTMLElement,
    title: string,
    resolveBlobUrl: BlobUrlResolver = blobUrlToDataUri
  ): Promise<string> {
    const clone = previewRoot.cloneNode(true) as HTMLElement;
    this.stripEditorArtifacts(clone);
    await this.inlineBlobImages(clone, resolveBlobUrl);
    return this.wrapDocument(clone.innerHTML, title);
  }

  // Removes editor-only DOM the preview wraps around content: image hydration
  // slot wrappers and their state classes. Everything else in the preview is
  // plain rendered markdown.
  private stripEditorArtifacts(root: HTMLElement): void {
    for (const slot of Array.from(root.querySelectorAll('.mdzip-image-slot'))) {
      slot.replaceWith(...Array.from(slot.childNodes));
    }
    for (const image of Array.from(root.querySelectorAll('img'))) {
      image.classList.remove('mdzip-image-loading');
      if (image.classList.length === 0) image.removeAttribute('class');
      image.removeAttribute('mdzip-studio-src');
    }
  }

  private async inlineBlobImages(root: HTMLElement, resolveBlobUrl: BlobUrlResolver): Promise<void> {
    const images = Array.from(root.querySelectorAll('img')).filter((image) =>
      (image.getAttribute('src') ?? '').startsWith('blob:')
    );
    await Promise.all(images.map(async (image) => {
      let dataUri: string | null = null;
      try {
        dataUri = await resolveBlobUrl(image.getAttribute('src') ?? '');
      } catch {
        dataUri = null;
      }
      // A blob: URL is meaningless in the print window; drop it rather than
      // ship a reference that renders as a broken image there.
      if (dataUri) {
        image.setAttribute('src', dataUri);
      } else {
        image.removeAttribute('src');
      }
    }));
  }

  private wrapDocument(bodyHtml: string, title: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<article class="print-root">${bodyHtml}</article>
</body>
</html>
`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function blobUrlToDataUri(url: string): Promise<string | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
