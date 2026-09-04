const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs/promises');
const { constants: fsConstants, readdirSync, unlinkSync, watch: watchFs } = require('fs');
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { documentPathFromArgs } = require('./lib/document-path');
const { saveDialogFilters } = require('./lib/save-dialog');
const { resolveInsidePackFolder } = require('./lib/pack-folder');
const { buildJumpList } = require('./lib/jump-list');
const { statsDiffer } = require('./lib/file-watch');
const {
  updateAvailableDialog,
  updateNotAvailableDialog,
  updateDownloadedDialog,
  updateErrorDialog,
} = require('./lib/updater');
const { buildMenuTemplate } = require('./lib/menu');

// ProgID the installer registers for .md (see build/installer.nsh). Used to
// detect whether Studio is already the default Markdown editor.
const MD_PROGID = 'MDZip.Studio.Markdown';

// Light/dark window icons (bundled under electron/, so available in dev and in
// the packaged asar). The window icon follows the OS theme via nativeTheme.
const LIGHT_WINDOW_ICON = path.join(__dirname, 'icons', 'mdzip-mark-light.ico');
const DARK_WINDOW_ICON = path.join(__dirname, 'icons', 'mdzip-mark-dark.ico');
const windowIconForTheme = () =>
  nativeTheme.shouldUseDarkColors ? DARK_WINDOW_ICON : LIGHT_WINDOW_ICON;

// Multi-window: each open BrowserWindow gets its own document/menu state —
// there is no single "the" window once more than one can be open at once.
// state shape: { documentPath, documentOpen, pendingOpenPath, lastPackFolder }
const windows = new Map();
let lastFocusedWindow = null;
const isDev = !app.isPackaged;

function windowState(win) {
  return win ? windows.get(win) : undefined;
}

function findWindowForPath(filePath) {
  for (const [win, state] of windows) {
    if (state.documentPath === filePath) return win;
  }
  return null;
}

function focusWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Best-effort "an existing window to bring forward" for cases with no specific
// file to route to (e.g. relaunching the app with no file argument).
function anyWindow() {
  if (lastFocusedWindow && !lastFocusedWindow.isDestroyed()) return lastFocusedWindow;
  const [firstWin] = windows.keys();
  return firstWin ?? null;
}

// Open filePath in whichever window already has it open (just focus it — no
// duplicate), otherwise in a brand-new window. A null filePath just surfaces
// an existing window, or creates one if none exist.
function openOrFocus(filePath) {
  if (!filePath) {
    const win = anyWindow();
    if (win) {
      focusWindow(win);
    } else {
      createWindow();
    }
    return;
  }
  const existing = findWindowForPath(filePath);
  if (existing) {
    focusWindow(existing);
    return;
  }
  // Don't focus a brand-new window here — it's created hidden and shows
  // itself via 'ready-to-show' once loaded, avoiding a blank-window flash.
  createWindow({ pendingOpenPath: filePath });
}

function showAppDialog(win, options) {
  if (win && !win.isDestroyed()) return dialog.showMessageBox(win, options);
  return dialog.showMessageBox(options);
}

// --- External-change detection ----------------------------------------------
// Each window's active document gets a directory watch (not a file watch — a
// file handle can be invalidated by an atomic replace-via-rename, which many
// editors and sync tools use for a "save") plus a remembered mtime/size
// baseline, so we can tell "this window's document changed on disk" apart
// from noise elsewhere in the folder.

