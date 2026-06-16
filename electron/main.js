const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('fs/promises');
const { constants: fsConstants } = require('fs');
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');

// ProgID the installer registers for .md (see build/installer.nsh). Used to
// detect whether Studio is already the default Markdown editor.
const MD_PROGID = 'MDZip.Studio.Markdown';

// Light/dark window icons (bundled under electron/, so available in dev and in
// the packaged asar). The window icon follows the OS theme via nativeTheme.
const LIGHT_WINDOW_ICON = path.join(__dirname, 'icons', 'mdzip-mark-light.ico');
const DARK_WINDOW_ICON = path.join(__dirname, 'icons', 'mdzip-mark-dark.ico');
const windowIconForTheme = () =>
  nativeTheme.shouldUseDarkColors ? DARK_WINDOW_ICON : LIGHT_WINDOW_ICON;

let mainWindow;
let currentDocumentPath = null;
let pendingOpenDocumentPath = null;
const isDev = !app.isPackaged;

function documentPathFromArgs(args) {
  const candidate = args.find((arg) =>
    typeof arg === 'string' && /\.(?:mdz|md)$/i.test(arg) && !arg.startsWith('--')
  );
  return candidate ? path.resolve(candidate) : null;
}

async function isPathReadOnly(filePath) {
  // On Windows W_OK reflects the read-only file attribute; on POSIX it reflects
  // write permission. Either way, a failure means the user can't save in place.
  try {
    await fs.access(filePath, fsConstants.W_OK);
    return false;
  } catch {
    return true;
  }
}

async function readDocument(filePath) {
  const resolvedPath = path.resolve(filePath);
  const bytes = await fs.readFile(resolvedPath);
  currentDocumentPath = resolvedPath;
  return {
    canceled: false,
    filePath: resolvedPath,
    name: path.basename(resolvedPath),
    bytes: new Uint8Array(bytes),
    readOnly: await isPathReadOnly(resolvedPath),
  };
}

// Read the ProgID Windows currently uses to open .md for this user. The
// per-extension UserChoice is the value Explorer actually honors; an absent key
// means no explicit default has been set.
function getMarkdownDefaultProgId() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice',
        '/v',
        'ProgId',
      ],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const match = /ProgId\s+REG_SZ\s+(\S+)/i.exec(stdout ?? '');
        resolve(match ? match[1] : null);
      }
    );
  });
}

// Show the Windows "How do you want to open .md files?" dialog via
// SHOpenWithDialog. OAIF_REGISTER_EXT records the user's choice as the new
// default (the only sanctioned way to set the protected UserChoice), while
// omitting OAIF_EXEC means the throwaway file is never actually opened. Runs in
// the (unelevated) user session, so the choice lands in the real user's hive.
function showMarkdownOpenWithDialog(options) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -Namespace MdzipStudio -Name Shell -MemberDefinition @"',
    '[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]',
    'public struct OPENASINFO {',
    '  [MarshalAs(UnmanagedType.LPWStr)] public string FileName;',
    '  [MarshalAs(UnmanagedType.LPWStr)] public string ClassName;',
    '  public int InFlags;',
    '}',
    '[DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
    'public static extern int SHOpenWithDialog(IntPtr hwnd, ref OPENASINFO info);',
    '"@',
    '$info = [MdzipStudio.Shell+OPENASINFO]::new()',
    '$info.FileName = $env:MDZIP_OPENAS_PATH',
    '$info.ClassName = $null',
    '# OAIF_ALLOW_REGISTRATION (0x01) | OAIF_REGISTER_EXT (0x02)',
    '$info.InFlags = 0x03',
    '$h = [long]0',
    '[void][long]::TryParse($env:MDZIP_OWNER_HWND, [ref]$h)',
    '[void][MdzipStudio.Shell]::SHOpenWithDialog([IntPtr]::new($h), [ref]$info)',
  ].join('\n');

  return new Promise((resolve) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        env: {
          ...process.env,
          MDZIP_OPENAS_PATH: options.filePath,
          MDZIP_OWNER_HWND: options.hwnd,
        },
      },
      () => resolve()
    );
    child.on('error', () => resolve());
  });
}

