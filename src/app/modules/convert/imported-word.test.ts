import { MdzArchiveCore, MdzPackagerCore } from '@mdzip/core-js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { stylesOnlyCopy } from '../../core/word-template';
import { addImportedWordFiles, isWordFileName } from './imported-word';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

// A Word document with text, a picture in the body, a footnote, a comment, an
// author, and a header with its own picture.
function wordDocument({ template = false } = {}): Uint8Array {
  const main = template ? 'template' : 'document';
  return zipSync({
    '[Content_Types].xml': strToU8([
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${main}.main+xml"/>`,
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      '</Types>',
    ].join('')),
    'word/document.xml': strToU8(`<w:document ${W}><w:body>`
      + '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>Secret plan</w:t></w:r></w:p>'
      + '<w:p><w:r><w:drawing>rIdBody</w:drawing></w:r></w:p>'
      + '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>'
      + '</w:body></w:document>'),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdBody" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.png"/>'
      + '<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
      + '<Relationship Id="rIdCom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'
      + '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://secret.example" TargetMode="External"/>'
      + '</Relationships>'),
    'word/header1.xml': strToU8(`<w:hdr ${W}><w:p><w:r><w:t>Company</w:t></w:r></w:p></w:hdr>`),
    'word/_rels/header1.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>'),
    'word/media/photo.png': PNG,
    'word/media/logo.png': PNG,
    'word/footnotes.xml': strToU8(`<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>`
      + '<w:footnote w:id="1"><w:p><w:r><w:t>Secret note</w:t></w:r></w:p></w:footnote></w:footnotes>'),
    'word/comments.xml': strToU8(`<w:comments ${W}><w:comment w:id="0" w:author="Kyle"/></w:comments>`),
    'word/styles.xml': strToU8(`<w:styles ${W}><w:style w:styleId="Heading1"/></w:styles>`),
    'word/settings.xml': strToU8(`<w:settings ${W}><w:zoom w:percent="100"/></w:settings>`),
    'docProps/core.xml': strToU8('<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:creator>Kyle White</dc:creator><dc:title>Plan</dc:title></cp:coreProperties>'),
  });
}