async function snapshotDocumentStat(win, filePath) {
  const state = windowState(win);
  if (!state) return;
  try {
    const stat = await fs.stat(filePath);
    state.documentStat = { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    state.documentStat = null;
  }
  // A fresh, legitimate baseline (open/save/reload) — any previously-notified
  // external change is resolved as of now.
  state.externalChangeNotifiedFor = null;
}

function unwatchDocument(win) {
  const state = windowState(win);
  if (!state) return;
  if (state.externalChangeTimer) {
    clearTimeout(state.externalChangeTimer);
    state.externalChangeTimer = null;
  }
  if (state.fileWatcher) {
    try { state.fileWatcher.close(); } catch { /* already closed */ }
    state.fileWatcher = null;
  }
}

async function checkExternalChange(win, filePath) {
  const state = windowState(win);
  // Ignore a stale event that fires after this window moved on to a
  // different document (or closed it) since the watch was set up.
  if (!state || state.documentPath !== filePath) return;
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return; // mid atomic-replace, or briefly deleted; a later fs event will re-check
  }
  const nextStat = { mtimeMs: stat.mtimeMs, size: stat.size };
  // Deliberately compare against documentStat (the last legitimate
  // open/save/reload baseline) and never overwrite it here — only resolving
  // the change for real (reload, or a forced save) advances the baseline.
  // Otherwise the very notification meant to warn about a conflict would
  // also erase the save-time guard's ability to catch it.
  if (!statsDiffer(state.documentStat, nextStat)) return;
  // Still dedupe repeat fs events for the *same* external change so one save
  // doesn't re-fire the notice a dozen times.
  if (state.externalChangeNotifiedFor && !statsDiffer(state.externalChangeNotifiedFor, nextStat)) return;
  state.externalChangeNotifiedFor = nextStat;
  if (!win.isDestroyed()) {
    win.webContents.send('mdzip:document-changed-externally', { filePath });
  }
}

function scheduleExternalChangeCheck(win, filePath) {
  const state = windowState(win);
  if (!state) return;
  if (state.externalChangeTimer) clearTimeout(state.externalChangeTimer);
  // Debounce: a single save often fires several fs events in quick succession.
  state.externalChangeTimer = setTimeout(() => {
    state.externalChangeTimer = null;
    checkExternalChange(win, filePath).catch(() => {});
  }, 300);
}

function watchDocument(win, filePath) {
  const state = windowState(win);
  if (!state) return;
  unwatchDocument(win);
  if (!filePath) return;
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  try {
    state.fileWatcher = watchFs(dir, { persistent: false }, (_eventType, filename) => {
      if (filename && filename !== base) return;
      scheduleExternalChangeCheck(win, filePath);
    });
  } catch {
    // Watching can fail (e.g. a removable/network drive going away); the
    // save-time conflict check is the backstop when live watching isn't available.
    state.fileWatcher = null;
  }
}

// Refresh both the change-detection baseline and the watch for a window's
// newly-active document in one call — used everywhere a window's document
// path is set to a real, on-disk file.
async function trackDocument(win, filePath) {
  await snapshotDocumentStat(win, filePath);
  watchDocument(win, filePath);
}

// Match the AppUserModelID the NSIS installer assigns the shortcut (electron-builder
// defaults it to the build appId). Windows keys the taskbar Jump List off this, so
// it must be set before any setJumpList call for items to appear under our icon.
if (process.platform === 'win32') {
  app.setAppUserModelId('org.mdzip.studio');
}

// --- Manual update (electron-updater, GitHub Releases) ---------------------
// Releases are vetted by hand, so the app never updates on its own: there is no
// startup check and nothing downloads or installs automatically. The user opts
// in through Help → Check for Updates, then confirms the download and (on the
// next restart) the install. The feed is the `publish` block in package.json,
// baked into app-update.yml at build time. Updates only work in a packaged
// build; in dev the feed is absent and checkForUpdates() rejects.
let updaterWired = false;
// The window that triggered the in-flight check — only one check happens at a
// time, so this is enough to parent the outcome dialog to the right window.
let updateDialogParent = null;

