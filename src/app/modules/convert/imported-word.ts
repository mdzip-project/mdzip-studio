// File > Import... of a Word document: what the Import dialog's options add
// to the new .mdz. "Use its styles when exporting to Word" adds a copy of it
// reduced to how it looks (stylesOnlyCopy) as styles/reference.docx and
// names it in the manifest, as Insert Word Template does; "Show it with its
// fonts and colours" adds its look as a stylesheet (wordStylesheet), named
// by the manifest's styles (see document-style.ts); "Keep a copy of the
// original file" adds it unchanged under sources/.
import { MdzArchiveCore, type MdzManifest } from '@mdzip/core-js';
import { documentStylePath } from '../../core/document-style';
import { wordStylesheet } from '../../core/word-css';
import { stylesOnlyCopy } from '../../core/word-template';

export interface ImportedOriginal {
  fileName: string;
  bytes: Uint8Array;
  keepStyles: boolean;
  keepOriginal: boolean;
  documentStyle?: boolean;
}

/** Word documents and templates: the files the two options are for. */
export function isWordFileName(fileName: string): boolean {
  return /\.(docx|docm|dotx|dotm)$/i.test(fileName);
}

// path, or path-2.ext, path-3.ext... whichever isn't taken.
function freePath(path: string, taken: Set<string>): string {
  if (!taken.has(path.toLowerCase())) return path;
  const dot = path.lastIndexOf('.');
  const stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
  const extension = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The imported .mdz with the options' files added, and what was added
 * ({ styles, stylesheet, original }: archive paths, or null). The styles and
 * the stylesheet are left out, with stylesSkipped set, when the file can't be
 * read as a Word document.
 */
export async function addImportedWordFiles(
  mdz: Uint8Array,
  original: ImportedOriginal,
): Promise<{ bytes: Uint8Array; styles: string | null; stylesheet: string | null; original: string | null; stylesSkipped: boolean }> {
  const archive = await MdzArchiveCore.open(mdz);
  const taken = new Set(archive.listPaths().map((path) => path.toLowerCase()));
  const manifest = ((await archive.readManifest()) ?? {}) as Record<string, unknown>;
  const writes: { path: string; content: Uint8Array }[] = [];
  let styles: string | null = null;
  let stylesheet: string | null = null;
  let stylesSkipped = false;
  let kept: string | null = null;

  if (original.keepStyles) {
    const copy = stylesOnlyCopy(original.bytes);
    if (copy) {
      styles = freePath('styles/reference.docx', taken);
      taken.add(styles.toLowerCase());
      writes.push({ path: styles, content: copy });
    } else {
      stylesSkipped = true;
    }
  }
  // A stylesheet, unless the document already names one.
  if (original.documentStyle && !documentStylePath(manifest) && manifest['styles'] === undefined) {
    const css = wordStylesheet(original.bytes, original.fileName.replace(/^.*[\\/]/, ''));
    if (css) {
      stylesheet = freePath('styles/style.css', taken);
      taken.add(stylesheet.toLowerCase());
      writes.push({ path: stylesheet, content: new TextEncoder().encode(css) });
    } else {
      stylesSkipped = true;
    }
  }
  if (original.keepOriginal) {
    const name = original.fileName.replace(/^.*[\\/]/, '') || 'original.docx';
    kept = freePath(`sources/${name}`, taken);
    writes.push({ path: kept, content: original.bytes });
  }
  if (!writes.length) return { bytes: mdz, styles, stylesheet, original: kept, stylesSkipped };

  const pandoc = (manifest['pandoc'] as Record<string, unknown> | undefined) ?? {};
  const updated: Record<string, unknown> = { ...manifest };
  if (styles) updated['pandoc'] = { ...pandoc, referenceDoc: styles };
  if (stylesheet) updated['styles'] = stylesheet;
  const result = await MdzArchiveCore.updateFiles(mdz, writes, [], { manifest: updated as MdzManifest });
  return { bytes: new Uint8Array(await result.blob.arrayBuffer()), styles, stylesheet, original: kept, stylesSkipped };
}
