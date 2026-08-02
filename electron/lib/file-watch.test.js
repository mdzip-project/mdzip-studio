const { statsDiffer } = require('./file-watch');

describe('statsDiffer', () => {
  it('is false when mtime and size both match', () => {
    expect(statsDiffer({ mtimeMs: 100, size: 10 }, { mtimeMs: 100, size: 10 })).toBe(false);
  });

  it('is true when mtime moved', () => {
    expect(statsDiffer({ mtimeMs: 100, size: 10 }, { mtimeMs: 200, size: 10 })).toBe(true);
  });

  it('is true when size moved', () => {
    expect(statsDiffer({ mtimeMs: 100, size: 10 }, { mtimeMs: 100, size: 20 })).toBe(true);
  });

  it('is true when there was no prior baseline', () => {
    expect(statsDiffer(null, { mtimeMs: 100, size: 10 })).toBe(true);
  });

  it('is false when both are null (no file, still no file)', () => {
    expect(statsDiffer(null, null)).toBe(false);
  });
});
