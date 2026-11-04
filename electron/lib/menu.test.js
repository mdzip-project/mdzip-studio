const { buildMenuTemplate, buildPreviewMenuTemplate, buildDockMenuTemplate, recentLabel, shortenFolder } = require('./menu');

const HANDLER_NAMES = [
  'newDocument', 'newWindow', 'openDocument', 'openRecentPath', 'packFolder', 'unpackMdz',
  'save', 'saveAs', 'print', 'showInFolder', 'insertAgentsGuide', 'insertReadme', 'closeDocument', 'quit',
  'reload', 'toggleLineNumbers', 'toggleRemoteImages', 'toggleDevTools',
  'setMdDefault', 'showKnownIssues', 'showChangelog', 'checkForUpdates', 'showAbout',
  'exportDraft',
];

function stubHandlers() {
  const handlers = {};
  for (const name of HANDLER_NAMES) handlers[name] = vi.fn();
  return handlers;
}

function labelsOf(submenu) {
  return submenu.map((item) => item.label ?? `[${item.type ?? item.role}]`);
}

function findMenu(template, label) {
  return template.find((item) => item.label === label);
}

describe('buildMenuTemplate', () => {
  it('omits document-only File items when no document is open', () => {
    const template = buildMenuTemplate({
      documentOpen: false, isDev: false, platform: 'win32', handlers: stubHandlers(),
    });
    const fileLabels = labelsOf(findMenu(template, 'File').submenu);
    expect(fileLabels).toEqual([
      'New Document', 'New Window', 'Open Document...', 'Open Recent', 'Pack Folder to .mdz...', 'Unpack .mdz to Folder...',
      '[separator]', 'Exit',
    ]);
  });

  it('includes document-only File items when a document is open', () => {
    const template = buildMenuTemplate({
      documentOpen: true, isDev: false, platform: 'win32', handlers: stubHandlers(),
    });
    const fileLabels = labelsOf(findMenu(template, 'File').submenu);
    expect(fileLabels).toContain('Save');
    expect(fileLabels).toContain('Save As...');
    expect(fileLabels).toContain('Print...');
    expect(fileLabels).toContain('Show in File Manager');
    expect(fileLabels).toContain('Copy File Path');
    expect(fileLabels).toContain('Copy Folder Path');
    expect(fileLabels).toContain('Insert AGENTS.md');
    expect(fileLabels).toContain('Insert README.md');
    expect(fileLabels).toContain('Close Document');
    // Exit always stays last.
    expect(fileLabels.at(-1)).toBe('Exit');
  });

  it('only shows "Set as Default for .md Files" on win32', () => {
    const win = buildMenuTemplate({ documentOpen: false, isDev: false, platform: 'win32', handlers: stubHandlers() });
    const mac = buildMenuTemplate({ documentOpen: false, isDev: false, platform: 'darwin', handlers: stubHandlers() });
    expect(labelsOf(findMenu(win, 'Help').submenu)).toContain('Set as Default for .md Files...');
    expect(labelsOf(findMenu(mac, 'Help').submenu)).not.toContain('Set as Default for .md Files...');
  });

  it('adds a Developer menu only in dev', () => {
    const dev = buildMenuTemplate({ documentOpen: false, isDev: true, platform: 'win32', handlers: stubHandlers() });
    const prod = buildMenuTemplate({ documentOpen: false, isDev: false, platform: 'win32', handlers: stubHandlers() });
    expect(dev.map((m) => m.label)).toContain('Developer');
    expect(prod.map((m) => m.label)).not.toContain('Developer');
  });

  it('wires each item to its named handler', () => {
    const handlers = stubHandlers();
    const template = buildMenuTemplate({ documentOpen: true, isDev: true, platform: 'win32', handlers });

    findMenu(template, 'File').submenu.find((i) => i.label === 'Save').click();
    findMenu(template, 'File').submenu.find((i) => i.label === 'Exit').click();
    findMenu(template, 'File').submenu.find((i) => i.label === 'New Window').click();
    findMenu(template, 'File').submenu.find((i) => i.label === 'Insert AGENTS.md').click();
    findMenu(template, 'File').submenu.find((i) => i.label === 'Insert README.md').click();
    findMenu(template, 'Help').submenu.find((i) => i.label === 'Check for Updates...').click();
    findMenu(template, 'Developer').submenu.find((i) => i.label === 'Export Studio JSON Draft').click();

    expect(handlers.save).toHaveBeenCalledTimes(1);
    expect(handlers.quit).toHaveBeenCalledTimes(1);
    expect(handlers.newWindow).toHaveBeenCalledTimes(1);
    expect(handlers.insertAgentsGuide).toHaveBeenCalledTimes(1);
    expect(handlers.insertReadme).toHaveBeenCalledTimes(1);
    expect(handlers.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(handlers.exportDraft).toHaveBeenCalledTimes(1);
  });

  it('shows a plain Help menu and "Check for Updates..." when no update is pending', () => {
    const template = buildMenuTemplate({
      documentOpen: false, isDev: false, platform: 'linux', handlers: stubHandlers(),
    });
    expect(template.map((m) => m.label)).toContain('Help');
    expect(labelsOf(findMenu(template, 'Help').submenu)).toContain('Check for Updates...');
  });

  it('marks the Help menu and renames the item when an update is available', () => {
    const handlers = stubHandlers();
    const template = buildMenuTemplate({
      documentOpen: false, isDev: false, platform: 'linux', handlers,
      updateAvailableVersion: '1.3.25',
    });
    expect(template.map((m) => m.label)).toContain('Help •');
    expect(template.map((m) => m.label)).not.toContain('Help');

    const helpLabels = labelsOf(findMenu(template, 'Help •').submenu);
    expect(helpLabels).toContain('Download Update (1.3.25)...');
    expect(helpLabels).not.toContain('Check for Updates...');

    findMenu(template, 'Help •').submenu
      .find((i) => i.label === 'Download Update (1.3.25)...')
      .click();
    expect(handlers.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('keeps "New Window" available regardless of documentOpen state', () => {
    const closed = buildMenuTemplate({ documentOpen: false, isDev: false, platform: 'win32', handlers: stubHandlers() });
    const open = buildMenuTemplate({ documentOpen: true, isDev: false, platform: 'win32', handlers: stubHandlers() });
    expect(labelsOf(findMenu(closed, 'File').submenu)).toContain('New Window');
    expect(labelsOf(findMenu(open, 'File').submenu)).toContain('New Window');
  });

  describe('Open Recent submenu', () => {
    function openRecentSubmenu(template) {
      return findMenu(template, 'File').submenu.find((item) => item.label === 'Open Recent').submenu;
    }

    it('shows a disabled placeholder when there are no recent files', () => {
      const template = buildMenuTemplate({ documentOpen: false, isDev: false, platform: 'win32', handlers: stubHandlers() });
      const submenu = openRecentSubmenu(template);
      expect(submenu).toEqual([{ label: 'No Recent Documents', enabled: false }]);
    });

    it('labels each recent file with its name and folder, and wires it to openRecentPath', () => {
      const handlers = stubHandlers();
      const template = buildMenuTemplate({
        documentOpen: false, isDev: false, platform: 'win32', handlers,
        recentFiles: ['C:/docs/one.md', 'C:/docs/nested/two.mdz'],
      });
      const submenu = openRecentSubmenu(template);
      expect(labelsOf(submenu)).toEqual(['one.md — C:/docs', 'two.mdz — C:/docs/nested']);

      submenu[1].click();
      expect(handlers.openRecentPath).toHaveBeenCalledWith('C:/docs/nested/two.mdz');
    });

    it('caps the submenu at 10 entries', () => {
      const recentFiles = Array.from({ length: 15 }, (_, i) => `C:/docs/file-${i}.md`);
      const template = buildMenuTemplate({
        documentOpen: false, isDev: false, platform: 'win32', handlers: stubHandlers(), recentFiles,
      });
      expect(openRecentSubmenu(template)).toHaveLength(10);
    });

    it('is available whether or not a document is open', () => {
      const closed = buildMenuTemplate({ documentOpen: false, isDev: false, platform: 'win32', handlers: stubHandlers(), recentFiles: ['C:/docs/one.md'] });
      const open = buildMenuTemplate({ documentOpen: true, isDev: false, platform: 'win32', handlers: stubHandlers(), recentFiles: ['C:/docs/one.md'] });
      expect(labelsOf(findMenu(closed, 'File').submenu)).toContain('Open Recent');
      expect(labelsOf(findMenu(open, 'File').submenu)).toContain('Open Recent');
    });
  });
});

describe('buildMenuTemplate on darwin', () => {
  const build = (extra = {}) => buildMenuTemplate({
    documentOpen: true, isDev: false, platform: 'darwin', handlers: stubHandlers(), ...extra,
  });

  it('puts the app menu first, with About, Check for Updates, Services, Hide and Quit', () => {
    const template = build();
    expect(template[0].label).toBe('MDZip Studio');
    expect(labelsOf(template[0].submenu)).toEqual([
      'About MDZip Studio', '[separator]', 'Check for Updates...', '[separator]', '[services]', '[separator]',
      '[hide]', '[hideOthers]', '[unhide]', '[separator]', 'Quit MDZip Studio',
    ]);
  });

  it('wires Quit (Cmd+Q) and Check for Updates', () => {
    const handlers = stubHandlers();
    const app = build({ handlers })[0].submenu;
    const quit = app.find((i) => i.label === 'Quit MDZip Studio');
    expect(quit.accelerator).toBe('Cmd+Q');
    quit.click();
    app.find((i) => i.label === 'Check for Updates...').click();
    app.find((i) => i.label === 'About MDZip Studio').click();
    expect(handlers.showAbout).toHaveBeenCalledTimes(1);
    expect(handlers.quit).toHaveBeenCalledTimes(1);
    expect(handlers.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('shows the update call to action in the app menu and marks Help', () => {
    const template = build({ updateAvailableVersion: '1.3.25' });
    expect(labelsOf(template[0].submenu)).toContain('Download Update (1.3.25)...');
    expect(template.map((m) => m.label)).toContain('Help •');
  });

  it('has no File > Exit', () => {
    const fileLabels = labelsOf(findMenu(build(), 'File').submenu);
    expect(fileLabels).not.toContain('Exit');
    expect(fileLabels.at(-1)).toBe('Close Document');
    const noDoc = labelsOf(findMenu(build({ documentOpen: false }), 'File').submenu);
    expect(noDoc.at(-1)).toBe('Unpack .mdz to Folder...');
  });

  it('labels the reveal item for Finder', () => {
    const fileLabels = labelsOf(findMenu(build(), 'File').submenu);
    expect(fileLabels).toContain('Reveal in Finder');
    expect(fileLabels).not.toContain('Show in File Manager');
  });

  it('keeps About and Check for Updates out of Help', () => {
    expect(labelsOf(findMenu(build(), 'Help').submenu)).toEqual(['Known Issues', 'Change Log']);
  });

  it('adds Select All to Edit and a Window menu before Help', () => {
    const template = build();
    expect(findMenu(template, 'Edit').submenu.at(-1)).toEqual({ role: 'selectAll' });
    expect(template.at(-1).label).toBe('Help');
    expect(template.at(-2)).toEqual({ role: 'windowMenu' });
  });

  it('keeps the Developer menu between View and Window in dev', () => {
    const labels = build({ isDev: true }).map((m) => m.label ?? m.role);
    expect(labels).toEqual(['MDZip Studio', 'File', 'Edit', 'View', 'Developer', 'windowMenu', 'Help']);
  });

  it('does not double ampersands in recent labels', () => {
    const template = build({ recentFiles: ['/Users/me/Q&A/notes & more.md'] });
    const recent = findMenu(template, 'File').submenu.find((i) => i.label === 'Open Recent').submenu;
    expect(recent[0].label).toBe('notes & more.md — /Users/me/Q&A');
  });
});

describe('non-darwin menus are unchanged', () => {
  it('has no app or Window menu, no Select All, and keeps Exit and Help items', () => {
    const template = buildMenuTemplate({ documentOpen: true, isDev: false, platform: 'win32', handlers: stubHandlers() });
    expect(template.map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Help']);
    expect(findMenu(template, 'Edit').submenu.some((i) => i.role === 'selectAll')).toBe(false);
    expect(labelsOf(findMenu(template, 'Help').submenu)).toEqual([
      'Set as Default for .md Files...', '[separator]', 'Known Issues', 'Change Log',
      '[separator]', 'Check for Updates...', '[separator]', 'About MDZip Studio',
    ]);
    expect(labelsOf(findMenu(template, 'File').submenu)).toContain('Show in File Manager');
  });
});

describe('recent file labels', () => {
  it('keeps short folders whole and shortens long ones in the middle', () => {
    expect(shortenFolder('F:\\Exports')).toBe('F:\\Exports');
    const long = 'F:\\Code\\1 Projects\\mdzip-project\\TestFiles\\link-navigation-test\\subfolder';
    const short = shortenFolder(long);
    expect(short.startsWith('F:\\…\\')).toBe(true);
    expect(short.endsWith('subfolder')).toBe(true);
    expect(short.length).toBeLessThanOrEqual(40);
  });

  it('doubles ampersands so they are not read as menu mnemonics', () => {
    expect(recentLabel('C:\\Q&A\\notes & more.md', 'win32')).toBe('notes && more.md — C:\\Q&&A');
    expect(recentLabel('/home/me/Q&A/notes.md', 'linux')).toBe('notes.md — /home/me/Q&&A');
  });

  it('leaves ampersands alone on macOS, which has no mnemonics', () => {
    expect(recentLabel('/Users/me/Q&A/notes & more.md', 'darwin')).toBe('notes & more.md — /Users/me/Q&A');
  });

  it('reads Windows and POSIX paths the same way on any host', () => {
    expect(recentLabel('C:\\docs\\one.md', 'win32')).toBe('one.md — C:\\docs');
    expect(recentLabel('/Users/me/docs/one.mdz', 'darwin')).toBe('one.mdz — /Users/me/docs');
  });

  it('shortens long POSIX folders in the middle', () => {
    const short = shortenFolder('/Users/me/Documents/Projects/mdzip-project/TestFiles/link-navigation-test/sub');
    expect(short).toContain('…');
    expect(short.endsWith('/sub')).toBe(true);
    expect(short.length).toBeLessThanOrEqual(40);
  });
});

describe('View > Load Remote Images', () => {
  const item = (remoteImages) => {
    const handlers = stubHandlers();
    const template = buildMenuTemplate({ documentOpen: false, isDev: false, platform: 'win32', handlers, remoteImages });
    return { handlers, entry: findMenu(template, 'View').submenu.find((i) => i.label === 'Load Remote Images') };
  };

  it('is a checkbox reflecting the setting, on by default', () => {
    expect(item(undefined).entry).toMatchObject({ type: 'checkbox', checked: true });
    expect(item(false).entry.checked).toBe(false);
  });

  it('calls the toggle handler', () => {
    const { handlers, entry } = item(true);
    entry.click();
    expect(handlers.toggleRemoteImages).toHaveBeenCalled();
  });
});

describe('buildPreviewMenuTemplate (macOS)', () => {
  it('has app menu, Print, Edit and Window, with Cmd+W closing the preview', () => {
    const handlers = { ...stubHandlers(), quickPrint: vi.fn(), closePreview: vi.fn() };
    const template = buildPreviewMenuTemplate({ handlers });
    expect(template.map((m) => m.label ?? m.role)).toEqual(['MDZip Studio', 'Print', 'Edit', 'windowMenu']);
    const close = findMenu(template, 'Print').submenu.find((i) => i.label === 'Close Preview');
    expect(close.accelerator).toBe('Cmd+W');
    close.click();
    expect(handlers.closePreview).toHaveBeenCalledTimes(1);
    findMenu(template, 'MDZip Studio').submenu.find((i) => i.label === 'Quit MDZip Studio').click();
    expect(handlers.quit).toHaveBeenCalledTimes(1);
  });

  it('shows the update call to action when one is pending', () => {
    const template = buildPreviewMenuTemplate({ handlers: stubHandlers(), updateAvailableVersion: '2.0.0' });
    expect(labelsOf(template[0].submenu)).toContain('Download Update (2.0.0)...');
  });
});

describe('buildDockMenuTemplate', () => {
  it('offers New Markdown, New MDZip and New Window wired to the handlers', () => {
    const handlers = { newMarkdown: vi.fn(), newMdz: vi.fn(), newWindow: vi.fn() };
    const template = buildDockMenuTemplate({ handlers });
    expect(labelsOf(template)).toEqual(['New Markdown Document', 'New MDZip Document', 'New Window']);
    template.forEach((item) => item.click());
    expect(handlers.newMarkdown).toHaveBeenCalledTimes(1);
    expect(handlers.newMdz).toHaveBeenCalledTimes(1);
    expect(handlers.newWindow).toHaveBeenCalledTimes(1);
  });
});
