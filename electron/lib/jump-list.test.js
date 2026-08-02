const path = require('path');
const { jumpListLaunchArgs, jumpListIconFor, buildJumpList } = require('./jump-list');

describe('jumpListLaunchArgs', () => {
  it('is just the quoted file path when packaged', () => {
    expect(jumpListLaunchArgs('C:\\notes.mdz', { isPackaged: true, appPath: 'C:\\app' }))
      .toBe('"C:\\notes.mdz"');
  });

  it('prefixes the app path in dev', () => {
    expect(jumpListLaunchArgs('C:\\notes.mdz', { isPackaged: false, appPath: 'C:\\app' }))
      .toBe('"C:\\app" "C:\\notes.mdz"');
  });
});

describe('jumpListIconFor', () => {
  it('picks md.ico for a .md path', () => {
    expect(jumpListIconFor('notes.md', 'C:\\icons')).toEqual({
      iconPath: path.join('C:\\icons', 'md.ico'),
      iconIndex: 0,
    });
  });

  it('picks mdz.ico for anything else', () => {
    expect(jumpListIconFor('archive.mdz', 'C:\\icons')).toEqual({
      iconPath: path.join('C:\\icons', 'mdz.ico'),
      iconIndex: 0,
    });
  });
});

describe('buildJumpList', () => {
  const opts = { isPackaged: true, appPath: 'C:\\app', execPath: 'C:\\app\\Studio.exe', fileIconsDir: 'C:\\icons' };

  it('returns null when there are no recent .md/.mdz paths', () => {
    expect(buildJumpList([], opts)).toBeNull();
    expect(buildJumpList(['notes.txt'], opts)).toBeNull();
    expect(buildJumpList(undefined, opts)).toBeNull();
  });

  it('filters to .md/.mdz and builds task items', () => {
    const result = buildJumpList(['a.md', 'b.txt', 'c.mdz'], opts);
    expect(result).toEqual([
      {
        type: 'custom',
        name: 'Recent',
        items: [
          {
            type: 'task',
            program: opts.execPath,
            args: '"a.md"',
            title: 'a.md',
            description: 'a.md',
            iconPath: path.join('C:\\icons', 'md.ico'),
            iconIndex: 0,
          },
          {
            type: 'task',
            program: opts.execPath,
            args: '"c.mdz"',
            title: 'c.mdz',
            description: 'c.mdz',
            iconPath: path.join('C:\\icons', 'mdz.ico'),
            iconIndex: 0,
          },
        ],
      },
    ]);
  });

  it('caps the list at 10 items', () => {
    const paths = Array.from({ length: 15 }, (_, i) => `file-${i}.md`);
    const result = buildJumpList(paths, opts);
    expect(result[0].items).toHaveLength(10);
  });
});