function wireAutoUpdater() {
  if (updaterWired) return;
  updaterWired = true;
  // Never fetch or apply an update without explicit user action.
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => {
    showAppDialog(updateDialogParent, updateAvailableDialog(info, app.getVersion()))
      .then(({ response }) => {
        if (response === 0) autoUpdater.downloadUpdate().catch(() => {});
      });
  });

  autoUpdater.on('update-not-available', () => {
    showAppDialog(updateDialogParent, updateNotAvailableDialog(app.getVersion()));
  });

  autoUpdater.on('update-downloaded', (info) => {
    showAppDialog(updateDialogParent, updateDownloadedDialog(info))
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on('error', (error) => {
    showAppDialog(updateDialogParent, updateErrorDialog(error));
  });
}

function checkForUpdates(win) {
  updateDialogParent = win ?? null;
  if (!app.isPackaged) {
    showAppDialog(win, {
      type: 'info',
      title: 'Check for Updates',
      message: 'Updates are only available in an installed build.',
      detail: 'Run an installed copy of MDZip Studio to check for and download updates.',
    });
    return;
  }
  wireAutoUpdater();
  // The 'error' event handles user-facing messaging; swallow the rejection so
  // an unreachable feed never produces an unhandled promise rejection.
  autoUpdater.checkForUpdates().catch(() => {});
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

async function readDocument(win, filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const bytes = await fs.readFile(resolvedPath);
  if (options.activate !== false) {
    const state = windowState(win);
    if (state) state.documentPath = resolvedPath;
    await trackDocument(win, resolvedPath);
  }
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

function safeUnpackFolderName(name) {
  const stem = path.basename(String(name || 'unpacked-mdzip'), path.extname(String(name || '')));
  const safe = stem
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return safe || 'unpacked-mdzip';
}

async function uniqueChildFolder(parentFolder, requestedName) {
  const baseName = safeUnpackFolderName(requestedName);
  let candidate = path.join(parentFolder, baseName);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(parentFolder, `${baseName}-${suffix}`);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

function resolveInsideUnpackFolder(root, rel) {
  const normalized = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Refusing to write invalid archive path: "${rel}".`);
  }
  const abs = path.resolve(root, normalized);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error(`Refusing to write outside the destination folder: "${rel}".`);
  }
  return abs;
}

// The per-file-type .ico files ship via extraResources (packaged) and live under
// build/ in dev. These are the same icons the installer registers for .md/.mdz.
const FILE_ICONS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'file-icons')
  : path.join(__dirname, '..', 'build', 'file-icons');

// Mirror the renderer's recent-files list into the Windows taskbar Jump List.
function updateJumpList(recentPaths) {
  if (process.platform !== 'win32') return;
  try {
    app.setJumpList(
      buildJumpList(recentPaths, {
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        execPath: process.execPath,
        fileIconsDir: FILE_ICONS_DIR,
      })
    );
  } catch {
    // setJumpList throws if Windows rejects an item; a stale list is harmless.
  }
}

function dispatchAppEvent(win, name) {
  return win?.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}))`
  );
}

function createWindow({ pendingOpenPath = null } = {}) {
  const win = new BrowserWindow({
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

  windows.set(win, {
    documentPath: null,
    documentOpen: false,
    pendingOpenPath,
    lastPackFolder: null,
    documentStat: null,
    externalChangeNotifiedFor: null,
    fileWatcher: null,
    externalChangeTimer: null,
  });
  refreshWindowMenu(win);

  const startUrl = isDev
    ? 'http://localhost:4300'
    : `file://${path.join(__dirname, '../dist/mdzip-studio/index.html')}`;

  win.loadURL(startUrl);
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    if (windowState(win)?.pendingOpenPath) {
      win.webContents.send('mdzip:open-document-requested');
    }
  });

  win.on('focus', () => {
    lastFocusedWindow = win;
  });

  win.on('closed', () => {
    unwatchDocument(win);
    windows.delete(win);
    if (lastFocusedWindow === win) lastFocusedWindow = null;
  });

  const appOrigin = isDev
    ? 'http://localhost:4300'
    : `file://${path.join(__dirname, '../dist')}`;

  // Open external links in the OS default browser instead of navigating the app window.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Handle target="_blank" links the same way.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

const initialDocumentPath = documentPathFromArgs(process.argv.slice(1));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    openOrFocus(documentPathFromArgs(commandLine.slice(1)));
  });

  app.on('ready', () => {
    createWindow({ pendingOpenPath: initialDocumentPath });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (windows.size === 0) {
    createWindow();
  }
});

ipcMain.handle('mdzip:open-document', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
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

  return readDocument(win, result.filePaths[0]);
});

ipcMain.handle('mdzip:open-document-path', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const filePath = payload?.filePath;
  if (!filePath) {
    return { canceled: true };
  }
  try {
    return await readDocument(win, filePath);
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

ipcMain.on('mdzip:set-document-open', (event, open) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  if (!state) return;
  const next = Boolean(open);
  if (!next) {
    state.documentPath = null;
    unwatchDocument(win);
  }
  if (next === state.documentOpen) return;
  state.documentOpen = next;
  // Rebuild this window's menu so the document-only items reflect its new state.
  refreshWindowMenu(win);
});

ipcMain.on('mdzip:set-current-document-path', (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  if (!state) return;
  const filePath = typeof payload?.filePath === 'string' && payload.filePath
    ? payload.filePath
    : null;
  const resolved = filePath ? path.resolve(filePath) : null;
  state.documentPath = resolved;
  if (resolved) {
    trackDocument(win, resolved).catch(() => {});
  } else {
    unwatchDocument(win);
  }
});

ipcMain.handle('mdzip:take-pending-open-document', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  const filePath = state?.pendingOpenPath ?? null;
  if (state) state.pendingOpenPath = null;
  if (!filePath) {
    return { canceled: true };
  }
  // Do not activate the pending path here. Studio may still have a dirty
  // document open and can cancel the OS-level open request. Activating before
  // the renderer accepts the replacement breaks document-relative image reads
  // because mdzip:read-markdown-asset only serves assets for this window's
  // current document path.
  return readDocument(win, filePath, { activate: false });
});

ipcMain.handle('mdzip:save-document', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  let filePath = payload.filePath;

  if (payload.saveAs || !filePath) {
    const defaultName = payload.mdzBytes
      ? payload.defaultName.replace(/\.md$/i, '')
      : payload.defaultName;
    const defaultDirectory = typeof payload.defaultDirectory === 'string' && payload.defaultDirectory
      ? payload.defaultDirectory
      : null;
    const defaultPath = defaultDirectory
      ? path.join(defaultDirectory, defaultName)
      : defaultName;
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Document',
      defaultPath,
      filters: saveDialogFilters(payload.defaultName),
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    filePath = result.filePath;
  } else if (!payload.force) {
    // In-place overwrite of a path we already have open: check nothing else
    // touched the file since our last read/write before silently clobbering
    // it. Save As always goes through the dialog above (whose own OS-level
    // "replace this file?" prompt covers that case).
    const state = windowState(win);
    let onDiskStat = null;
    try {
      const stat = await fs.stat(filePath);
      onDiskStat = { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      onDiskStat = null; // deleted externally — let the write recreate it, not a conflict
    }
    if (onDiskStat && statsDiffer(state?.documentStat ?? null, onDiskStat)) {
      return { canceled: true, conflict: true, filePath };
    }
  }

  const format = /\.mdz$/i.test(filePath) ? 'mdz' : 'markdown';
  const selectedBytes = format === 'mdz' && payload.mdzBytes
    ? payload.mdzBytes
    : payload.bytes;
  const bytes = Buffer.from(selectedBytes);

  await fs.writeFile(filePath, bytes);
  const resolvedPath = path.resolve(filePath);
  const state = windowState(win);
  if (state) state.documentPath = resolvedPath;
  // Re-baseline after our own write so the live watch doesn't mistake it for
  // an external change, and keep watching (Save As may have changed the path).
  await trackDocument(win, resolvedPath);
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
ipcMain.handle('mdzip:pick-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
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

  const state = windowState(win);
  if (state) state.lastPackFolder = folderPath;
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
ipcMain.handle('mdzip:read-folder', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const lastPackFolder = windowState(win)?.lastPackFolder ?? null;
  if (!lastPackFolder) {
    throw new Error('Select a folder before reading it.');
  }
  const requested = Array.isArray(payload?.paths) ? payload.paths : [];
  const list = [];
  for (const rel of requested) {
    const abs = resolveInsidePackFolder(lastPackFolder, rel);
    list.push({ rel, abs, size: (await fs.stat(abs)).size });
  }
  const total = list.length;
  const bytesTotal = list.reduce((sum, file) => sum + file.size, 0);

  const emit = (done, bytesDone) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('mdzip:pack-folder-progress', { done, total, bytesDone, bytesTotal });
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

ipcMain.handle('mdzip:pick-mdz-for-unpack', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Unpack MDZip Archive',
    properties: ['openFile'],
    filters: [
      { name: 'MDZip Documents', extensions: ['mdz'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = path.resolve(result.filePaths[0]);
  const bytes = await fs.readFile(filePath);
  return {
    canceled: false,
    filePath,
    name: path.basename(filePath),
    bytes: new Uint8Array(bytes),
  };
});

ipcMain.handle('mdzip:write-unpacked-folder', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (!entries.length) {
    throw new Error('The archive has no files to unpack.');
  }

  const result = await dialog.showOpenDialog(win, {
    title: 'Choose Destination Folder',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const parentFolder = path.resolve(result.filePaths[0]);
  const destinationFolder = await uniqueChildFolder(parentFolder, payload?.defaultFolderName ?? 'unpacked-mdzip');
  await fs.mkdir(destinationFolder, { recursive: true });

  let count = 0;
  for (const entry of entries) {
    const destinationPath = resolveInsideUnpackFolder(destinationFolder, entry?.path);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, Buffer.from(entry?.bytes ?? []));
    count += 1;
  }

  return {
    canceled: false,
    folderPath: destinationFolder,
    fileCount: count,
  };
});

ipcMain.handle('mdzip:get-md-default-status', async () => {
  if (process.platform !== 'win32') {
    return { supported: false, isDefault: false };
  }
  const progId = await getMarkdownDefaultProgId();
  return { supported: true, isDefault: progId === MD_PROGID };
});

ipcMain.handle('mdzip:prompt-md-default', async (event) => {
  if (process.platform !== 'win32') {
    return { supported: false, isDefault: false };
  }

  const win = BrowserWindow.fromWebContents(event.sender);

  // SHOpenWithDialog needs a file whose extension is .md; the file is never
  // opened (no OAIF_EXEC), so a throwaway in the temp dir is enough.
  const tempPath = path.join(os.tmpdir(), `mdzip-set-default-${Date.now()}.md`);
  await fs.writeFile(tempPath, '');

  let hwnd = '0';
  if (win && !win.isDestroyed()) {
    try {
      hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
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
ipcMain.handle('mdzip:read-markdown-asset', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  const documentPath = path.resolve(String(payload?.documentPath ?? ''));
  const relativePath = String(payload?.relativePath ?? '');
  // Only serve assets for the document this window currently has open.
  if (!state?.documentPath || documentPath !== state.documentPath) {
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

// --- Print preview -----------------------------------------------------------
// The renderer builds a standalone HTML document (print CSS + inlined images)
// from the open document and sends it here. A hidden window renders it to PDF,
// and Chromium's built-in PDF viewer shows the result — supplying zoom, page
// navigation, a print button (system print dialog), and save-as-PDF for free.
const PRINT_TEMP_PREFIX = 'mdzip-studio-print-';
let printPreviewWindow = null;
let printPreviewPdfPath = null;
let printPreviewTitle = 'Print Preview';

function printTempPath(extension) {
  return path.join(
    app.getPath('temp'),
    `${PRINT_TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`
  );
}

async function renderHtmlToPdf(htmlPath) {
  const renderWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    // Bound the whole load: a stalled external image (the print document leaves
    // http(s) sources un-inlined) would otherwise hold did-finish-load forever
    // and leak this hidden window.
    await Promise.race([
      renderWindow.loadFile(htmlPath),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('Timed out preparing the document.')), 20000)
      ),
    ]);
    // Let webfonts settle so text measures at its final metrics before layout
    // is committed to PDF. executeJavaScript awaits the returned promise.
    await renderWindow.webContents.executeJavaScript('document.fonts.ready.then(() => undefined)', true);
    return await renderWindow.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' });
  } finally {
    if (!renderWindow.isDestroyed()) renderWindow.destroy();
  }
}

function showPdfPreview(pdfPath, title) {
  const windowTitle = title ? `Print Preview — ${title}` : 'Print Preview';
  printPreviewTitle = windowTitle;
  const previousPdf = printPreviewPdfPath;
  printPreviewPdfPath = pdfPath;

  if (printPreviewWindow && !printPreviewWindow.isDestroyed()) {
    printPreviewWindow.setTitle(windowTitle);
    printPreviewWindow.loadURL(pathToFileURL(pdfPath).toString());
    printPreviewWindow.focus();
    // Best-effort: Windows may still hold a lock on the displayed PDF; the
    // will-quit sweep is the backstop for anything that survives.
    if (previousPdf && previousPdf !== pdfPath) fs.unlink(previousPdf).catch(() => {});
    return;
  }

  printPreviewWindow = new BrowserWindow({
    width: 900,
    height: 1000,
    title: windowTitle,
    icon: windowIconForTheme(),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Chromium's built-in PDF viewer is gated behind the plugins flag.
      plugins: true,
    },
  });
  // A window-specific menu (replacing the app menu, whose document accelerators
  // don't belong here) that makes Quick Print discoverable. The PDF viewer's
  // toolbar print button remains the route with printer/settings choices.
  printPreviewWindow.setMenu(Menu.buildFromTemplate([
    {
      label: 'Print',
      submenu: [
        {
          label: 'Quick Print to Default Printer',
          accelerator: 'CmdOrCtrl+P',
          click: () => quickPrintPreviewPdf(),
        },
        { type: 'separator' },
        {
          label: 'Close Preview',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (printPreviewWindow && !printPreviewWindow.isDestroyed()) printPreviewWindow.close();
          },
        },
      ],
    },
  ]));
  // Keep our title: the PDF viewer pushes the document's metadata title, and
  // preventDefault alone doesn't hold the native title (the update originates
  // in the viewer's extension frame), so set ours back explicitly.
  printPreviewWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    if (printPreviewWindow && !printPreviewWindow.isDestroyed()) {
      printPreviewWindow.setTitle(printPreviewTitle);
    }
  });
  // The PDF viewer registers beforeunload while it holds unsaved ink/text
  // annotations, and in Electron a page that blocks unload silently vetoes
  // the window's close button. The preview is disposable — force close through.
  printPreviewWindow.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  // Quick print: Ctrl+P sends the PDF straight to the default printer — this
  // window already is the preview, so no further dialogs. The toolbar print
  // button keeps the full settings route (viewer dialog → system dialog).
  // Ctrl+W closes just this window. Without these handlers both keys fall
  // through to the hidden app menu's accelerators and act on the main
  // document window instead (Ctrl+W there closes the open document).
  printPreviewWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const key = input.key.toLowerCase();
    if (key === 'p' && !input.shift && !input.alt) {
      event.preventDefault();
      quickPrintPreviewPdf();
    } else if (key === 'w' && !input.shift && !input.alt) {
      event.preventDefault();
      printPreviewWindow?.close();
    }
  });
  printPreviewWindow.on('closed', () => {
    printPreviewWindow = null;
    const pdf = printPreviewPdfPath;
    printPreviewPdfPath = null;
    if (pdf) fs.unlink(pdf).catch(() => {});
  });
  printPreviewWindow.loadURL(pathToFileURL(pdfPath).toString());
}

// Print the previewed PDF to the system default printer with no dialogs.
// Feedback lives in the window title so nothing modal interrupts the flow;
// failures (no default printer, spooler error) get a real error dialog.
function quickPrintPreviewPdf() {
  const window = printPreviewWindow;
  if (!window || window.isDestroyed()) return;
  window.setTitle(`${printPreviewTitle} — printing…`);
  window.webContents.print({ silent: true, printBackground: true }, (success, failureReason) => {
    if (window.isDestroyed()) return;
    if (success) {
      window.setTitle(`${printPreviewTitle} — sent to printer`);
      setTimeout(() => {
        if (!window.isDestroyed()) window.setTitle(printPreviewTitle);
      }, 4000);
      return;
    }
    window.setTitle(printPreviewTitle);
    // A canceled driver prompt (e.g. print-to-file printers) isn't an error.
    if (/cancel/i.test(failureReason || '')) return;
    dialog.showMessageBox(window, {
      type: 'error',
      title: 'Quick Print',
      message: 'Could not print to the default printer.',
      detail: failureReason || 'Check that a default printer is set, or use the print button in the toolbar to choose a printer.',
    });
  });
}

ipcMain.handle('mdzip:print-preview', async (_event, payload) => {
  const html = typeof payload?.html === 'string' ? payload.html : '';
  const title = typeof payload?.title === 'string' ? payload.title : '';
  if (!html) return { error: 'Nothing to print.' };

  // A temp file instead of a data: URL — those cap out well below an HTML
  // document carrying its images as base64 data: URIs.
  const htmlPath = printTempPath('.html');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    const pdf = await renderHtmlToPdf(htmlPath);
    const pdfPath = printTempPath('.pdf');
    await fs.writeFile(pdfPath, pdf);
    showPdfPreview(pdfPath, title);
    return { ok: true };
  } catch (error) {
    return { error: error?.message ?? 'Could not build the print preview.' };
  } finally {
    fs.unlink(htmlPath).catch(() => {});
  }
});

// Sweep print temp files on exit — covers PDFs Windows kept locked while the
// viewer had them open, plus strays from any earlier crashed session.
app.on('will-quit', () => {
  try {
    const tempDir = app.getPath('temp');
    for (const name of readdirSync(tempDir)) {
      if (!name.startsWith(PRINT_TEMP_PREFIX)) continue;
      try { unlinkSync(path.join(tempDir, name)); } catch { /* locked or gone */ }
    }
  } catch { /* temp dir unreadable */ }
});

ipcMain.handle('mdzip:write-markdown-image', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  const documentPath = path.resolve(String(payload.documentPath ?? ''));
  const documentDirectory = path.dirname(documentPath);
  const requestedDirectory = String(payload.relativeDirectory ?? '').trim();
  const fileName = path.basename(String(payload.fileName ?? 'image'));

  if (!state?.documentPath || documentPath !== state.documentPath) {
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

// Build the menu handlers for a given window. win may be null (the app-level
// fallback menu, shown before any window exists / after the last one closes
// on platforms that don't quit on window-all-closed) — dispatchAppEvent and
// the devtools toggle no-op gracefully in that case.
function menuHandlersFor(win) {
  return {
    newDocument: () => dispatchAppEvent(win, 'mdzip-studio:new-archive'),
    newWindow: () => createWindow(),
    openDocument: () => dispatchAppEvent(win, 'mdzip-studio:open-archive'),
    packFolder: () => dispatchAppEvent(win, 'mdzip-studio:pack-folder'),
    unpackMdz: () => dispatchAppEvent(win, 'mdzip-studio:unpack-mdz'),
    save: () => dispatchAppEvent(win, 'mdzip-studio:save-archive'),
    saveAs: () => dispatchAppEvent(win, 'mdzip-studio:save-archive-as'),
    print: () => dispatchAppEvent(win, 'mdzip-studio:print'),
    showInFolder: () => dispatchAppEvent(win, 'mdzip-studio:show-in-folder'),
    insertAgentsGuide: () => dispatchAppEvent(win, 'mdzip-studio:insert-agents'),
    insertReadme: () => dispatchAppEvent(win, 'mdzip-studio:insert-readme'),
    closeDocument: () => dispatchAppEvent(win, 'mdzip-studio:close-archive'),
    quit: () => app.quit(),
    reload: () => dispatchAppEvent(win, 'mdzip-studio:reload-document'),
    toggleLineNumbers: () => dispatchAppEvent(win, 'mdzip-studio:toggle-line-numbers'),
    toggleDevTools: () => win?.webContents.toggleDevTools(),
    setMdDefault: () => dispatchAppEvent(win, 'mdzip-studio:set-md-default'),
    showKnownIssues: () => dispatchAppEvent(win, 'mdzip-studio:show-known-issues'),
    showChangelog: () => dispatchAppEvent(win, 'mdzip-studio:show-changelog'),
    checkForUpdates: () => checkForUpdates(win),
    showAbout: () => dispatchAppEvent(win, 'mdzip-studio:show-about'),
    exportDraft: () => dispatchAppEvent(win, 'mdzip-studio:export-draft'),
  };
}

// Each window carries its own menu (Save/Print/etc. reflect that window's own
// document-open state) via win.setMenu, rather than one shared app menu.
function refreshWindowMenu(win) {
  const state = windowState(win);
  const template = buildMenuTemplate({
    documentOpen: state?.documentOpen ?? false,
    isDev,
    platform: process.platform,
    handlers: menuHandlersFor(win),
  });
  win.setMenu(Menu.buildFromTemplate(template));
}

// App-level fallback menu — macOS only. That's the one platform where the app
// stays alive with no windows open (it doesn't quit on window-all-closed), so
// it needs its own menu for that state. On Windows/Linux, Menu.setApplicationMenu()
// resets *every* window's menu (not just windowless ones), which was clobbering
// the real per-window menu that refreshWindowMenu had just set — its handlers
// close over `win = null`, so every menu item without a keyboard shortcut
// (Pack Folder, Print, Show in File Manager, etc.) silently did nothing.
if (process.platform === 'darwin') {
  app.on('ready', () => {
    const template = buildMenuTemplate({
      documentOpen: false,
      isDev,
      platform: process.platform,
      handlers: menuHandlersFor(null),
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });
}

// Swap the window/taskbar icon when the OS theme changes (each BrowserWindow is
// created with the correct one for the current theme).
app.on('ready', () => {
  nativeTheme.on('updated', () => {
    for (const win of windows.keys()) {
      if (!win.isDestroyed()) win.setIcon(windowIconForTheme());
    }
  });
});
