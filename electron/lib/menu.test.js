const { buildMenuTemplate } = require('./menu');

const HANDLER_NAMES = [
  'newDocument', 'newWindow', 'openDocument', 'packFolder', 'unpackMdz',
  'save', 'saveAs', 'print', 'showInFolder', 'closeDocument', 'quit',
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
      'New Document', 'New Window', 'Open Document...', 'Pack Folder to .mdz...', 'Unpack .mdz to Folder...',
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
    findMenu(template, 'Help').submenu.find((i) => i.label === 'Check for Updates...').click();
    findMenu(template, 'Developer').submenu.find((i) => i.label === 'Export Studio JSON Draft').click();

    expect(handlers.save).toHaveBeenCalledTimes(1);
    expect(handlers.quit).toHaveBeenCalledTimes(1);
    expect(handlers.newWindow).toHaveBeenCalledTimes(1);
    expect(handlers.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(handlers.exportDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps "New Window" available regardless of documentOpen state', () => {
    const closed = buildMenuTemplate({ documentOpen: false, isDev: false, platform: 'win32', handlers: stubHandlers() });
    const open = buildMenuTemplate({ documentOpen: true, isDev: false, platform: 'win32', handlers: stubHandlers() });
    expect(labelsOf(findMenu(closed, 'File').submenu)).toContain('New Window');
    expect(labelsOf(findMenu(open, 'File').submenu)).toContain('New Window');
  });
});