function queueOpenDocument(filePath) {
  if (!filePath) return;
  pendingOpenDocumentPath = path.resolve(filePath);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('mdzip:open-document-requested');
  }
}

function dispatchAppEvent(name) {
  return mainWindow?.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}))`
  );
}

function saveDialogFilters(defaultName) {
  if (/\.md$/i.test(defaultName)) {
    return [
      { name: 'Markdown Files', extensions: ['md'] },
      { name: 'MDZip Documents', extensions: ['mdz'] },
      { name: 'All Files', extensions: ['*'] },
    ];
  }

  return [
    { name: 'MDZip Documents', extensions: ['mdz'] },
    { name: 'All Files', extensions: ['*'] },
  ];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    icon: windowIconForTheme(),
    title: 'MDZip Studio',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const startUrl = isDev
    ? 'http://localhost:4300'
    : `file://${path.join(__dirname, '../dist/mdzip-studio/index.html')}`;

  mainWindow.loadURL(startUrl);
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (pendingOpenDocumentPath) {
      mainWindow?.webContents.send('mdzip:open-document-requested');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const appOrigin = isDev
    ? 'http://localhost:4300'
    : `file://${path.join(__dirname, '../dist')}`;

  // Open external links in the OS default browser instead of navigating the app window.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Handle target="_blank" links the same way.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

const initialDocumentPath = documentPathFromArgs(process.argv.slice(1));
if (initialDocumentPath) {
  pendingOpenDocumentPath = initialDocumentPath;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    queueOpenDocument(documentPathFromArgs(commandLine.slice(1)));
  });

  app.on('ready', createWindow);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle('mdzip:open-document', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Document',
    properties: ['openFile'],
    filters: [
      { name: 'MDZip Documents', extensions: ['mdz', 'md'] },
      { name: 'Markdown Files', extensions: ['md'] },
      { name: 'Studio JSON Drafts', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return readDocument(result.filePaths[0]);
});

ipcMain.handle('mdzip:take-pending-open-document', async () => {
  const filePath = pendingOpenDocumentPath;
  pendingOpenDocumentPath = null;
  if (!filePath) {
    return { canceled: true };
  }
  return readDocument(filePath);
});

ipcMain.handle('mdzip:save-document', async (_event, payload) => {
  let filePath = payload.filePath;

  if (payload.saveAs || !filePath) {
    const defaultPath = payload.mdzBytes
      ? payload.defaultName.replace(/\.md$/i, '')
      : payload.defaultName;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Document',
      defaultPath,
      filters: saveDialogFilters(payload.defaultName),
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    filePath = result.filePath;
  }

  const format = /\.mdz$/i.test(filePath) ? 'mdz' : 'markdown';
  const selectedBytes = format === 'mdz' && payload.mdzBytes
    ? payload.mdzBytes
    : payload.bytes;
  const bytes = Buffer.from(selectedBytes);

  await fs.writeFile(filePath, bytes);
  currentDocumentPath = path.resolve(filePath);
  return {
    canceled: false,
    filePath,
    name: path.basename(filePath),
    format,
  };
});

ipcMain.handle('mdzip:get-md-default-status', async () => {
  if (process.platform !== 'win32') {
    return { supported: false, isDefault: false };
  }
  const progId = await getMarkdownDefaultProgId();
  return { supported: true, isDefault: progId === MD_PROGID };
});

ipcMain.handle('mdzip:prompt-md-default', async () => {
  if (process.platform !== 'win32') {
    return { supported: false, isDefault: false };
  }

  // SHOpenWithDialog needs a file whose extension is .md; the file is never
  // opened (no OAIF_EXEC), so a throwaway in the temp dir is enough.
  const tempPath = path.join(os.tmpdir(), `mdzip-set-default-${Date.now()}.md`);
  await fs.writeFile(tempPath, '');

  let hwnd = '0';
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      hwnd = mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
    } catch {
      hwnd = '0';
    }
  }

  try {
    await showMarkdownOpenWithDialog({ filePath: tempPath, hwnd });
  } finally {
    fs.unlink(tempPath).catch(() => {});
  }

  const progId = await getMarkdownDefaultProgId();
  return { supported: true, isDefault: progId === MD_PROGID };
});

