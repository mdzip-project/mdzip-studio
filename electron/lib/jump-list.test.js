const path = require('path');
const {
  NEW_WINDOW_FLAG, jumpListLaunchArgs, newWindowLaunchArgs, wantsNewWindow, startupActionFromArgs,
  jumpListIconFor, buildJumpList,
} = require('./jump-list');

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

describe('newWindowLaunchArgs / wantsNewWindow', () => {
  it('is just the flag when packaged, prefixed with the app path in dev', () => {
    expect(newWindowLaunchArgs({ isPackaged: true, appPath: 'C:\\app' })).toBe('--new-window');
    expect(newWindowLaunchArgs({ isPackaged: false, appPath: 'C:\\app' })).toBe('"C:\\app" --new-window');
  });

  it('recognizes the flag in a relaunch command line, and only the flag', () => {
    expect(wantsNewWindow(['--new-window'])).toBe(true);
    expect(wantsNewWindow(['C:\\app', NEW_WINDOW_FLAG])).toBe(true);
    expect(wantsNewWindow(['C:\\notes.mdz'])).toBe(false);
    expect(wantsNewWindow([])).toBe(false);
    expect(wantsNewWindow(undefined)).toBe(false);
  });
});

describe('startupActionFromArgs', () => {
  it('maps the new-document flags to a new-document startup action', () => {
    expect(startupActionFromArgs(['--new-md'])).toEqual({ kind: 'new-document', format: 'markdown' });
    expect(startupActionFromArgs(['C:\\app', '--new-mdz'])).toEqual({ kind: 'new-document', format: 'mdz' });
  });

  it('is null for anything else, including a plain new-window or file launch', () => {
    expect(startupActionFromArgs(['--new-window'])).toBeNull();
    expect(startupActionFromArgs(['C:\\notes.md'])).toBeNull();
    expect(startupActionFromArgs([])).toBeNull();
    expect(startupActionFromArgs(undefined)).toBeNull();
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

  const newWindowTask = {
    type: 'tasks',
    items: [
      {
        type: 'task',
        program: opts.execPath,
        args: '--new-md',
        title: 'New Markdown Document',
        description: 'Create a new Markdown (.md) document in a new window',
        iconPath: path.join('C:\\icons', 'md.ico'),
        iconIndex: 0,
      },
      {
        type: 'task',
        program: opts.execPath,
        args: '--new-mdz',
        title: 'New MDZip Document',
        description: 'Create a new MDZip (.mdz) document in a new window',
        iconPath: path.join('C:\\icons', 'mdz.ico'),
        iconIndex: 0,
      },
      {
        type: 'task',
        program: opts.execPath,
        args: '--new-window',
        title: 'New Window',
        description: 'Open a new MDZip Studio window',
        iconPath: path.join('C:\\icons', 'mdz.ico'),
        iconIndex: 0,
      },
    ],
  };

  it('with no recent .md/.mdz paths, still offers just the Tasks (new document/window)', () => {
    expect(buildJumpList([], opts)).toEqual([newWindowTask]);
    expect(buildJumpList(['notes.txt'], opts)).toEqual([newWindowTask]);
    expect(buildJumpList(undefined, opts)).toEqual([newWindowTask]);
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
      newWindowTask,
    ]);
  });

  it('caps the list at 10 items', () => {
    const paths = Array.from({ length: 15 }, (_, i) => `file-${i}.md`);
    const result = buildJumpList(paths, opts);
    expect(result[0].items).toHaveLength(10);
  });
});
