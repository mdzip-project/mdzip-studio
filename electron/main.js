const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
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
// Whether a document is open in the renderer. Gates the document-only File menu
// items (Save, Save As, Close, Show in File Manager); updated over IPC.
let documentOpen = false;
const isDev = !app.isPackaged;

// Match the AppUserModelID the NSIS installer assigns the shortcut (electron-builder
// defaults it to the build appId). Windows keys the taskbar Jump List off this, so
// it must be set before any setJumpList call for items to appear under our icon.
if (process.platform === 'win32') {
  app.setAppUserModelId('org.mdzip.studio');
}

// --- Auto-update (electron-updater, GitHub Releases) -----------------------
// The feed is the `publish` block in package.json, baked into app-update.yml at
// build time. Updates only work in a packaged build; in dev the feed is absent
// and checkForUpdates() rejects. Background (startup) checks stay quiet and use
// native notifications when something happens; a manual "Check for Updates"
// always reports its result in a modal dialog, since the user is waiting on it
// and OS notifications are easy to miss (or suppressed).
let updaterWired = false;
// True while a check triggered from the menu is in flight, so manual checks get
// the dialog feedback that the silent startup check suppresses.
let manualUpdateCheck = false;

function showNotification(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: windowIconForTheme() });
  if (onClick) notification.on('click', onClick);
  notification.show();
}

function wireAutoUpdater() {
  if (updaterWired) return;
  updaterWired = true;

  autoUpdater.on('update-available', (info) => {
    // Keep manualUpdateCheck set so the later 'update-downloaded' knows this
    // flow began as a manual check and prompts to restart in a dialog.
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Check for Updates',
        message: `An update is available: MDZip Studio ${info.version}.`,
        detail: 'It’s downloading now. You can keep working — you’ll be prompted to restart when it’s ready.',
      });
    } else {
      showNotification('Update available', `Downloading MDZip Studio ${info.version}…`);
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Check for Updates',
        message: 'You’re up to date.',
        detail: `MDZip Studio ${app.getVersion()} is the latest version.`,
      });
    }
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    const wasManual = manualUpdateCheck;
    manualUpdateCheck = false;
    if (wasManual) {
      dialog
        .showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update ready',
          message: `MDZip Studio ${info.version} has been downloaded.`,
          detail: 'Restart now to install it, or it will install the next time you quit.',
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        });
    } else {
      showNotification(
        'Update ready',
        `MDZip Studio ${info.version} will install when you restart. Click here to restart now.`,
        () => autoUpdater.quitAndInstall()
      );
    }
  });

  autoUpdater.on('error', (error) => {
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Check for Updates',
        message: 'Could not check for updates.',
        detail: error?.message ?? 'Could not reach the update server. Check your connection and try again.',
      });
    }
    manualUpdateCheck = false;
  });
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Check for Updates',
        message: 'Updates are only available in an installed build.',
        detail: 'Run an installed copy of MDZip Studio to check for and download updates.',
      });
    }
    return;
  }
  wireAutoUpdater();
  manualUpdateCheck = manual;
  // The 'error' event handles user-facing messaging; swallow the rejection so
  // an unreachable feed never produces an unhandled promise rejection.
  autoUpdater.checkForUpdates().catch(() => {});
}

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

// Folder of the most recent pick, so the (separate) read step only ever touches
// a directory the user actually chose via the dialog.
let lastPackFolder = null;

const toPosixRelative = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

// Cheap scan: enumerate file paths only — no contents, no stat, no filtering
// (like the browser's webkitdirectory listing). Symlinks are skipped so project
// folders with linked node_modules don't loop. ~0.2s even for ~10k files; the
// renderer's include-filters decide what actually gets read at build time.
async function enumerateFolderPaths(root, current = root, out = []) {
  const entries = (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await enumerateFolderPaths(root, abs, out);
    } else if (entry.isFile()) {
      out.push(toPosixRelative(root, abs));
    }
  }
  return out;
}