describe('stylesOnlyCopy', () => {
  it('keeps how it looks: styles, the last page setup, the header and its picture', () => {
    const files = unzipSync(stylesOnlyCopy(wordDocument())!);
    const document = strFromU8(files['word/document.xml']);
    expect(document).toContain('w:orient="landscape"');
    expect(document).toContain('rIdHdr');
    expect(files['word/header1.xml']).toBeTruthy();
    expect(files['word/media/logo.png']).toBeTruthy();
    expect(strFromU8(files['word/styles.xml'])).toContain('Heading1');
    expect(strFromU8(files['word/settings.xml'])).toContain('compatibilityMode');
  });

  it('gets numbering for its sample lists, though it had none', () => {
    const files = unzipSync(stylesOnlyCopy(wordDocument())!);
    expect(strFromU8(files['word/numbering.xml'])).toContain('<w:num w:numId="9801">');
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('Target="numbering.xml"');
    expect(strFromU8(files['[Content_Types].xml'])).toContain('PartName="/word/numbering.xml"');
    expect(strFromU8(files['word/document.xml'])).toContain('<w:numId w:val="9801"/>');
  });

  it('drops what was written: text, body pictures, footnotes, comments, authors, links', () => {
    const files = unzipSync(stylesOnlyCopy(wordDocument())!);
    const all = Object.entries(files).filter(([name]) => !name.startsWith('word/media/')).map(([, bytes]) => strFromU8(bytes)).join(' ');
    for (const secret of ['Secret plan', 'Secret note', 'Kyle White', '<dc:title>Plan', 'secret.example']) {
      expect(all).not.toContain(secret);
    }
    expect(files['word/media/photo.png']).toBeUndefined();
    expect(files['word/comments.xml']).toBeUndefined();
    const rels = strFromU8(files['word/_rels/document.xml.rels']);
    expect(rels).not.toContain('photo.png');
    expect(rels).not.toContain('comments.xml');
    expect(strFromU8(files['[Content_Types].xml'])).not.toContain('comments.xml');
    expect(strFromU8(files['word/footnotes.xml'])).toContain('w:type="separator"');
  });

  it("shows a sample of each style it has, so it isn't a blank page in Word", () => {
    const document = strFromU8(unzipSync(stylesOnlyCopy(wordDocument())!)['word/document.xml']);
    expect(document).toContain('change its styles');
    // Its styles.xml has Heading1 (unnamed here), so no heading sample; the
    // table sample uses the "Table" style only when there is one.
    expect(document).not.toContain('Heading 1');
    expect(document).not.toContain('<w:tbl>');
    expect(document.indexOf('change its styles')).toBeLessThan(document.indexOf('<w:sectPr><w:headerReference'));
  });

  it('a template comes out as a document', () => {
    const types = strFromU8(unzipSync(stylesOnlyCopy(wordDocument({ template: true }))!)['[Content_Types].xml']);
    expect(types).toContain('wordprocessingml.document.main+xml');
    expect(types).not.toContain('template.main');
  });

  it("isn't fooled by something that isn't Word", () => {
    expect(stylesOnlyCopy(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(stylesOnlyCopy(zipSync({ 'a.txt': strToU8('x') }))).toBeNull();
  });
});

describe('addImportedWordFiles', () => {
  async function importedMdz(extra: { path: string; text: string }[] = []): Promise<Uint8Array> {
    const built = await MdzPackagerCore.buildArchive(
      [{ path: 'index.md', text: '# Plan\n' }, ...extra],
      'plan',
      { createIndex: false, mapFiles: false, filters: ['**/*'], title: 'Plan', mode: 'document', entryPoint: 'index.md' },
    );
    return new Uint8Array(await built.blob.arrayBuffer());
  }

  it('adds the styles (named in the manifest) and the original, as asked', async () => {
    const original = wordDocument();
    const result = await addImportedWordFiles(await importedMdz(), { fileName: 'Plan.docx', bytes: original, keepStyles: true, keepOriginal: true });
    expect(result).toMatchObject({ styles: 'styles/reference.docx', original: 'sources/Plan.docx', stylesSkipped: false });
    const archive = await MdzArchiveCore.open(result.bytes);
    expect(archive.listPaths()).toEqual(expect.arrayContaining(['index.md', 'styles/reference.docx', 'sources/Plan.docx']));
    expect([...(await archive.readBytes('sources/Plan.docx'))]).toEqual([...original]);
    expect(((await archive.readManifest()) as { pandoc?: { referenceDoc?: string } }).pandoc?.referenceDoc).toBe('styles/reference.docx');
  });

  it('only the styles by default; the manifest names nothing when they are off', async () => {
    const mdz = await importedMdz();
    const stylesOnly = await addImportedWordFiles(mdz, { fileName: 'Plan.docx', bytes: wordDocument(), keepStyles: true, keepOriginal: false });
    expect((await MdzArchiveCore.open(stylesOnly.bytes)).listPaths()).not.toContain('sources/Plan.docx');

    const originalOnly = await addImportedWordFiles(mdz, { fileName: 'Plan.docx', bytes: wordDocument(), keepStyles: false, keepOriginal: true });
    const archive = await MdzArchiveCore.open(originalOnly.bytes);
    expect(archive.listPaths()).not.toContain('styles/reference.docx');
    expect(((await archive.readManifest()) as { pandoc?: unknown }).pandoc).toBeUndefined();
  });

  it('adds its look as the stylesheet the manifest names', async () => {
    const result = await addImportedWordFiles(await importedMdz(),
      { fileName: 'C:\\Docs\\Plan.docx', bytes: wordDocument(), keepStyles: false, keepOriginal: false, documentStyle: true });
    expect(result.stylesheet).toBe('styles/style.css');
    const archive = await MdzArchiveCore.open(result.bytes);
    expect(await archive.readText('styles/style.css')).toContain('The look of Plan.docx');
    expect(((await archive.readManifest()) as { styles?: unknown }).styles).toBe('styles/style.css');
  });

  it('leaves a stylesheet the document already names alone', async () => {
    const mdz = await importedMdz([{ path: 'styles/style.css', text: 'h1 { color: red }' }]);
    const archive = await MdzArchiveCore.open(mdz);
    const named = await MdzArchiveCore.updateFiles(mdz, [], [], {
      manifest: { ...((await archive.readManifest()) as object), styles: 'styles/style.css' } as never,
    });
    const result = await addImportedWordFiles(new Uint8Array(await named.blob.arrayBuffer()),
      { fileName: 'Plan.docx', bytes: wordDocument(), keepStyles: false, keepOriginal: false, documentStyle: true });
    expect(result.stylesheet).toBeNull();
    expect(await (await MdzArchiveCore.open(result.bytes)).readText('styles/style.css')).toBe('h1 { color: red }');
  });

  it("doesn't overwrite files the import already made", async () => {
    const result = await addImportedWordFiles(await importedMdz([{ path: 'sources/Plan.docx', text: 'x' }]),
      { fileName: 'Plan.docx', bytes: wordDocument(), keepStyles: false, keepOriginal: true });
    expect(result.original).toBe('sources/Plan-2.docx');
  });

  it('recognizes Word documents and templates by name', () => {
    expect(isWordFileName('Plan.DOCX')).toBe(true);
    expect(isWordFileName('Company.dotx')).toBe(true);
    expect(isWordFileName('Slides.pptx')).toBe(false);
  });
});
