// Pure builder for the application menu template. Electron-free: takes the
// state that decides shape (documentOpen/isDev/platform) plus a bag of click
// handlers, and returns a plain template array — no Menu/BrowserWindow/app
// references, so it's unit-testable without a running main process.
function buildMenuTemplate({ documentOpen, isDev, platform, handlers, updateAvailableVersion = null }) {
  // Electron's native Windows menu doesn't expose a styleable disabled state, so
  // the document-only items would look enabled until hovered. Instead of greying
  // them out, omit them entirely when no document is open — unambiguous, and they
  // reappear when one is. (The menu is rebuilt on the document-open IPC.)
  const fileSubmenu = [
    { label: 'New Document', accelerator: 'CmdOrCtrl+N', click: handlers.newDocument },
    { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: handlers.newWindow },
    { label: 'Open Document...', accelerator: 'CmdOrCtrl+O', click: handlers.openDocument },
    { label: 'Pack Folder to .mdz...', click: handlers.packFolder },
    { label: 'Unpack .mdz to Folder...', click: handlers.unpackMdz },
  ];
  if (documentOpen) {
    fileSubmenu.push(
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: handlers.save },
      { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: handlers.saveAs },
      { type: 'separator' },
      { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: handlers.print },
      { type: 'separator' },
      { label: 'Show in File Manager', click: handlers.showInFolder },
      { type: 'separator' },
      { label: 'Insert AGENTS.md', click: handlers.insertAgentsGuide },
      { label: 'Insert README.md', click: handlers.insertReadme },
      { type: 'separator' },
      { label: 'Close Document', accelerator: 'CmdOrCtrl+W', click: handlers.closeDocument },
    );
  }
  fileSubmenu.push(
    { type: 'separator' },
    { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: handlers.quit },
  );

  // A background check (see main.js) sets updateAvailableVersion when a newer
  // release exists. Electron menus have no badge API on Windows/Linux, so the
  // "indicator dot" is a bullet appended to the Help label (visible without
  // opening the menu) and the check item itself renames to a call to action.
  const helpLabel = updateAvailableVersion ? 'Help •' : 'Help';
  const updateItem = updateAvailableVersion
    ? { label: `Download Update (${updateAvailableVersion})...`, click: handlers.checkForUpdates }
    : { label: 'Check for Updates...', click: handlers.checkForUpdates };

  const template = [
    {
      label: 'File',
      submenu: fileSubmenu,
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: handlers.reload },
        {
          label: 'Line Numbers',
          type: 'checkbox',
          checked: true,
          click: handlers.toggleLineNumbers,
        },
        { type: 'separator' },
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: handlers.toggleDevTools,
        },
      ],
    },
    {
      label: helpLabel,
      submenu: [
        ...(platform === 'win32'
          ? [
              { label: 'Set as Default for .md Files...', click: handlers.setMdDefault },
              { type: 'separator' },
            ]
          : []),
        { label: 'Known Issues', click: handlers.showKnownIssues },
        { label: 'Change Log', click: handlers.showChangelog },
        { type: 'separator' },
        updateItem,
        { type: 'separator' },
        { label: 'About MDZip Studio', click: handlers.showAbout },
      ],
    },
  ];

  if (isDev) {
    template.splice(3, 0, {
      label: 'Developer',
      submenu: [
        {
          label: 'Export Studio JSON Draft',
          click: handlers.exportDraft,
        },
      ],
    });
  }

  return template;
}

module.exports = { buildMenuTemplate };
