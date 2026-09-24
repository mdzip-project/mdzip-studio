const { buildMenuTemplate, recentLabel, shortenFolder } = require('./menu');

const HANDLER_NAMES = [
  'newDocument', 'newWindow', 'openDocument', 'openRecentPath', 'packFolder', 'unpackMdz',
  'save', 'saveAs', 'print', 'showInFolder', 'insertAgentsGuide', 'insertReadme', 'closeDocument', 'quit',
  'reload', 'toggleLineNumbers', 'toggleDevTools',
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
    expect(recentLabel('C:\\Q&A\\notes & more.md')).toBe('notes && more.md — C:\\Q&&A');
  });
});
