import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

// Pandoc's reference.docx says nothing about which Word it's for, and Word
// takes that to mean Word 2007: it opens it (and every document exported with
// it, since Pandoc copies these settings) in Compatibility Mode, and asks
// about features the old format lacks each time it's saved. Marking it as
// current Word (compatibilityMode 15, Word 2013 and later) avoids both. Older
// Word still opens it: the setting only picks newer layout rules.
const COMPAT = '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>';

// Elements CT_Settings puts after w:compat; it goes before the first of them.
const AFTER_COMPAT = [
  'w:docVars', 'w:rsids', 'm:mathPr', 'w:attachedSchema', 'w:themeFontLang', 'w:clrSchemeMapping',
  'w:doNotIncludeSubdocsInStats', 'w:doNotAutoCompressPictures', 'w:forceUpgrade', 'w:captions',
  'w:readModeInkLockDown', 'w:smartTagType', 'sl:schemaLibrary', 'w:shapeDefaults',
  'w:doNotEmbedSmartTags', 'w:decimalSymbol', 'w:listSeparator',
];

/** settings.xml marked as current Word; unchanged when it already names a version. */
export function withCurrentWordCompat(settingsXml: string): string {
  if (/<w:compat[\s>/]/.test(settingsXml)) return settingsXml;
  let at = -1;
  for (const name of AFTER_COMPAT) {
    const match = new RegExp(`<${name}[\\s>/]`).exec(settingsXml);
    if (match && (at < 0 || match.index < at)) at = match.index;
  }
  if (at < 0) at = settingsXml.lastIndexOf('</w:settings>');
  if (at < 0) return settingsXml;
  return settingsXml.slice(0, at) + COMPAT + settingsXml.slice(at);
}

/** The .docx with its settings marked as current Word; the bytes as given if that can't be done. */
export function markAsCurrentWord(docx: Uint8Array): Uint8Array {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(docx);
  } catch {
    return docx;
  }
  const settings = files['word/settings.xml'];
  if (!settings) return docx;
  const before = strFromU8(settings);
  const after = withCurrentWordCompat(before);
  if (after === before) return docx;
  files['word/settings.xml'] = strToU8(after);
  return zipParts(files);
}

// [Content_Types].xml first, as Word writes it.
function zipParts(files: Record<string, Uint8Array>): Uint8Array {
  const ordered: Zippable = {};
  if (files['[Content_Types].xml']) ordered['[Content_Types].xml'] = files['[Content_Types].xml'];
  for (const [name, bytes] of Object.entries(files)) if (name !== '[Content_Types].xml') ordered[name] = bytes;
  return zipSync(ordered, { level: 6 });
}

