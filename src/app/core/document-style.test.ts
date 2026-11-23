import { documentStylePath, PREVIEW_SCOPE, scopeDocumentStyle, scopeSelector } from './document-style';

const ROOT = `${PREVIEW_SCOPE} .preview-content`;
const files: Record<string, string> = {
  'styles/fonts/body.woff2': 'data:font/woff2;base64,AAAA',
  'images/paper.png': 'data:image/png;base64,BBBB',
};
const read = async (path: string) => files[path] ?? null;

describe('documentStylePath', () => {
  it('takes the one-file form of the manifest\'s styles', () => {
    expect(documentStylePath({ styles: 'styles/style.css' })).toBe('styles/style.css');
    expect(documentStylePath({ styles: './styles/style.css' })).toBe('styles/style.css');
  });

  it('ignores anything else', () => {
    for (const styles of [undefined, '', 'style.txt', '../style.css', '/style.css', 'https://example.com/a.css', 'a\\b.css', [{ id: 'a', files: ['a.css'] }]]) {
      expect(documentStylePath({ styles })).toBeNull();
    }
    expect(documentStylePath(null)).toBeNull();
  });
});

describe('scopeSelector', () => {
  it('puts every selector inside the document, which html, body and :root stand for', () => {
    expect(scopeSelector('h1, h2', '.doc')).toBe('.doc h1, .doc h2');
    expect(scopeSelector('body', '.doc')).toBe('.doc');
    expect(scopeSelector(':root', '.doc')).toBe('.doc');
    expect(scopeSelector('html body p', '.doc')).toBe('.doc p');
    expect(scopeSelector('body > p', '.doc')).toBe('.doc > p');
    expect(scopeSelector('body.wide', '.doc')).toBe('.doc.wide');
    expect(scopeSelector('td[style*="a,b"], th', '.doc')).toBe('.doc td[style*="a,b"], .doc th');
    expect(scopeSelector('bodyguard', '.doc')).toBe('.doc bodyguard');
  });
});

describe('scopeDocumentStyle', () => {
  it('scopes rules to the preview, following its zoom', async () => {
    const css = await scopeDocumentStyle('body { font-size: 11pt; color: #123456 } h1 { color: red }', 'styles/style.css', 'preview', read);
    expect(css).toContain(`${ROOT} { font-size: calc(11pt * var(--mdz-zoom, 1)); color: rgb(18, 52, 86); }`);
    expect(css).toContain(`${ROOT} h1 { color: red; }`);
  });

  it("follows Studio's theme for prefers-color-scheme, and uses the light colours for print", async () => {
    const source = 'h1 { color: navy } @media (prefers-color-scheme: dark) { h1 { color: skyblue } } @media screen and (prefers-color-scheme: light) { p { color: black } }';
    const preview = await scopeDocumentStyle(source, 'style.css', 'preview', read);
    expect(preview).toContain(`${PREVIEW_SCOPE}.mdzip-theme-dark .preview-content h1 { color: skyblue; }`);
    expect(preview).toContain(`${PREVIEW_SCOPE}.mdzip-theme-light .preview-content p { color: black; }`);
    expect(preview).not.toContain('prefers-color-scheme');

    const print = await scopeDocumentStyle(source, 'style.css', 'print', read);
    expect(print).toContain('.print-root h1 { color: navy; }');
    expect(print).toContain('.print-root p { color: black; }');
    expect(print).not.toContain('skyblue');
  });

  it('loads only files in the archive, as data: URIs, and nothing from outside', async () => {
    const source = [
      '@import url("https://tracker.example/a.css");',
      '@font-face { font-family: Body; src: url(fonts/body.woff2) format("woff2"); }',
      'body { background-image: url("../images/paper.png"); }',
      'p { background-image: url(https://tracker.example/open?id=42); color: green; }',
      'li { list-style-image: url(../../secrets.png); }',
      'h2 { cursor: url(file:///C:/x.cur), auto; }',
      'h3 { background-image: url(data:image/gif;base64,R0lG); }',
    ].join('\n');
    const css = await scopeDocumentStyle(source, 'styles/style.css', 'preview', read);
    expect(css).not.toContain('tracker.example');
    expect(css).not.toContain('@import');
    expect(css).not.toContain('secrets');
    expect(css).not.toContain('file:');
    // (jsdom's CSS parser drops @font-face src, so the font isn't checked here.)
    expect(css).toContain('data:image/png;base64,BBBB');
    expect(css).toContain('data:image/gif;base64,R0lG');
    // The rest of a rule with a blocked url() stays.
    expect(css).toContain(`${ROOT} p { color: green; }`);
  });

  it('keeps @media and @supports around scoped rules; @page only for print', async () => {
    const source = '@media print { h1 { break-before: page } } @supports (display: grid) { ul { display: grid } } @page { margin: 1in }';
    const preview = await scopeDocumentStyle(source, 'style.css', 'preview', read);
    expect(preview).toMatch(/@media print \{ .* h1 \{ break-before: page; \} \}/);
    expect(preview).toContain(`@supports (display: grid) { ${ROOT} ul { display: grid; } }`);
    expect(preview).not.toContain('@page');
    expect(await scopeDocumentStyle(source, 'style.css', 'print', read)).toContain('@page');
  });

  it("keeps a page's picture from the archive for print (a letterhead), and not one from outside", async () => {
    const letterhead = await scopeDocumentStyle('@page :first { background-image: url(../images/paper.png) }', 'styles/style.css', 'print', read);
    expect(letterhead).toContain('@page :first');
    expect(letterhead).toContain('data:image/png;base64,BBBB');
    expect(await scopeDocumentStyle('@page { background-image: url(https://tracker.example/p.png) }', 'style.css', 'print', read)).toBe('');
  });

  it('gives nothing for a stylesheet that is all junk', async () => {
    expect(await scopeDocumentStyle('}{ not css', 'style.css', 'preview', read)).toBe('');
  });
});
