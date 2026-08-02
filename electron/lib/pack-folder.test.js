const path = require('path');
const { resolveInsidePackFolder } = require('./pack-folder');

describe('resolveInsidePackFolder', () => {
  const root = path.resolve('/pack-root');

  it('resolves a relative path inside the folder', () => {
    expect(resolveInsidePackFolder(root, 'sub/file.md')).toBe(path.join(root, 'sub', 'file.md'));
  });

  it('rejects a path that escapes the folder via ..', () => {
    expect(() => resolveInsidePackFolder(root, '../outside.md')).toThrow(/outside the selected folder/);
  });

  it('rejects an absolute path outside the folder', () => {
    const outside = path.resolve('/elsewhere/file.md');
    expect(() => resolveInsidePackFolder(root, outside)).toThrow(/outside the selected folder/);
  });

  it('allows an absolute path that is still inside the folder', () => {
    const inside = path.join(root, 'nested', 'file.md');
    expect(resolveInsidePackFolder(root, inside)).toBe(inside);
  });
});
