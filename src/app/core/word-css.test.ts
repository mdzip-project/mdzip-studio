import { strToU8, zipSync } from 'fflate';
import { contrast, DARK_PAGE, darkFill, darkLine, darkText, wordStylesheet } from './word-css';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docx(styles: string, { theme = '', document = '' } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'word/styles.xml': strToU8(`<w:styles ${W}>${styles}</w:styles>`),
    'word/document.xml': strToU8(`<w:document ${W}><w:body>${document}</w:body></w:document>`),
  };
  if (theme) files['word/theme/theme1.xml'] = strToU8(theme);
  return zipSync(files);
}

const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>
</a:themeElements></a:theme>`;

// The shape of a recent Word document's styles (trimmed).
const OFFICE_STYLES = `
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
  <w:pPr><w:spacing w:before="240" w:after="0"/></w:pPr>
  <w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:rPr><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>
  <w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>`;

const rule = (css: string, selector: string, dark = false): string => {
  const part = dark ? css.slice(css.indexOf('@media (prefers-color-scheme: dark)')) : css.slice(0, css.indexOf('@media'));
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`).exec(part)?.[1] ?? '';
};

describe('wordStylesheet', () => {
  it("writes a Word document's fonts, sizes, colours and spacing, from its theme too", () => {
    const css = wordStylesheet(docx(OFFICE_STYLES, { theme: THEME, document: '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr></w:tbl>' }), 'Report.docx')!;
    expect(css).toContain('The look of Report.docx');
    const body = rule(css, 'body');
    expect(body).toContain('font-family: "Calibri", "Carlito"');
    expect(body).toContain('font-size: 11pt');
    expect(body).toContain('line-height: 1.24');
    expect(rule(css, 'p')).toContain('margin-bottom: 8pt');

    const h1 = rule(css, 'h1');
    expect(h1).toContain('font-family: "Calibri Light"');
    expect(h1).toContain('font-size: 16pt');
    expect(h1).toContain('font-weight: normal');
    // accent1 with Word's 75% shade, as Word saved it.
    expect(h1).toContain('color: #2F5496');
    expect(h1).toContain('margin-top: 12pt');
    expect(h1).toContain('border-bottom: none');
    // Heading 2 is based on Heading 1: its colour, its own size.
    expect(rule(css, 'h2')).toContain('font-size: 13pt');
    expect(rule(css, 'h2')).toContain('color: #2F5496');
    expect(rule(css, 'a')).toContain('color: #0563C1');

    // The usual table: Table Grid's lines, in the text colour ("auto").
    expect(rule(css, 'table')).toContain('border-top: 0.5pt solid currentColor');
    expect(rule(css, 'th, td')).toContain('border-left: 0.5pt solid currentColor');
    // Table Grid doesn't make the first row look different, so a header cell
    // is plain, and it wraps.
    expect(rule(css, 'th')).toContain('white-space: normal');
    expect(rule(css, 'th')).toContain('font-weight: normal');
    expect(rule(css, 'th')).toContain('background: transparent');
    // No zebra stripes from the viewer: Word's rows aren't striped.
    expect(rule(css, 'tbody tr:nth-child(even)')).toContain('background: transparent');
  });

  it('gives each colour a dark version that reads on the dark page', () => {
    const css = wordStylesheet(docx(OFFICE_STYLES, { theme: THEME }))!;
    const darkH1 = /color: (#[0-9A-F]{6})/.exec(rule(css, 'h1', true))![1];
    expect(contrast(darkH1, DARK_PAGE)).toBeGreaterThanOrEqual(4.5);
    // The same hue: still blue.
    const [r, , b] = [1, 3, 5].map((i) => parseInt(darkH1.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    // Shaded cells (their colour is on the cell, in the document) get dark text.
    expect(rule(css, 'td[style*="background"], th[style*="background"]', true)).toContain('color: #1A1A1A');
  });

  it('keeps a heading shaded as a band, and its page break', () => {
    const styles = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
  <w:pPr><w:pageBreakBefore/><w:shd w:val="solid" w:color="auto" w:fill="auto"/><w:spacing w:after="360"/></w:pPr>
  <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:smallCaps/><w:color w:val="FFFFFF"/><w:sz w:val="40"/></w:rPr></w:style>`;
    const css = wordStylesheet(docx(styles))!;
    // Nothing sets a size: Word's 10pt.
    expect(rule(css, 'body')).toContain('font-size: 10pt');
    const h1 = rule(css, 'h1');
    expect(h1).toContain('background: #000000');
    expect(h1).toContain('color: #FFFFFF');
    expect(h1).toContain('font-variant: small-caps');
    expect(h1).toContain('break-before: page');
    // A black band stays black, and its white text stays white.
    expect(rule(css, 'h1', true)).not.toContain('background');
  });

  it("uses a table's own lines when most tables have them, and the header row's shading", () => {
    const styles = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="table" w:styleId="Fancy"><w:name w:val="Fancy"/><w:tblPr/>
  <w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr></w:tblStylePr></w:style>`;
    const own = '<w:tbl><w:tblPr><w:tblStyle w:val="Fancy"/><w:tblBorders><w:top w:val="double" w:sz="12" w:color="8EAADB"/><w:insideH w:val="nil"/></w:tblBorders></w:tblPr></w:tbl>';
    const css = wordStylesheet(docx(styles, { document: own + own }))!;
    expect(rule(css, 'table')).toContain('border-top: 1.5pt double #8EAADB');
    expect(rule(css, 'table')).toContain('border-left: none');
    expect(rule(css, 'th, td')).toContain('border-top: none');
    expect(rule(css, 'th')).toContain('background: #4472C4');
    expect(rule(css, 'th')).toContain('color: #FFFFFF');
    expect(rule(css, 'th')).toContain('font-weight: bold');
    expect(rule(css, 'table', true)).toContain('border-top-color:');
  });

  it('uses the font most of the text has set on it, when that differs from its style (as LibreOffice saves)', () => {
    const styles = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>`;
    const run = (text: string, font = '') => `<w:r>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr>` : ''}<w:t>${text}</w:t></w:r>`;
    const document = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run('Welcome', 'Open Sans')}</w:p>`
      + `<w:p>${run('Most of the text is in Open Sans.', 'Open Sans')}${run('A little', 'Courier New')}</w:p>`
      + `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run('Mixed', 'Open Sans')}${run('and mostly plain')}</w:p>`;
    const css = wordStylesheet(docx(styles, { document }))!;
    expect(rule(css, 'body')).toContain('font-family: "Open Sans"');
    // Heading 1's own font is set aside, and it's the body's, so not repeated.
    expect(rule(css, 'h1')).not.toContain('font-family');
    // Heading 2's text is mostly the style's own font: the style's (Normal's) stays.
    expect(rule(css, 'h2')).toContain('font-family: "Times New Roman"');
  });

  it("is null for a file that isn't a Word document", () => {
    expect(wordStylesheet(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(wordStylesheet(zipSync({ 'a.txt': strToU8('x') }))).toBeNull();
  });
});

describe('dark colours', () => {
  it('turns text over and keeps it readable', () => {
    for (const colour of ['#000000', '#2F5496', '#C00000', '#44546A', '#0563C1', '#FFFF00']) {
      expect(contrast(darkText(colour), DARK_PAGE)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(darkLine('#000000'), DARK_PAGE)).toBeGreaterThanOrEqual(3);
  });

  it('makes a light fill dark enough for light text', () => {
    for (const colour of ['#CCCCCC', '#D9E2F3', '#FFF2CC']) {
      expect(contrast(darkFill(colour), '#E6E6E6')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