// Parts that hold what people wrote or who they are, not how it looks.
const CONTENT_PARTS = [
  'word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml', 'word/commentsExtensible.xml',
  'word/people.xml',
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * styles.xml with a table style named "Table", the one Pandoc gives every
 * table it writes to Word, looking like the document's usual table: the
 * table style or the borders (grid lines) most of its tables have. Word
 * documents mostly give each table its own borders rather than a style, and
 * Pandoc keeps neither, so without this exported tables have no lines.
 * Unchanged when there's already a "Table" style or the tables have neither.
 */
export function withTableStyle(stylesXml: string, documentXml: string): string {
  if (/w:styleId="Table"/.test(stylesXml) || !stylesXml.includes('</w:styles>')) return stylesXml;
  const looks = new Map<string, { count: number; style: string | null; borders: string | null }>();
  for (const match of documentXml.matchAll(/<w:tbl>\s*<w:tblPr>([\s\S]*?)<\/w:tblPr>/g)) {
    const style = /<w:tblStyle w:val="([^"]+)"/.exec(match[1])?.[1] ?? null;
    const borders = /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(match[1])?.[0] ?? null;
    const key = `${style}|${borders}`;
    const look = looks.get(key) ?? { count: 0, style, borders };
    look.count++;
    looks.set(key, look);
  }
  const usual = [...looks.values()].sort((a, b) => b.count - a.count)[0];
  if (!usual) return stylesXml;
  const styleExists = (id: string) => new RegExp(`w:styleId="${escapeRegExp(id)}"`).test(stylesXml);
  const basedOn = usual.style && styleExists(usual.style) ? usual.style : null;
  if (!basedOn && !usual.borders) return stylesXml;
  const parent = basedOn ?? (styleExists('TableNormal') ? 'TableNormal' : null);
  const table = '<w:style w:type="table" w:customStyle="1" w:styleId="Table"><w:name w:val="Table"/>'
    + (parent ? `<w:basedOn w:val="${parent}"/>` : '')
    + '<w:uiPriority w:val="99"/>'
    + (usual.borders ? `<w:tblPr>${usual.borders}</w:tblPr>` : '')
    + '</w:style>';
  const end = stylesXml.lastIndexOf('</w:styles>');
  return stylesXml.slice(0, end) + table + stylesXml.slice(end);
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The sample lists' numbering (withSampleNumbering). Pandoc numbers the lists
// it writes from 1001 and keeps a reference document's own definitions, so
// these don't meet its.
export const SAMPLE_BULLETS = 9801;
export const SAMPLE_NUMBERS = 9802;

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function sampleAbstract(id: number, format: 'bullet' | 'decimal'): string {
  const bullets = ['•', '◦', '▪'];
  const levels = [0, 1, 2].map((level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/>`
    + `<w:lvlText w:val="${format === 'bullet' ? bullets[level] : `%${level + 1}.`}"/><w:lvlJc w:val="left"/>`
    + `<w:pPr><w:ind w:left="${480 * (level + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${levels}</w:abstractNum>`;
}

/**
 * numbering.xml (or a new one, for null) with the definitions the sample
 * lists use: bullets and numbers, three levels each.
 */
export function withSampleNumbering(numberingXml: string | null): string {
  const xml = numberingXml ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NS}"></w:numbering>`;
  if (xml.includes(`w:abstractNumId="${SAMPLE_BULLETS}"`)) return xml;
  const abstracts = sampleAbstract(SAMPLE_BULLETS, 'bullet') + sampleAbstract(SAMPLE_NUMBERS, 'decimal');
  const nums = [SAMPLE_BULLETS, SAMPLE_NUMBERS].map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join('');
  // Every w:abstractNum comes before every w:num; w:numIdMacAtCleanup last.
  const firstNum = xml.search(/<w:num[\s>]/);
  const end = xml.search(/<w:numIdMacAtCleanup[\s/>]|<\/w:numbering>/);
  if (end < 0) return xml;
  const abstractsAt = firstNum >= 0 ? firstNum : end;
  return xml.slice(0, abstractsAt) + abstracts + xml.slice(abstractsAt, end) + nums + xml.slice(end);
}

/**
 * What the reference document shows when it's opened in Word: a line of
 * help, then a sample of each style an export uses that the document has
 * (title, headings, body text with bold, italic, code and a link, bulleted
 * and numbered lists, quote, table), so there's something to look at while
 * changing them. Pandoc uses only the styles; this text never reaches an
 * exported document. The lists need withSampleNumbering's definitions.
 */
export function styleSamples(stylesXml: string): string {
  const ids = new Map<string, string>();
  for (const match of stylesXml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = /\bw:styleId="([^"]+)"/.exec(match[1])?.[1];
    const name = /<w:name w:val="([^"]+)"/.exec(match[2])?.[1]?.toLowerCase();
    if (id && name && !ids.has(name)) ids.set(name, id);
  }
  const run = (text: string, props = '') =>
    `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  const styled = (text: string, style?: string) => run(text, style ? `<w:rStyle w:val="${style}"/>` : '');
  const paragraph = (style: string | undefined, ...runs: string[]) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs.join('')}</w:p>`;
  const sample = (name: string, text: string) => (ids.has(name) ? paragraph(ids.get(name), run(text)) : '');
  const body = ids.get('body text') ?? ids.get('normal');
  const first = ids.get('first paragraph') ?? body;
  // Pandoc writes a list's items in "Compact" (when its items are short).
  const item = (numId: number, level: number, text: string) => {
    const style = ids.get('compact') ?? body;
    return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`;
  };

  const parts = [
    paragraph(ids.get('normal'), run('The look of this document, for Export… as Word. To change it, change its styles: in Word, '
      + 'right-click a style in Home › Styles and choose Modify…. Only the styles are used; the text below just shows them.')),
    sample('title', 'Title'),
    sample('subtitle', 'Subtitle'),
    sample('author', 'Author'),
    sample('date', 'Date'),
    sample('heading 1', 'Heading 1'),
    paragraph(first, run('First Paragraph: the first paragraph after a heading.')),
    paragraph(body, run(`${ids.has('body text') ? 'Body Text' : 'Normal'}: every other paragraph, with `),
      run('bold', '<w:b/>'), run(', '), run('italic', '<w:i/>'), run(', '),
      ids.has('verbatim char') ? styled('code', ids.get('verbatim char')) : run('code', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'),
      run(' and a '), ids.has('hyperlink') ? styled('link', ids.get('hyperlink')) : run('link', '<w:u w:val="single"/>'), run('.')),
    sample('heading 2', 'Heading 2'),
    paragraph(first, run('A bulleted list:')),
    item(SAMPLE_BULLETS, 0, 'First item'),
    item(SAMPLE_BULLETS, 1, 'An item inside it'),
    item(SAMPLE_BULLETS, 0, 'Second item'),
    paragraph(body, run('A numbered list:')),
    item(SAMPLE_NUMBERS, 0, 'First step'),
    item(SAMPLE_NUMBERS, 1, 'A step inside it'),
    item(SAMPLE_NUMBERS, 0, 'Second step'),
    sample('heading 3', 'Heading 3'),
    sample('block text', 'Block Text: a quotation.') || sample('quote', 'Quote: a quotation.'),
  ];
  // A table in the "Table" style Pandoc gives every table it writes, with
  // its caption above, where Pandoc puts it.
  const cell = (text: string) => `<w:tc><w:tcPr><w:tcW w:w="2160" w:type="dxa"/></w:tcPr><w:p>${run(text)}</w:p></w:tc>`;
  const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  if (ids.has('table')) {
    parts.push(sample('table caption', 'Table Caption: what the table shows.'),
      `<w:tbl><w:tblPr><w:tblStyle w:val="${ids.get('table')}"/><w:tblW w:w="0" w:type="auto"/>`
      + '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
      + '<w:tblGrid><w:gridCol w:w="2160"/><w:gridCol w:w="2160"/><w:gridCol w:w="2160"/></w:tblGrid>'
      + row('Header', 'Header', 'Header') + row('Cell', 'Cell', 'Cell') + row('Cell', 'Cell', 'Cell') + '</w:tbl>'
      + paragraph(ids.get('normal')));
  }
  return parts.join('');
}

/**
 * A Word document (or template) reduced to how it looks, for Pandoc's
 * reference document: its styles, numbering, theme, fonts, page setup
 * (size, margins, columns) and headers and footers with their pictures are
 * kept, and its usual table look becomes Pandoc's "Table" style; its text, its other pictures, footnotes, comments and authors are
 * not. Saved as a .docx (a template's type is changed) and marked as current
 * Word. Null when it isn't a Word document.
 */
export function stylesOnlyCopy(docx: Uint8Array): Uint8Array | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(docx);
  } catch {
    return null;
  }
  const documentXml = files['word/document.xml'];
  const contentTypes = files['[Content_Types].xml'];
  if (!documentXml || !contentTypes) return null;
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : null);

  // The body: a sample of each style (styleSamples), and the last section's
  // page setup (it names the headers and footers).
  let document = strFromU8(documentXml);
  // Its tables' look, while the tables are still there.
  const styles = text('word/styles.xml');
  if (styles) files['word/styles.xml'] = strToU8(withTableStyle(styles, document));

  const bodyOpen = /<w:body\b[^>]*>/.exec(document);
  const bodyClose = document.lastIndexOf('</w:body>');
  if (!bodyOpen || bodyClose < 0) return null;
  const body = document.slice(bodyOpen.index + bodyOpen[0].length, bodyClose);
  // The body's own sectPr is its last child (one inside a paragraph ends a
  // section earlier on, and is followed by the paragraph's end).
  const lastSection = body.lastIndexOf('<w:sectPr');
  const tail = lastSection >= 0 ? body.slice(lastSection).trim() : '';
  const sectPr = /<\/w:sectPr>$|^<w:sectPr\b[^>]*\/>$/.test(tail) && !tail.includes('</w:p>') ? tail : '';
  const samples = styleSamples(text('word/styles.xml') ?? '');
  document = document.slice(0, bodyOpen.index + bodyOpen[0].length) + samples + sectPr + document.slice(bodyClose);
  files['word/document.xml'] = strToU8(document);
  // The sample lists' bullets and numbers; a document without lists may have
  // no numbering part, so it gets one.
  const numbering = text('word/numbering.xml');
  files['word/numbering.xml'] = strToU8(withSampleNumbering(numbering));

  // Footnotes and endnotes: only Word's separators.
  for (const [part, element] of [['word/footnotes.xml', 'w:footnote'], ['word/endnotes.xml', 'w:endnote']] as const) {
    const xml = text(part);
    if (xml) {
      const note = new RegExp(`<${element}\\b(?![^>]*\\bw:type=)[^>]*?(?:/>|>[\\s\\S]*?</${element}>)`, 'g');
      files[part] = strToU8(xml.replace(note, ''));
    }
  }

  // Pictures stay only where a header or footer uses them.
  const kept = new Set<string>();
  for (const name of Object.keys(files)) {
    if (!/^word\/_rels\/(header|footer)\d*\.xml\.rels$/.test(name)) continue;
    for (const match of strFromU8(files[name]).matchAll(/Target="([^"]+)"/g)) {
      kept.add(`word/${match[1].replace(/^\.\//, '').replace(/^\/word\//, '')}`);
    }
  }
  const removed = new Set(CONTENT_PARTS.filter((name) => files[name]));
  for (const name of Object.keys(files)) {
    if (/^word\/media\//.test(name) && !kept.has(name)) removed.add(name);
  }
  for (const name of removed) delete files[name];

  // Nothing may still point at a removed part.
  const rels = text('word/_rels/document.xml.rels');
  if (rels) {
    let kept = rels.replace(/<Relationship\b[^>]*\/>/g, (rel) => {
      const target = /Target="([^"]+)"/.exec(rel)?.[1] ?? '';
      if (/TargetMode="External"/.test(rel)) return /\/hyperlink"/.test(rel) ? '' : rel;
      const resolved = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
      return removed.has(resolved) ? '' : rel;
    });
    if (!numbering) {
      kept = kept.replace('</Relationships>', '<Relationship Id="rIdMdzSampleNumbering" '
        + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
    }
    files['word/_rels/document.xml.rels'] = strToU8(kept);
  }
  let types = strFromU8(contentTypes);
  if (!/PartName="\/word\/numbering\.xml"/.test(types)) {
    types = types.replace('</Types>', '<Override PartName="/word/numbering.xml" '
      + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  }
  for (const name of removed) {
    types = types.replace(new RegExp(`<Override\\b[^>]*PartName="/${escapeRegExp(name)}"[^>]*/>`, 'g'), '');
  }
  // A template's main part, as a document's.
  types = types.replace(/wordprocessingml\.template\.main\+xml/g, 'wordprocessingml.document.main+xml')
    .replace(/ms-word\.template\.macroEnabledTemplate\.main\+xml/g, 'wordprocessingml.document.main+xml');
  files['[Content_Types].xml'] = strToU8(types);

  // Who wrote it and what it's called: not the template's business.
  const core = text('docProps/core.xml');
  if (core) {
    files['docProps/core.xml'] = strToU8(core.replace(
      /<(dc:creator|cp:lastModifiedBy|dc:title|dc:subject|dc:description|cp:keywords|cp:category)\b([^>]*)>[\s\S]*?<\/\1>/g,
      '<$1$2></$1>',
    ));
  }

  return markAsCurrentWord(zipParts(files));
}
