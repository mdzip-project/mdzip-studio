const fs = require('fs');
const os = require('os');
const path = require('path');
const { planExtract, resolveInsideFolder, existingTargets, writeFilesInto } = require('./extract-files');

const bytes = (text) => new Uint8Array(Buffer.from(text));

describe('planExtract', () => {
  it('saves one picked file under its own name', () => {
    expect(planExtract({ files: [{ path: 'images/a.webp', bytes: bytes('x') }], selection: { files: ['images/a.webp'], folders: [] } }))
      .toEqual({ kind: 'file', fileName: 'a.webp' });
  });

  it('writes several files, or a folder, into a picked folder', () => {
    expect(planExtract({ files: [{ path: 'a.md' }, { path: 'b.md' }], selection: { files: ['a.md', 'b.md'], folders: [] } }).kind).toBe('folder');
    expect(planExtract({ files: [{ path: 'images/a.webp' }], selection: { files: [], folders: ['images'] } }).kind).toBe('folder');
    expect(planExtract({ files: [], selection: { files: [], folders: [''] } }).kind).toBe('folder');
  });
});

describe('resolveInsideFolder', () => {
  const root = path.resolve('/extract-root');

  it('keeps the archive path under the folder', () => {
    expect(resolveInsideFolder(root, 'images/a.webp')).toBe(path.join(root, 'images', 'a.webp'));
  });

  it('refuses paths that escape or are empty', () => {
    expect(() => resolveInsideFolder(root, '../x.md')).toThrow(/invalid archive path/);
    expect(() => resolveInsideFolder(root, 'a/./b.md')).toThrow(/invalid archive path/);
    expect(() => resolveInsideFolder(root, '')).toThrow(/invalid archive path/);
  });
});

describe('writeFilesInto / existingTargets', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdz-extract-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes files at their archive paths and reports the ones it would replace', async () => {
    const files = [{ path: 'doc.md', bytes: bytes('# Hi') }, { path: 'images/a.txt', bytes: bytes('a') }];
    expect(await existingTargets(root, files)).toEqual([]);
    expect(await writeFilesInto(root, files)).toBe(2);
    expect(fs.readFileSync(path.join(root, 'images', 'a.txt'), 'utf8')).toBe('a');
    expect(await existingTargets(root, files)).toEqual(['doc.md', 'images/a.txt']);
  });

  it('writes nothing when any path is invalid', async () => {
    await expect(writeFilesInto(root, [{ path: 'ok.md', bytes: bytes('x') }, { path: '../bad.md', bytes: bytes('y') }]))
      .rejects.toThrow(/invalid archive path/);
    expect(fs.existsSync(path.join(root, 'ok.md'))).toBe(false);
  });
});
