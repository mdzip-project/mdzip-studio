const path = require('path');

// Native menus can't show a tooltip or style part of a label, so the folder
// goes in the label itself, middle-shortened when long. '&' marks a mnemonic in
// Windows menu labels, so a literal one must be doubled.
function shortenFolder(dir, max = 40) {
  if (dir.length <= max) return dir;
  const sep = dir.includes('\\') ? '\\' : '/';
  const parts = dir.split(/[\\/]+/).filter((part, i) => part || i === 0);
  const head = parts[0];
  let tail = parts.slice(1);
  let kept = [];
  while (tail.length) {
    const next = [tail.at(-1), ...kept];
    if ((head + sep + '…' + sep + next.join(sep)).length > max && kept.length) break;
    kept = next;
    tail = tail.slice(0, -1);
  }
  return head + sep + '…' + sep + kept.join(sep);
}

function recentLabel(filePath) {
  const label = `${path.basename(filePath)} — ${shortenFolder(path.dirname(filePath))}`;
  return label.replace(/&/g, '&&');
}

// Pure builder for the application menu template. Electron-free: takes the
// state that decides shape (documentOpen/isDev/platform) plus a bag of click
// handlers, and returns a plain template array — no Menu/BrowserWindow/app
// references, so it's unit-testable without a running main process.
function buildMenuTemplate({ documentOpen, isDev, platform, handlers, updateAvailableVersion = null, recentFiles = [] }) {
  // Electron's native Windows menu doesn't expose a styleable disabled state, so
  // the document-only items would look enabled until hovered. Instead of greying
  // them out, omit them entirely when no document is open — unambiguous, and they
  // reappear when one is. (The menu is rebuilt on the document-open IPC.)
  const openRecentSubmenu = recentFiles.length
    ? recentFiles
        .slice(0, 10)
        .map((filePath) => ({ label: recentLabel(filePath), click: () => handlers.openRecentPath(filePath) }))
    : [{ label: 'No Recent Documents', enabled: false }];

  const fileSubmenu = [
    { label: 'New Document', accelerator: 'CmdOrCtrl+N', click: handlers.newDocument },
    { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: handlers.newWindow },
    { label: 'Open Document...', accelerator: 'CmdOrCtrl+O', click: handlers.openDocument },
    { label: 'Open Recent', submenu: openRecentSubmenu },
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
      { label: 'Copy File Path', click: handlers.copyFilePath },
      { label: 'Copy Folder Path', click: handlers.copyFolderPath },
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

module.exports = { buildMenuTemplate, recentLabel, shortenFolder };
