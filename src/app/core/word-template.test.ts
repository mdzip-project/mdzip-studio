import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { markAsCurrentWord, styleSamples, withCurrentWordCompat, withTableStyle } from './word-template';

// The shape of Pandoc 3.x's reference.docx settings.xml (trimmed).
const PANDOC_SETTINGS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">',
  '  <w:zoom w:percent="100" />',
  '  <w:footnotePr>',
  '    <w:footnote w:id="-1" />',
  '  </w:footnotePr>',
  '  <w:rsids>',
  '  </w:rsids>',
  '  <m:mathPr>',
  '  </m:mathPr>',
  '  <w:decimalSymbol w:val="." />',
  '</w:settings>',
].join('\n');

describe('Word template marked as current Word', () => {
  it('adds compatibilityMode 15 where the schema puts it: after footnotePr, before rsids', () => {
    const out = withCurrentWordCompat(PANDOC_SETTINGS);
    expect(out).toContain('w:name="compatibilityMode"');
    expect(out).toContain('w:val="15"');
    expect(out.indexOf('<w:compat>')).toBeGreaterThan(out.indexOf('</w:footnotePr>'));
    expect(out.indexOf('<w:compat>')).toBeLessThan(out.indexOf('<w:rsids>'));
  });

  it('leaves settings that already name a version alone', () => {
    const own = PANDOC_SETTINGS.replace('<w:rsids>', '<w:compat><w:compatSetting w:name="compatibilityMode" w:val="14"/></w:compat><w:rsids>');
    expect(withCurrentWordCompat(own)).toBe(own);
  });

  it('rewrites only settings.xml in the .docx, keeping the other parts', () => {
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document/>'),
      'word/settings.xml': strToU8(PANDOC_SETTINGS),
    });
    const files = unzipSync(markAsCurrentWord(docx));
    expect(Object.keys(files)[0]).toBe('[Content_Types].xml');
    expect(strFromU8(files['word/document.xml'])).toBe('<w:document/>');
    expect(strFromU8(files['word/settings.xml'])).toContain('compatibilityMode');
  });

  it("gives back what it can't read unchanged", () => {
    const notZip = new Uint8Array([1, 2, 3]);
    expect(markAsCurrentWord(notZip)).toBe(notZip);
  });
});

describe('withTableStyle', () => {
  const STYLES = '<w:styles><w:style w:type="table" w:styleId="TableNormal"/><w:style w:type="table" w:styleId="TableGrid"/></w:styles>';
  const BLACK = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:color="000000"/></w:tblBorders>';
  const BLUE = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="8EAADB"/></w:tblBorders>';
  const table = (props: string) => `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${props}</w:tblPr><w:tr/></w:tbl>`;

  it("gives Pandoc's Table style the borders most tables have", () => {
    const styles = withTableStyle(STYLES, table(BLACK) + table(BLUE) + table(BLACK));
    expect(styles).toContain('w:styleId="Table"');
    expect(styles).toContain('<w:basedOn w:val="TableNormal"/>');
    expect(styles).toContain(`<w:tblPr>${BLACK}</w:tblPr>`);
    expect(styles).not.toContain('8EAADB');
  });

  it('or the table style most tables use', () => {
    const styles = withTableStyle(STYLES, table('<w:tblStyle w:val="TableGrid"/>'));
    expect(styles).toContain('<w:basedOn w:val="TableGrid"/>');
  });

  it('leaves it alone when there is a Table style, or no tables with a look', () => {
    const own = '<w:styles><w:style w:type="table" w:styleId="Table"/></w:styles>';
    expect(withTableStyle(own, table(BLACK))).toBe(own);
    expect(withTableStyle(STYLES, table(''))).toBe(STYLES);
    expect(withTableStyle(STYLES, '<w:p/>')).toBe(STYLES);
  });
});

describe('styleSamples', () => {
  const styles = '<w:styles>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Corps"><w:name w:val="Body Text"/></w:style>'
    + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style>'
    + '<w:style w:type="table" w:styleId="Table"><w:name w:val="Table"/></w:style>'
    + '</w:styles>';

  it('shows each style the document has, by its id, and a table in the "Table" style', () => {
    const body = styleSamples(styles);
    expect(body).toContain('<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Heading 1</w:t>');
    // Found by its name, whatever its id.
    expect(body).toContain('<w:pStyle w:val="Corps"/></w:pPr><w:r><w:t xml:space="preserve">Body Text: every other paragraph.');
    expect(body).toContain('<w:rStyle w:val="Hyperlink"/>');
    expect(body).toContain('<w:tblStyle w:val="Table"/>');
    expect(body).not.toContain('Heading 2');
    expect(body).not.toContain('Title');
    // Ends with a paragraph, as a body must before its sectPr.
    expect(body.endsWith('</w:p>')).toBe(true);
  });

  it('still shows the help line with no styles', () => {
    expect(styleSamples('')).toContain('change its styles');
  });
});