ipcMain.handle('mdzip:write-markdown-image', async (_event, payload) => {
  const documentPath = path.resolve(String(payload.documentPath ?? ''));
  const documentDirectory = path.dirname(documentPath);
  const requestedDirectory = String(payload.relativeDirectory ?? '').trim();
  const fileName = path.basename(String(payload.fileName ?? 'image'));

  if (!currentDocumentPath || documentPath !== currentDocumentPath) {
    throw new Error('The Markdown document path is no longer current.');
  }
  if (!/\.md$/i.test(documentPath)) {
    throw new Error('Save the Markdown document before adding a linked image.');
  }
  if (!fileName || fileName === '.' || fileName === '..') {
    throw new Error('The image file name is invalid.');
  }
  if (requestedDirectory && (
    requestedDirectory === '.'
    || requestedDirectory === '..'
    || /[<>:"/\\|?*\x00-\x1f]/.test(requestedDirectory)
  )) {
    throw new Error('Enter a single valid subfolder name.');
  }

  const destinationDirectory = path.resolve(documentDirectory, requestedDirectory);
  const relativeDirectory = path.relative(documentDirectory, destinationDirectory);
  if (relativeDirectory.startsWith('..') || path.isAbsolute(relativeDirectory)) {
    throw new Error('The image destination must stay inside the document folder.');
  }

  await fs.mkdir(destinationDirectory, { recursive: true });

  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension) || 'image';
  let destinationPath = path.join(destinationDirectory, `${stem}${extension}`);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(destinationPath);
      destinationPath = path.join(destinationDirectory, `${stem}-${suffix}${extension}`);
      suffix += 1;
    } catch {
      break;
    }
  }

  await fs.writeFile(destinationPath, Buffer.from(payload.bytes ?? []));
  return {
    filePath: destinationPath,
    relativePath: path.relative(documentDirectory, destinationPath).split(path.sep).join('/'),
  };
});

// Create menu
const createMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Document', accelerator: 'CmdOrCtrl+N', click: () => dispatchAppEvent('mdzip-studio:new-archive') },
        { label: 'Open Document...', accelerator: 'CmdOrCtrl+O', click: () => dispatchAppEvent('mdzip-studio:open-archive') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => dispatchAppEvent('mdzip-studio:save-archive') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => dispatchAppEvent('mdzip-studio:save-archive-as') },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
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
        { label: 'Reload', accelerator: 'CmdOrCtrl+R' },
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        ...(process.platform === 'win32'
          ? [
              { label: 'Set as Default for .md Files...', click: () => dispatchAppEvent('mdzip-studio:set-md-default') },
              { type: 'separator' },
            ]
          : []),
        { label: 'About MDZip Studio', click: () => dispatchAppEvent('mdzip-studio:show-about') },
      ],
    },
  ];

  if (isDev) {
    template.splice(3, 0, {
      label: 'Developer',
      submenu: [
        {
          label: 'Export Studio JSON Draft',
          click: () => dispatchAppEvent('mdzip-studio:export-draft'),
        },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

app.on('ready', createMenu);

// Swap the window/taskbar icon when the OS theme changes (the BrowserWindow is
// created with the correct one for the current theme).
app.on('ready', () => {
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIcon(windowIconForTheme());
    }
  });
});