// Resolve an archive-relative path back to an absolute path inside the picked
// folder, refusing anything that escapes it.
function resolveInsidePackFolder(rel) {
  const abs = path.resolve(lastPackFolder, rel);
  const relCheck = path.relative(lastPackFolder, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error(`Refusing to read outside the selected folder: "${rel}".`);
  }
  return abs;
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

// Build the relaunch arguments for a Jump List item. A packaged build's
// execPath IS the app, so the file path alone suffices; in dev, execPath is
// electron.exe and needs the app directory before the file argument.
function jumpListLaunchArgs(filePath) {
  const quotedFile = `"${filePath}"`;
  return app.isPackaged ? quotedFile : `"${app.getAppPath()}" ${quotedFile}`;
}

// The per-file-type .ico files ship via extraResources (packaged) and live under
// build/ in dev. These are the same icons the installer registers for .md/.mdz.
const FILE_ICONS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'file-icons')
  : path.join(__dirname, '..', 'build', 'file-icons');

function jumpListIconFor(filePath) {
  const iconFile = /\.md$/i.test(filePath) ? 'md.ico' : 'mdz.ico';
  return { iconPath: path.join(FILE_ICONS_DIR, iconFile), iconIndex: 0 };
}

// Mirror the renderer's recent-files list into the Windows taskbar Jump List.
// Each entry relaunches the exe with the file path, which the single-instance
// handler routes through queueOpenDocument just like a double-click would.
function updateJumpList(recentPaths) {
  if (process.platform !== 'win32') return;
  const items = (Array.isArray(recentPaths) ? recentPaths : [])
    // Only .md/.mdz survive — these are what documentPathFromArgs accepts on relaunch.
    .filter((p) => typeof p === 'string' && /\.(?:mdz|md)$/i.test(p))
    .slice(0, 10)
    .map((p) => ({
      type: 'task',
      program: process.execPath,
      args: jumpListLaunchArgs(p),
      title: path.basename(p),
      description: p,
      // Per-type document icon instead of the program's (electron.exe) icon.
      ...jumpListIconFor(p),
    }));
  try {
    app.setJumpList(items.length ? [{ type: 'custom', name: 'Recent', items }] : null);
  } catch {
    // setJumpList throws if Windows rejects an item; a stale list is harmless.
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

ipcMain.handle('mdzip:open-document-path', async (_event, payload) => {
  const filePath = payload?.filePath;
  if (!filePath) {
    return { canceled: true };
  }
  try {
    return await readDocument(filePath);
  } catch (error) {
    return {
      canceled: true,
      error: error?.code === 'ENOENT' ? 'not-found' : error?.message ?? 'read-failed',
    };
  }
});

ipcMain.on('mdzip:set-recent-files', (_event, payload) => {
  updateJumpList(payload?.paths);
});

ipcMain.on('mdzip:set-document-open', (_event, open) => {
  const next = Boolean(open);
  if (next === documentOpen) return;
  documentOpen = next;
  // Rebuild the menu so the document-only items reflect the new state.
  createMenu();
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

// Step 1: pick a folder and enumerate its file paths (no contents) so the UI can
// show options instantly. Also reads a root manifest.json, if present, to
// pre-fill the option fields.
ipcMain.handle('mdzip:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Pack Folder to MDZip',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const folderPath = path.resolve(result.filePaths[0]);
  const stats = await fs.lstat(folderPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('The selected path is not a folder.');
  }

  lastPackFolder = folderPath;
  const paths = (await enumerateFolderPaths(folderPath)).sort();
  let manifestText = null;
  if (paths.some((p) => p.toLowerCase() === 'manifest.json')) {
    try {
      manifestText = await fs.readFile(path.join(folderPath, 'manifest.json'), 'utf8');
    } catch {
      manifestText = null;
    }
  }
  return { canceled: false, folderPath, folderName: path.basename(folderPath), paths, manifestText };
});

// Step 2: read the specific files the renderer selected (after applying the
// include-filters), streaming progress so the UI can show a bar + ETA. Only
// reads inside the folder picked in step 1.
ipcMain.handle('mdzip:read-folder', async (_event, payload) => {
  if (!lastPackFolder) {
    throw new Error('Select a folder before reading it.');
  }
  const requested = Array.isArray(payload?.paths) ? payload.paths : [];
  const list = [];
  for (const rel of requested) {
    const abs = resolveInsidePackFolder(rel);
    list.push({ rel, abs, size: (await fs.stat(abs)).size });
  }
  const total = list.length;
  const bytesTotal = list.reduce((sum, file) => sum + file.size, 0);

  const emit = (done, bytesDone) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mdzip:pack-folder-progress', { done, total, bytesDone, bytesTotal });
    }
  };

  const files = [];
  let bytesDone = 0;
  emit(0, 0);
  for (let i = 0; i < list.length; i += 1) {
    files.push({ path: list[i].rel, bytes: new Uint8Array(await fs.readFile(list[i].abs)) });
    bytesDone += list[i].size;
    if (i % 8 === 0 || i === list.length - 1) emit(i + 1, bytesDone);
  }
  return { files };
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

// MIME types for relative images referenced by an opened Markdown document.
const MARKDOWN_ASSET_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

// Read a relative image referenced by the current Markdown document and return
// it as a data URI. Plain .md files keep their images as loose sibling files;
// the renderer (served from app:// or the dev server) can't resolve those
// relative paths itself, so the preview inlines them through here.
ipcMain.handle('mdzip:read-markdown-asset', async (_event, payload) => {
  const documentPath = path.resolve(String(payload?.documentPath ?? ''));
  const relativePath = String(payload?.relativePath ?? '');
  // Only serve assets for the document Studio currently has open.
  if (!currentDocumentPath || documentPath !== currentDocumentPath) {
    return { error: 'stale-document' };
  }
  // Reject absolute paths and URLs; only document-relative references resolve here.
  if (!relativePath || path.isAbsolute(relativePath) || /^[a-z][a-z0-9+.-]*:/i.test(relativePath)) {
    return { error: 'unsupported-path' };
  }
  const resolved = path.resolve(path.dirname(documentPath), relativePath);
  const mime = MARKDOWN_ASSET_MIME[path.extname(resolved).toLowerCase()];
  if (!mime) return { error: 'unsupported-type' };
  try {
    const bytes = await fs.readFile(resolved);
    return { dataUri: `data:${mime};base64,${bytes.toString('base64')}` };
  } catch {
    return { error: 'not-found' };
  }
});

// Reveal a saved document in the OS file manager (Explorer/Finder/Files).
ipcMain.handle('mdzip:show-in-folder', async (_event, payload) => {
  const filePath = String(payload?.filePath ?? '');
  if (!filePath) return { error: 'no-path' };
  try {
    await fs.access(filePath);
  } catch {
    return { error: 'not-found' };
  }
  shell.showItemInFolder(path.resolve(filePath));
  return { ok: true };
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
        { label: 'Pack Folder to .mdz...', click: () => dispatchAppEvent('mdzip-studio:pack-folder') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', enabled: documentOpen, click: () => dispatchAppEvent('mdzip-studio:save-archive') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', enabled: documentOpen, click: () => dispatchAppEvent('mdzip-studio:save-archive-as') },
        { type: 'separator' },
        { label: 'Show in File Manager', enabled: documentOpen, click: () => dispatchAppEvent('mdzip-studio:show-in-folder') },
        { type: 'separator' },
        { label: 'Close Document', accelerator: 'CmdOrCtrl+W', enabled: documentOpen, click: () => dispatchAppEvent('mdzip-studio:close-archive') },
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
        { label: 'Check for Updates...', click: () => checkForUpdates(true) },
        { type: 'separator' },
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

// Silent check shortly after launch so it never competes with window startup.
app.on('ready', () => {
  setTimeout(() => checkForUpdates(false), 3000);
});

// Swap the window/taskbar icon when the OS theme changes (the BrowserWindow is
// created with the correct one for the current theme).
app.on('ready', () => {
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIcon(windowIconForTheme());
    }
  });
});
