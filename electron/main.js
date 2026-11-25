const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, net, protocol, session, shell } = require('electron');
const { runPathAction } = require('./lib/path-actions');
const { autoUpdater } = require('electron-updater');
const fs = require('fs/promises');
const { constants: fsConstants, createWriteStream, existsSync, readdirSync, unlinkSync, watch: watchFs, writeFileSync } = require('fs');
const { exec, execFile, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { pathToFileURL } = require('url');
const { documentPathFromArgs } = require('./lib/document-path');
const { saveDialogFilters } = require('./lib/save-dialog');
const { resolveInsidePackFolder } = require('./lib/pack-folder');
const { planExtract, resolveInsideFolder, existingTargets, writeFilesInto } = require('./lib/extract-files');
const {
  HELPER_PROGRAMS,
  createRegistry,
  freshPath,
  helperStatus,
  installCommandFor,
  latestVersion,
  upgradeCommandFor,
  uninstallCommandFor,
  terminalScript,
  parseExitCode,
  outlookStatus,
  previewHandlerStatus,
  requirementFor,
  requirementInstalled,
  choosePython,
  usesPip,
  setOutlookAllowed,
  setPreviewForUser,
  STUDIO_PACKAGES,
  studioInstallPaths,
  studioInstallStatus,
  userChoiceProgId,
} = require('./lib/system-integration');
const { buildJumpList, wantsNewWindow, startupActionFromArgs, recentDocumentsForMac } = require('./lib/jump-list');
const { createOpenFileQueue } = require('./lib/open-file-queue');
const { helpStartupAction } = require('./lib/help-window');
const { navigationAction } = require('./lib/navigation');
const {
  MEDIA_SCHEME,
  AllowedMedia,
  isTrustedFolder,
  isTrustedOutsideFile,
  mediaResponse,
  outsideVideoFile,
  toggleTrustedFolder,
} = require('./lib/outside-media');
const { readerSnapshot, saveCopyFilters, shouldCloseLeftoverReaders } = require('./lib/reader-window');
const convert = require('./lib/convert');
const { statsDiffer } = require('./lib/file-watch');
const externalEdit = require('./lib/external-edit');
const {
  PORTABLE_DOWNLOAD_URL,
  HOMEBREW_UPGRADE_COMMAND,
  MAC_RELEASE_API_URL,
  isHomebrewInstall,
  macDownloadPath,
  macUpdateAvailableDialog,
  macUpdateDownloadedDialog,
  macUpdateErrorDialog,
  macUpdateFromRelease,
  homebrewUpdateDialog,
  portableUpdateAvailableDialog,
  updateAvailableDialog,
  updateNotAvailableDialog,
  updateDownloadedDialog,
  updateErrorDialog,
} = require('./lib/updater');
const { buildMenuTemplate, buildPreviewMenuTemplate, buildDockMenuTemplate } = require('./lib/menu');
const { allowImageRequest, isValidViewSetting, loadSettings, saveSettings, viewSettingsOf } = require('./lib/remote-images');

// The portable .exe (electron-builder's "portable" target) unpacks itself to a
// temp folder on each start and sets PORTABLE_EXECUTABLE_DIR to the folder the
// .exe is in. It keeps its data (settings, recent files, window state) in a
// folder beside the .exe, so a copy on a USB stick carries its settings, and
// skips what only the installer sets up: file associations and "default
// Markdown editor", the taskbar Jump List (its paths would point at the temp
// copy), and installing updates. Set before anything reads userData,
// including the single-instance lock below.
const portableDir = process.platform === 'win32' ? process.env.PORTABLE_EXECUTABLE_DIR : undefined;
const isPortable = Boolean(portableDir);
if (isPortable) {
  app.setPath('userData', path.join(portableDir, 'MDZip Studio Data'));
}

// ProgID the installer registers for .md (see build/installer.nsh). Used to
// detect whether Studio is already the default Markdown editor.
const MD_PROGID = 'MDZip.Studio.Markdown';

// Window icons (bundled under electron/, so available in dev and in the packaged
// asar). Windows uses light/dark .ico files and swaps them with the OS theme
// (see the nativeTheme handler below). Electron on Linux/macOS can't load .ico
// via nativeImage — `win.setIcon()` throws — so those platforms use a single PNG
// (the real per-platform branding comes from the Linux .desktop entry / macOS
// .icns bundle, not the per-window icon).
const LIGHT_WINDOW_ICON = path.join(__dirname, 'icons', 'mdzip-mark-light.ico');
const DARK_WINDOW_ICON = path.join(__dirname, 'icons', 'mdzip-mark-dark.ico');
const PNG_WINDOW_ICON = path.join(__dirname, 'icons', 'mdzip-mark.png');
const windowIconForTheme = () => {
  if (process.platform !== 'win32') return PNG_WINDOW_ICON;
  return nativeTheme.shouldUseDarkColors ? DARK_WINDOW_ICON : LIGHT_WINDOW_ICON;
};

// macOS delivers Finder double-clicks, Dock drops and "Open With" through the
// 'open-file' event, which can fire before the app is ready (a launch by
// double-click). Queue them until the first window can open documents.
// Registered at module load, before 'ready', as macOS requires.
const openFileQueue = createOpenFileQueue();
if (process.platform === 'darwin') {
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    openFileQueue.push(filePath);
  });
}

// Multi-window: each open BrowserWindow gets its own document/menu state —
// there is no single "the" window once more than one can be open at once.
// state shape: { documentPath, documentOpen, pendingOpenPath, startupAction, lastPackFolder }
const windows = new Map();
let lastFocusedWindow = null;
const isDev = !app.isPackaged;
// Development: no HTTP cache. Vite serves dependencies as immutable URLs whose
// ?v= tag comes from the lockfile, so after node_modules changes without it (a
// local editor build copied in) a cached window kept running the old code.
if (isDev) app.commandLine.appendSwitch('disable-http-cache');
// Mirrors the renderer's recent-files list (see mdzip:set-recent-files) so the
// native "Open Recent" submenu can be built without round-tripping to a window.
let latestRecentFiles = [];

function windowState(win) {
  return win ? windows.get(win) : undefined;
}

function findWindowForPath(filePath) {
  for (const [win, state] of windows) {
    // A reader window shows a copy, not the file: opening it goes to an editing window.
    if (state.reader) continue;
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

// --- Unsaved-changes guard on window close / app quit --------------------
// The renderer owns the unsaved-changes prompt (and the notion of "needs
// save"), so before a window actually closes the main process asks it whether
// closing is OK. The renderer runs its Save / Don't Save / Cancel dialog and
// answers. Applies to the window's X button and to app quit (each window in
// turn); the in-app "Close Document" (Ctrl+W) already prompts on its own.
let closeApprovalSeq = 0;
const pendingCloseApprovals = new Map();

function requestRendererCloseApproval(win) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const requestId = ++closeApprovalSeq;
    // If the renderer never answers (crashed / hung), don't wedge the close.
    const timer = setTimeout(() => {
      if (pendingCloseApprovals.delete(requestId)) resolve(true);
    }, 30_000);
    pendingCloseApprovals.set(requestId, (allow) => {
      clearTimeout(timer);
      resolve(allow);
    });
    win.webContents.send('mdzip:window-close-requested', requestId);
  });
}

ipcMain.on('mdzip:window-close-response', (_event, payload) => {
  const resolver = pendingCloseApprovals.get(payload?.requestId);
  if (!resolver) return;
  pendingCloseApprovals.delete(payload.requestId);
  resolver(Boolean(payload?.allow));
});

// Quit is gated the same way: walk the open windows one at a time so a Cancel
// on any of them aborts the quit without having already closed the others.
let quitApproved = false;
let quitFlowRunning = false;

async function runQuitCloseFlow() {
  if (quitFlowRunning) return;
  quitFlowRunning = true;
  try {
    for (const win of [...windows.keys()]) {
      if (win.isDestroyed()) continue;
      const state = windowState(win);
      if (state?.closeApproved) continue;
      focusWindow(win);
      // Sequential on purpose: one prompt at a time, and a Cancel here stops
      // before we've touched any other window.
      const allow = await requestRendererCloseApproval(win);
      if (!allow) return; // user canceled — leave every window open
      if (state) state.closeApproved = true;
    }
    quitApproved = true;
    app.quit();
  } finally {
    quitFlowRunning = false;
  }
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
  // macOS (Finder): a window that's still empty (e.g. the one launch created)
  // takes the file instead of leaving a blank window behind a new one.
  if (process.platform === 'darwin') {
    const emptyWin = emptyWindow();
    if (emptyWin) {
      windowState(emptyWin).pendingOpenPath = filePath;
      emptyWin.webContents.send('mdzip:open-document-requested');
      focusWindow(emptyWin);
      return;
    }
  }
  // Don't focus a brand-new window here — it's created hidden and shows
  // itself via 'ready-to-show' once loaded, avoiding a blank-window flash.
  createWindow({ pendingOpenPath: filePath });
}

// A window with no document, nothing queued for it and no startup action.
function emptyWindow() {
  for (const [win, state] of windows) {
    if (win.isDestroyed()) continue;
    if (!state.documentOpen && !state.documentPath && !state.pendingOpenPath && !state.startupAction) return win;
  }
  return null;
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
  // The window has a new path (opened, saved as): File > Trust Files in This
  // Folder is about its folder.
  if (!win.isDestroyed()) refreshWindowMenu(win);
  await snapshotDocumentStat(win, filePath);
  watchDocument(win, filePath);
}

// Match the AppUserModelID the NSIS installer assigns the shortcut (electron-builder
// defaults it to the build appId). Windows keys the taskbar Jump List off this, so
// it must be set before any setJumpList call for items to appear under our icon.
if (process.platform === 'win32') {
  app.setAppUserModelId('org.mdzip.studio');
}

// --- Updates (electron-updater, GitHub Releases) --------------------------
// Nothing downloads or installs on its own. A quiet background check runs a
// short time after launch and every few hours after that; when it finds a newer
// release it just marks the Help menu (see buildMenuTemplate's
// updateAvailableVersion) — no dialog. The user opts in from there (or from
// Help → Check for Updates), confirms the download, and confirms the install on
// the next restart. The feed is the `publish` block in package.json, baked into
// app-update.yml at build time. Updates only work in a packaged build; in dev
// the feed is absent and checkForUpdates() rejects.
const UPDATE_CHECK_STARTUP_DELAY_MS = 15_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let updaterWired = false;
// The window to parent an outcome dialog to — only one check runs at a time.
let updateDialogParent = null;
// Whether the most recent check was user-initiated. Background checks stay
// silent on "up to date" / error; only the menu marker reacts.
let updateCheckIsUserInitiated = false;
// Info from the last `update-available` while a newer release is still waiting
// to be downloaded — drives the Help-menu indicator. Cleared once the update is
// downloaded (or the app restarts into it).
let availableUpdateInfo = null;

function refreshAllWindowMenus() {
  for (const win of windows.keys()) {
    if (!win.isDestroyed()) refreshWindowMenu(win);
  }
}

function wireAutoUpdater() {
  if (updaterWired) return;
  updaterWired = true;
  // Never fetch or apply an update without explicit user action.
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', (info) => {
    availableUpdateInfo = info;
    refreshAllWindowMenus();
    // Background check: just the menu marker, no interruption.
    if (!updateCheckIsUserInitiated) return;
    if (isPortable) {
      showAppDialog(updateDialogParent, portableUpdateAvailableDialog(info, app.getVersion()))
        .then(({ response }) => {
          if (response === 0) void shell.openExternal(PORTABLE_DOWNLOAD_URL);
        });
      return;
    }
    showAppDialog(updateDialogParent, updateAvailableDialog(info, app.getVersion()))
      .then(({ response }) => {
        if (response === 0) autoUpdater.downloadUpdate().catch(() => {});
      });
  });

  autoUpdater.on('update-not-available', () => {
    // A pending marker but the release is gone (pulled/yanked) — drop it.
    if (availableUpdateInfo) {
      availableUpdateInfo = null;
      refreshAllWindowMenus();
    }
    if (!updateCheckIsUserInitiated) return;
    showAppDialog(updateDialogParent, updateNotAvailableDialog(app.getVersion()));
  });

  autoUpdater.on('update-downloaded', (info) => {
    // It's now waiting on a restart, not a download — clear the "download me"
    // marker (the restart prompt below, and one on quit, carry it from here).
    availableUpdateInfo = null;
    refreshAllWindowMenus();
    showAppDialog(updateDialogParent, updateDownloadedDialog(info))
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on('error', (error) => {
    if (!updateCheckIsUserInitiated) return;
    showAppDialog(updateDialogParent, updateErrorDialog(error));
  });
}

// --- macOS updates ---
// Builds are ad-hoc signed, so electron-updater can't install in place (and we
// never call downloadUpdate/quitAndInstall there). The check reads the GitHub
// latest-release JSON directly (not latest-mac.yml): one request gives the
// version, the .dmg asset and the release page. The user downloads the .dmg and
// drags the app over the old one; Homebrew installs get the upgrade command.
let macDownloadRunning = false;

async function fetchMacUpdateInfo() {
  const response = await net.fetch(MAC_RELEASE_API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MDZip-Studio' },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
  return macUpdateFromRelease(await response.json(), app.getVersion());
}

async function checkForUpdatesMac(userInitiated) {
  updateCheckIsUserInitiated = userInitiated;
  const parent = updateDialogParent;
  let found;
  try {
    found = await fetchMacUpdateInfo();
  } catch (error) {
    if (userInitiated) showAppDialog(parent, updateErrorDialog(error));
    return;
  }
  if (!found?.newer) {
    if (availableUpdateInfo) {
      availableUpdateInfo = null;
      refreshAllWindowMenus();
    }
    if (userInitiated) showAppDialog(parent, updateNotAvailableDialog(app.getVersion()));
    return;
  }
  availableUpdateInfo = { version: found.version };
  refreshAllWindowMenus();
  if (!userInitiated) return; // background: just the menu marker
  const info = { version: found.version };
  if (isHomebrewInstall(existsSync)) {
    const { response } = await showAppDialog(parent, homebrewUpdateDialog(info, app.getVersion()));
    if (response === 0) clipboard.writeText(HOMEBREW_UPGRADE_COMMAND);
    else if (response === 1) void shell.openExternal(found.releaseUrl);
    return;
  }
  const { response } = await showAppDialog(parent, macUpdateAvailableDialog(info, app.getVersion()));
  if (response === 0) void downloadMacUpdate(found, parent);
  else if (response === 1) void shell.openExternal(found.releaseUrl);
}

// Download the release .dmg to ~/Downloads, showing progress on the Dock icon
// (setProgressBar). There is no cancel button; quitting the app abandons it and
// the half-written ".part" file is removed on the next failure only.
// UNVERIFIED on a Mac: net.fetch streaming + redirects from GitHub, Dock progress,
// whether the saved .dmg gets the quarantine flag, and quit-after-openPath.
async function downloadMacUpdate(found, parent) {
  if (macDownloadRunning) return;
  const dmgPath = found.asset ? macDownloadPath(app.getPath('downloads'), found.asset.name) : null;
  if (!dmgPath) {
    // No .dmg on the release (or an odd name): send them to the release page.
    const { response } = await showAppDialog(parent, macUpdateErrorDialog(new Error('This release has no installer to download.')));
    if (response === 0) void shell.openExternal(found.releaseUrl);
    return;
  }
  macDownloadRunning = true;
  const partPath = `${dmgPath}.part`;
  const target = parent && !parent.isDestroyed() ? parent : anyWindow();
  const setProgress = (value) => { if (target && !target.isDestroyed()) target.setProgressBar(value); };
  try {
    setProgress(2); // indeterminate until the response says how big it is
    const response = await net.fetch(found.asset.url);
    if (!response.ok || !response.body) throw new Error(`The download server returned ${response.status}.`);
    const total = Number(response.headers.get('content-length')) || 0;
    const out = createWriteStream(partPath);
    let received = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (!out.write(value)) await new Promise((resolve) => out.once('drain', resolve));
        if (total) setProgress(received / total);
      }
      await new Promise((resolve, reject) => { out.once('error', reject); out.end(resolve); });
    } catch (error) {
      out.destroy();
      throw error;
    }
    await fs.rename(partPath, dmgPath);
  } catch (error) {
    setProgress(-1);
    macDownloadRunning = false;
    fs.unlink(partPath).catch(() => {});
    const { response } = await showAppDialog(parent, macUpdateErrorDialog(error));
    if (response === 0) void shell.openExternal(found.releaseUrl);
    return;
  }
  setProgress(-1);
  macDownloadRunning = false;
  const { response } = await showAppDialog(parent, macUpdateDownloadedDialog({ version: found.version }));
  if (response === 0) {
    // Open the .dmg first, then quit through the normal path so unsaved-changes
    // prompts still run (a Cancel there simply leaves the app open).
    await shell.openPath(dmgPath);
    app.quit();
  } else if (response === 1) {
    shell.showItemInFolder(dmgPath);
  }
}

function checkForUpdates(win) {
  updateDialogParent = win ?? null;
  updateCheckIsUserInitiated = true;
  if (!app.isPackaged) {
    showAppDialog(win, {
      type: 'info',
      title: 'Check for Updates',
      message: 'Updates are only available in an installed build.',
      detail: 'Run an installed copy of MDZip Studio to check for and download updates.',
    });
    return;
  }
  if (process.platform === 'darwin') {
    void checkForUpdatesMac(true);
    return;
  }
  wireAutoUpdater();
  // The 'error' event handles user-facing messaging; swallow the rejection so
  // an unreachable feed never produces an unhandled promise rejection.
  autoUpdater.checkForUpdates().catch(() => {});
}

function checkForUpdatesInBackground() {
  if (!app.isPackaged) return;
  updateCheckIsUserInitiated = false;
  updateDialogParent = anyWindow();
  if (process.platform === 'darwin') {
    void checkForUpdatesMac(false);
    return;
  }
  wireAutoUpdater();
  autoUpdater.checkForUpdates().catch(() => {});
}

// Studio settings that the main process needs (studio#13 will grow this):
// userData/settings.json, read once and written when a setting changes.
let studioSettings = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function getSettings() {
  if (!studioSettings) studioSettings = loadSettings(settingsFile());
  return studioSettings;
}

// Videos outside a .mdz (lib/outside-media.js): the player streams one the
// reader has allowed from mdzip-media:, in pieces. Registered before 'ready'.
const allowedMedia = new AllowedMedia();
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);
app.on('ready', () => {
  protocol.handle(MEDIA_SCHEME, (request) => {
    const filePath = allowedMedia.fileFor(request.url);
    if (!filePath) return new Response(null, { status: 404 });
    return mediaResponse(filePath, request.headers.get('range'));
  });
});

// File > Trust Files in This Folder's state for a window's menu: null unless
// it shows a saved .mdz.
function folderTrustFor(win) {
  const mdzPath = win && !win.isDestroyed() ? mdzPathFor(win) : null;
  return mdzPath ? { trusted: isTrustedFolder(getSettings().trustedFolders, path.dirname(mdzPath)) } : null;
}

// The .mdz a window shows, for videos beside it: its own, or for a reading
// window, its editing window's. Null for a .md file or an unsaved document.
function mdzPathFor(win) {
  const state = windowState(win);
  if (!state) return null;
  const source = state.reader && state.readerSource && !state.readerSource.isDestroyed()
    ? windowState(state.readerSource)
    : state;
  const documentPath = source?.documentPath ?? null;
  return documentPath && /\.mdz$/i.test(documentPath) ? documentPath : null;
}

// A video outside the .mdz: where it is, for the player to name before the
// reader allows it (a click on it), and whether File > Trust Files in This
// Folder already has (only for a file in the .mdz's folder or below). Nothing
// is read.
ipcMain.handle('mdzip:find-outside-video', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const filePath = outsideVideoFile(mdzPathFor(win), payload?.path);
  if (!filePath) return { error: 'unsupported-path' };
  try {
    if (!(await fs.stat(filePath)).isFile()) return { error: 'not-found' };
  } catch {
    return { error: 'not-found' };
  }
  return { location: filePath, trusted: isTrustedOutsideFile(getSettings().trustedFolders, mdzPathFor(win), filePath) };
});

// The reader allowed it: a URL the player streams it from.
ipcMain.handle('mdzip:allow-outside-video', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const filePath = outsideVideoFile(mdzPathFor(win), payload?.path);
  if (!win || !filePath) return { error: 'unsupported-path' };
  return { url: allowedMedia.allow(win.id, filePath) };
});

// Remote images in documents (spec §9.2): https only, and only while
// View > Load Remote Images is on. Filtered here rather than with a page CSP so
// the UI's own resources (and the dev server) are untouched. data:/blob:/file:
// images from the archive never make a network request, so they aren't affected.
app.on('ready', () => {
  const appOrigin = isDev ? 'http://localhost:4300' : null;
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      if (details.resourceType !== 'image') return callback({});
      callback({ cancel: !allowImageRequest(details.url, { remoteImages: getSettings().remoteImages, appOrigin }) });
    },
  );
});

// The editor's color scheme and page width choices: each window reads them
// synchronously as it starts (preload), so its editor is created with them,
// and saves a new choice here. Windows already open keep their own until
// they're next opened.
ipcMain.on('mdzip:get-view-settings', (event) => {
  event.returnValue = viewSettingsOf(getSettings());
});
// Whether this is the Windows portable version (Help > About says so).
ipcMain.on('mdzip:is-portable', (event) => {
  event.returnValue = isPortable;
});
ipcMain.on('mdzip:set-view-setting', (_event, payload) => {
  const { key, value } = payload ?? {};
  if (!isValidViewSetting(key, value) || getSettings()[key] === value) return;
  studioSettings = { ...getSettings(), [key]: value };
  try {
    saveSettings(settingsFile(), studioSettings);
  } catch (error) {
    console.error('Could not save settings:', error);
  }
  // The editor's outline button changes the side too: keep View > Outline on
  // the Left's check mark in step.
  if (key === 'outlinePosition') refreshAllWindowMenus();
});

// View > Outline on the Left: saved for new windows, and moves the outline in
// every open one. (The editor's outline button moves it in its own window.)
function toggleOutlineSide() {
  const outlinePosition = getSettings().outlinePosition === 'left' ? 'right' : 'left';
  studioSettings = { ...getSettings(), outlinePosition };
  try {
    saveSettings(settingsFile(), studioSettings);
  } catch (error) {
    console.error('Could not save settings:', error);
  }
  refreshAllWindowMenus();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('mdzip-studio:outline-position', { detail: ${JSON.stringify(outlinePosition)} }))`
    ).catch(() => {});
  }
}

// View > Document Style: saved for new windows, and turned on or off in every
// open one.
function toggleDocumentStyles() {
  const documentStyles = getSettings().documentStyles === false;
  studioSettings = { ...getSettings(), documentStyles };
  try {
    saveSettings(settingsFile(), studioSettings);
  } catch (error) {
    console.error('Could not save settings:', error);
  }
  refreshAllWindowMenus();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('mdzip-studio:document-styles', { detail: ${JSON.stringify(documentStyles)} }))`
    ).catch(() => {});
  }
}

// File > Trust Files in This Folder, for the window's .mdz. Players already
// showing keep waiting for a click; the next time a document is shown, they
// don't. Every window's menu changes: others may be in the same folder.
function toggleTrustFolder(win) {
  const mdzPath = mdzPathFor(win);
  if (!mdzPath) return;
  const trustedFolders = toggleTrustedFolder(getSettings().trustedFolders, path.dirname(mdzPath));
  const settings = { ...getSettings(), trustedFolders };
  studioSettings = settings;
  try {
    saveSettings(settingsFile(), settings);
  } catch (error) {
    console.error('Could not save settings:', error);
  }
  refreshAllWindowMenus();
}

function toggleRemoteImages() {
  const settings = { ...getSettings(), remoteImages: !getSettings().remoteImages };
  studioSettings = settings;
  try {
    saveSettings(settingsFile(), settings);
  } catch (error) {
    console.error('Could not save settings:', error);
  }
  refreshAllWindowMenus();
}

app.on('ready', () => {
  if (!app.isPackaged) return;
  setTimeout(checkForUpdatesInBackground, UPDATE_CHECK_STARTUP_DELAY_MS).unref?.();
  setInterval(checkForUpdatesInBackground, UPDATE_CHECK_INTERVAL_MS).unref?.();
});

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

// Read the ProgID Windows currently uses to open .md for this user (see
// userChoiceProgId: UserChoiceLatest on current Windows 11, else UserChoice);
// null means no explicit default has been set.
function getMarkdownDefaultProgId() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return userChoiceProgId(createRegistry((file, args) => runProcess(file, args)), '.md');
}

// Show the Windows "How do you want to open .md files?" dialog via
// SHOpenWithDialog. OAIF_REGISTER_EXT records the user's choice as the new
// default (the only sanctioned way to set the protected UserChoice), while
// omitting OAIF_EXEC means the throwaway file is never actually opened. Runs in
// the (unelevated) user session, so the choice lands in the real user's hive.
// options.flags: OAIF_* (default 0x03, as above); Open With… on a file in a
// document passes OAIF_ALLOW_REGISTRATION | OAIF_EXEC (0x05) to open it.
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
    '$info.InFlags = [int]$env:MDZIP_OPENAS_FLAGS',
    '$h = [long]0',
    '[void][long]::TryParse($env:MDZIP_OWNER_HWND, [ref]$h)',
    '[void][MdzipStudio.Shell]::SHOpenWithDialog([IntPtr]::new($h), [ref]$info)',
    // OAIF_EXEC: the app picked may take the file over DDE (Word does), which
    // dies with this process; stay and pump messages until it has it.
    'if ($info.InFlags -band 4) { Add-Type -AssemblyName System.Windows.Forms; for ($i = 0; $i -lt 60; $i++) { [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 250 } }',
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
          MDZIP_OPENAS_FLAGS: String(options.flags ?? 0x03),
        },
      },
      () => resolve()
    );
    child.on('error', () => resolve());
  });
}

// A window's native handle as a decimal string, for dialogs shown by PowerShell.
function nativeHandleOf(win) {
  if (!win || win.isDestroyed()) return '0';
  try {
    return win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  } catch {
    return '0';
  }
}

// Open in <app> / Open With… on a file in a document (#29; lib/external-edit.js).
// Copies live under the temp folder; each save there goes back to the window.
const externalEdits = externalEdit.createExternalEdits({
  root: path.join(os.tmpdir(), 'mdzip-studio-edit'),
  onChange: (owner, change) => {
    const win = BrowserWindow.fromId(owner);
    if (win && !win.isDestroyed()) win.webContents.send('mdzip:external-file-changed', change);
  },
});
// Opens a file in its usual app, as double-clicking it does; resolves to ''
// or what went wrong (shell.openPath's contract). On Windows not through
// shell.openPath, which loses Word's DDE handoff (see SHELL_OPEN_SCRIPT).
function openInDefaultApp(filePath) {
  if (process.platform !== 'win32') return shell.openPath(filePath);
  const run = (verb) => new Promise((resolve) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', externalEdit.SHELL_OPEN_SCRIPT],
      { windowsHide: true, timeout: 60000, env: { ...process.env, MDZ_OPEN_PATH: filePath, MDZ_OPEN_VERB: verb ?? '' } },
      (error, stdout) => resolve(error ? (String(stdout ?? '').trim() || error.message) : ''),
    );
    child.on('error', (error) => resolve(error.message));
  });
  // A template (.dotx) asks for Open, so it's edited rather than used for a
  // new document; if its app has no Open, the default it is.
  const verb = externalEdit.openVerbFor(filePath);
  return run(verb).then((problem) => (problem && verb ? run(null) : problem));
}

// Extension → the app Windows opens it with ("Word"), or null; asked once each.
const appNameCache = new Map();

function appNameForExtension(ext) {
  if (process.platform !== 'win32' || !externalEdit.isFileExtension(ext)) return Promise.resolve(null);
  const key = ext.toLowerCase();
  if (!appNameCache.has(key)) {
    appNameCache.set(key, new Promise((resolve) => {
      const child = execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', externalEdit.ASSOC_SCRIPT],
        { windowsHide: true, timeout: 15000, env: { ...process.env, MDZ_EXT: key } },
        (error, stdout) => resolve(error ? null : externalEdit.parseAssocOutput(stdout)),
      );
      child.on('error', () => resolve(null));
    }));
  }
  return appNameCache.get(key);
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

const resolveInsideUnpackFolder = resolveInsideFolder;

// The per-file-type .ico files ship via extraResources (packaged) and live under
// build/ in dev. These are the same icons the installer registers for .md/.mdz.
const FILE_ICONS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'file-icons')
  : path.join(__dirname, '..', 'build', 'file-icons');

// Mirror the renderer's recent-files list into the Windows taskbar Jump List.
function updateJumpList(recentPaths) {
  if (process.platform === 'darwin') {
    // Dock icon / Apple menu recents. Rebuild rather than append: clear, then
    // add oldest-first (this also handles the renderer's Clear button).
    app.clearRecentDocuments();
    for (const p of recentDocumentsForMac(recentPaths)) app.addRecentDocument(p);
    return;
  }
  if (process.platform !== 'win32' || isPortable) return;
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

// startupAction: something the new window's renderer should do as soon as it
// has initialized — { kind: 'open-dialog' } or { kind: 'new-document', format }.
// Pulled by the renderer (mdzip:take-startup-action) rather than pushed, so it
// can't arrive before Angular has registered anything to receive it.
function createWindow({ pendingOpenPath = null, startupAction = null, readerSource = null } = {}) {
  const reading = startupAction?.kind === 'help' || startupAction?.kind === 'reader';
  const win = new BrowserWindow({
    show: false,
    // A help or reader window is narrower: a page to read next to the window you're working in.
    width: reading ? 900 : 1200,
    height: 800,
    icon: windowIconForTheme(),
    title: 'MDZip Studio',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Electron's default; explicit because the context-menu handler below
      // depends on it for misspelling suggestions (#22).
      spellcheck: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  windows.set(win, {
    // A reader window of a .md file: that file's path, so its relative images
    // load (mdzip:read-markdown-asset). Not watched, and not "the window for"
    // that file (findWindowForPath).
    documentPath: startupAction?.kind === 'reader' ? startupAction.filePath ?? null : null,
    documentOpen: false,
    pendingOpenPath,
    startupAction,
    lastPackFolder: null,
    documentStat: null,
    externalChangeNotifiedFor: null,
    fileWatcher: null,
    externalChangeTimer: null,
    afterReady: [],
    // A help window (Help > Open in New Window): a read-only page, no menu.
    help: startupAction?.kind === 'help',
    helpDoc: startupAction?.kind === 'help' ? startupAction.doc : null,
    // A reader window (View > Reading View) and the editing window it reads.
    reader: startupAction?.kind === 'reader',
    readerSource,
    // Import: the file picked to import, and the folder the picker opens in.
    importPath: null,
    lastImportFolder: null,
    // Export: the file last exported, for its Open button.
    lastExportPath: null,
    // Extract…: the file or folder last extracted to, for the status bar's Open.
    lastExtractPath: null,
    // The Pandoc or markitdown-mdz run in progress, for Cancel.
    conversion: null,
    // Shows the window (set below); a reading window calls it once its
    // document is drawn (mdzip:reading-window-ready).
    reveal: null,
    // Set once the renderer has approved this window closing (X button or the
    // quit flow), so the 'close' handler below lets the next attempt through.
    closeApproved: false,
  });
  refreshWindowMenu(win);

  const startUrl = isDev
    ? 'http://localhost:4300'
    : `file://${path.join(__dirname, '../dist/mdzip-studio/index.html')}`;

  win.loadURL(startUrl);

  // Reveal the window once it's painted (no white flash). `ready-to-show` is the
  // clean signal, but on Linux (X11/XWayland, software GPU) it is unreliable and
  // can simply never fire for the first window — which would leave the app
  // running but invisible, so the first launch looks like nothing happened.
  // `did-finish-load` always fires, and a timeout is the last resort; all three
  // funnel through one idempotent reveal.
  const revealWindow = () => {
    if (win.isDestroyed() || win.isVisible()) return;
    win.show();
    // Backup for the 'focus' event, which may not fire for the very first window.
    if (win.isFocused()) applyDarwinMenu(win);
    if (windowState(win)?.pendingOpenPath) {
      win.webContents.send('mdzip:open-document-requested');
    }
  };
  windowState(win).reveal = revealWindow;
  // A help or reader window waits for its document to be drawn: shown on page
  // load, it would flash Studio's start screen first. The timeout still shows
  // it if the renderer never says so.
  if (!reading) {
    win.once('ready-to-show', revealWindow);
    win.webContents.once('did-finish-load', revealWindow);
  }
  const revealFallbackTimer = setTimeout(revealWindow, reading ? 3000 : 4000);
  win.once('show', () => clearTimeout(revealFallbackTimer));
  // Once Studio is up, ask the import and export programs their versions, so
  // the first Import or Export doesn't wait for them (conversionTools).
  if (!toolsWarmed) {
    toolsWarmed = true;
    win.once('show', () => setTimeout(() => conversionTools().catch(() => {}), 5000));
  }

  win.on('focus', () => {
    lastFocusedWindow = win;
    applyDarwinMenu(win);
  });

  // Ask the renderer before closing so unsaved work isn't lost to the X button.
  // The quit flow marks closeApproved itself and then calls win.close().
  win.on('close', (event) => {
    const state = windowState(win);
    if (state?.closeApproved) return;
    event.preventDefault();
    requestRendererCloseApproval(win).then((allow) => {
      if (!allow || win.isDestroyed()) return;
      if (state) state.closeApproved = true;
      win.close();
    });
  });

  const windowId = win.id;
  win.on('closed', () => {
    void externalEdits.stop(windowId);
    allowedMedia.forget(windowId);
    unwatchDocument(win);
    windows.delete(win);
    if (lastFocusedWindow === win) lastFocusedWindow = null;
    // Last window gone: back to the no-window menu (darwin only; no-op elsewhere).
    if (windows.size === 0) applyDarwinMenu(null);
    // Reading windows have nothing to save, so they close without asking:
    // this window's reader, with it; and every help and reader window once
    // the last Studio window has closed, so Studio quits as usual.
    const closeAll = shouldCloseLeftoverReaders([...windows.values()], process.platform);
    for (const [other, state] of windows) {
      if (!closeAll && state.readerSource !== win) continue;
      state.closeApproved = true;
      if (!other.isDestroyed()) other.close();
    }
  });

  // The window only ever shows Studio's page: web and mail links open in the
  // browser or mail app, anything else is dropped (navigationAction).
  win.webContents.on('will-navigate', (event, url) => {
    const action = navigationAction(url, win.webContents.getURL());
    if (action === 'stay') return;
    event.preventDefault();
    if (action === 'external') void shell.openExternal(url);
  });

  // target="_blank" links the same way, never in a new window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (navigationAction(url, win.webContents.getURL()) === 'external') void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Electron never shows a context menu on its own (unlike a regular browser) —
  // the app has to build one from the platform's own suggestions. The embedded
  // editor's own context-menu handler calls preventDefault() for its formatting
  // menu, which suppresses this event entirely; Shift+right-click skips that
  // handler so spelling suggestions (and cut/copy/paste elsewhere in the app,
  // e.g. the Pack Folder filters textarea) reach here instead (#22).
  win.webContents.on('context-menu', (_event, params) => {
    const menuItems = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menuItems.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
      }
      if (params.dictionarySuggestions.length > 0) menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Add to Dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      menuItems.push({ type: 'separator' });
    }
    if (params.isEditable) {
      menuItems.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
    } else if (params.selectionText) {
      menuItems.push({ role: 'copy' });
    }
    if (menuItems.length === 0) return;
    Menu.buildFromTemplate(menuItems).popup({ window: win });
  });

  return win;
}

const initialDocumentPath = documentPathFromArgs(process.argv.slice(1));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const args = commandLine.slice(1);
    const startupAction = startupActionFromArgs(args);
    if (startupAction || wantsNewWindow(args)) {
      createWindow({ startupAction });
      return;
    }
    openOrFocus(documentPathFromArgs(args));
  });

  app.on('ready', () => {
    // Copies an app still had open when Studio last quit. Safe: this is the
    // only Studio (single-instance lock).
    void externalEdits.sweep();
    if (process.platform === 'darwin') {
      // A launch by double-click delivers the file via 'open-file' (queued), not
      // argv: open it in place of an empty window.
      if (initialDocumentPath) openFileQueue.push(initialDocumentPath);
      if (openFileQueue.pendingCount() > 0) {
        openFileQueue.drain(openOrFocus);
        return;
      }
    }
    createWindow({
      pendingOpenPath: initialDocumentPath,
      startupAction: startupActionFromArgs(process.argv.slice(1)),
    });
    // From now on 'open-file' goes straight to openOrFocus (which reuses this
    // window while it is still empty). UNVERIFIED on a Mac: a file arriving a
    // moment after ready, while this window is still loading.
    if (process.platform === 'darwin') openFileQueue.drain(openOrFocus);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Menu Exit / Cmd-Q / OS logout: prompt for unsaved work in each open window
// before quitting. window-all-closed → app.quit() lands here too, but by then
// every window already went through its own 'close' guard, so there's nothing
// left to ask.
app.on('before-quit', (event) => {
  if (quitApproved || windows.size === 0) return;
  event.preventDefault();
  runQuitCloseFlow();
});

app.on('activate', () => {
  // A queued Finder open will create its own window; don't add an empty one.
  if (windows.size === 0 && openFileQueue.pendingCount() === 0) {
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
  latestRecentFiles = Array.isArray(payload?.paths) ? payload.paths : [];
  updateJumpList(payload?.paths);
  refreshAllWindowMenus();
});

// Open Document / a recent file "alongside" the current one instead of
// replacing it — used when the requesting window already has a document open
// (see openFilePicker/openRecent in app.component.ts and the native "Open
// Recent" submenu below). A brand-new window has nothing to lose, so those
// same call sites skip this and load in place instead.
ipcMain.on('mdzip:open-document-in-new-window', () => {
  createWindow({ startupAction: { kind: 'open-dialog' } });
});

// One help window per document: asking again brings it forward at the new section.
ipcMain.on('mdzip:open-help-in-new-window', (_event, payload) => openHelpWindow(payload));

// payload: { doc, page, anchor } (see helpStartupAction).
function openHelpWindow(payload) {
  const startupAction = helpStartupAction(payload);
  if (!startupAction) return;
  for (const [win, state] of windows) {
    if (win.isDestroyed() || state.helpDoc !== startupAction.doc) continue;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (startupAction.page || startupAction.anchor) {
      // Page and anchor are checked plain names (helpStartupAction), safe to embed.
      const detail = JSON.stringify({ page: startupAction.page, anchor: startupAction.anchor });
      void win.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('mdzip-studio:help-anchor', { detail: ${detail} }))`
      );
    }
    return;
  }
  createWindow({ startupAction });
}

// View > Reading View: the sending window's document, in that window's
// reader window. Asking again updates it and brings it forward.
ipcMain.on('mdzip:open-reader-window', (event, payload) => {
  const source = BrowserWindow.fromWebContents(event.sender);
  const sourceState = windowState(source);
  if (!sourceState || sourceState.help || sourceState.reader) return;
  const snapshot = readerSnapshot(payload);
  if (!snapshot) return;
  // A .md file's relative images load from beside it.
  const filePath = /\.mdz$/i.test(snapshot.fileName) ? null : sourceState.documentPath ?? null;
  const update = { ...snapshot, filePath };
  for (const [win, state] of windows) {
    if (win.isDestroyed() || state.readerSource !== source) continue;
    state.documentPath = filePath;
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('mdzip:reader-update', update);
    return;
  }
  createWindow({ startupAction: { kind: 'reader', ...update }, readerSource: source });
});

// A help or reader window's Save a Copy: the document it shows, written
// unchanged where the user chooses. Not a Save: the window stays a reading
// window and doesn't take on (or watch) the file it wrote.
ipcMain.handle('mdzip:save-copy', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  if (!state?.help && !state?.reader) return { canceled: true };
  const copy = readerSnapshot({ bytes: payload?.bytes, fileName: payload?.fileName });
  if (!copy) return { canceled: true };
  const result = await dialog.showSaveDialog(win, {
    title: 'Save a Copy',
    defaultPath: path.join(app.getPath('documents'), copy.fileName),
    filters: saveCopyFilters(copy.fileName),
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, Buffer.from(copy.bytes));
  return { canceled: false, filePath: result.filePath };
});

// A help or reader window's document is drawn: show the window (see createWindow).
ipcMain.on('mdzip:reading-window-ready', (event) => {
  const state = windowState(BrowserWindow.fromWebContents(event.sender));
  if (state?.help || state?.reader) state.reveal?.();
});

ipcMain.handle('mdzip:take-startup-action', (event) => {
  const state = windowState(BrowserWindow.fromWebContents(event.sender));
  const action = state?.startupAction ?? null;
  if (state) state.startupAction = null;
  // The renderer has initialized (its event listeners exist): run anything
  // queued by menu items that had to create a window first (darwin, no-window menu).
  if (state?.afterReady?.length) {
    const queued = state.afterReady.splice(0);
    setTimeout(() => queued.forEach((fn) => fn()), 250);
  }
  return action;
});

ipcMain.on('mdzip:open-path-in-new-window', (_event, payload) => {
  const filePath = payload?.filePath;
  if (filePath) createWindow({ pendingOpenPath: filePath });
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
  // A reader window's path is its editing window's, set here in main.
  if (!state || state.reader) return;
  const filePath = typeof payload?.filePath === 'string' && payload.filePath
    ? payload.filePath
    : null;
  const resolved = filePath ? path.resolve(filePath) : null;
  state.documentPath = resolved;
  if (resolved) {
    trackDocument(win, resolved).catch(() => {});
  } else {
    unwatchDocument(win);
    refreshWindowMenu(win);
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

// The contents pane's Extract… (mdzip-editor#69). One file: a Save dialog under
// its own name (the system dialog asks before replacing). Several files or a
// folder: pick a folder; the files keep their archive paths, and Studio asks
// before replacing any that are already there. Starts in the document's folder.
ipcMain.handle('mdzip:extract-files', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const files = (Array.isArray(payload?.files) ? payload.files : [])
    .filter((file) => file && typeof file.path === 'string');
  if (!files.length) {
    return { canceled: true };
  }
  const documentPath = windowState(win)?.documentPath ?? null;
  const startFolder = documentPath ? path.dirname(documentPath) : undefined;
  const plan = planExtract({ files, selection: payload?.selection });

  if (plan.kind === 'file') {
    const result = await dialog.showSaveDialog(win, {
      title: 'Extract File',
      defaultPath: startFolder ? path.join(startFolder, plan.fileName) : plan.fileName,
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await fs.writeFile(result.filePath, Buffer.from(files[0].bytes ?? []));
    if (windowState(win)) windowState(win).lastExtractPath = result.filePath;
    return { canceled: false, targetPath: result.filePath, fileCount: 1 };
  }

  const result = await dialog.showOpenDialog(win, {
    title: 'Extract to Folder',
    buttonLabel: 'Extract Here',
    defaultPath: startFolder,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  const folder = path.resolve(result.filePaths[0]);
  const existing = await existingTargets(folder, files);
  if (existing.length) {
    const shown = existing.slice(0, 8).join('\n') + (existing.length > 8 ? `\n…and ${existing.length - 8} more` : '');
    const answer = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Replace Files?',
      message: existing.length === 1
        ? `"${existing[0]}" already exists in this folder. Replace it?`
        : `${existing.length} of these files already exist in this folder. Replace them?`,
      detail: existing.length === 1 ? undefined : shown,
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (answer.response !== 0) {
      return { canceled: true };
    }
  }
  const fileCount = await writeFilesInto(folder, files);
  if (windowState(win)) windowState(win).lastExtractPath = folder;
  return { canceled: false, targetPath: folder, fileCount };
});

ipcMain.handle('mdzip:get-md-default-status', async () => {
  // The portable .exe registers no file types, so it can't be the default.
  if (process.platform !== 'win32' || isPortable) {
    return { supported: false, isDefault: false };
  }
  const progId = await getMarkdownDefaultProgId();
  return { supported: true, isDefault: progId === MD_PROGID };
});

ipcMain.handle('mdzip:prompt-md-default', async (event) =>
  promptMarkdownDefault(BrowserWindow.fromWebContents(event.sender)));

// Windows 11 no longer lets an app's "How do you want to open…" dialog set a
// default (it says "To change your default apps, go to Settings > Apps >
// Default apps"). It has a Settings link to the app's own Default apps page
// instead, listing .md and .mdz: one click on .md, then pick MDZip Studio.
function usesDefaultAppsSettings() {
  if (process.platform !== 'win32') return false;
  const build = Number.parseInt(String(os.release()).split('.')[2] ?? '', 10);
  return Number.isFinite(build) && build >= 22000;
}

// The link needs the name MDZip Studio is registered under, which only an
// all-users install writes (HKLM\Software\RegisteredApplications); otherwise
// it opens Default apps itself.
async function openDefaultAppsSettings() {
  const registered = (await runProcess('reg', ['query', 'HKLM\\Software\\RegisteredApplications', '/v', 'MDZip Studio'])).code === 0;
  await shell.openExternal(registered
    ? `ms-settings:defaultapps?registeredAppMachine=${encodeURIComponent('MDZip Studio')}`
    : 'ms-settings:defaultapps');
}

async function promptMarkdownDefault(win) {
  if (process.platform !== 'win32' || isPortable) {
    return { supported: false, isDefault: false };
  }
  if (usesDefaultAppsSettings()) {
    await openDefaultAppsSettings();
    return { supported: true, isDefault: (await getMarkdownDefaultProgId()) === MD_PROGID, openedSettings: true };
  }

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
}

// ---- Help > System Integration... (studio#11) -------------------------------

// Runs a program and reports how it went instead of throwing: { code, stdout,
// stderr }, with code -1 when it couldn't start or timed out. With `shell`, the
// command line goes through cmd.exe, which Windows needs for npm's and pip's
// .cmd shims; only Studio's own fixed commands are run this way.
function runProcess(file, args, { env = process.env, shell = false, timeout = 10000, cwd } = {}) {
  return new Promise((resolve) => {
    const done = (error, stdout, stderr) => resolve({
      code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
      stdout: String(stdout ?? ''),
      stderr: String(stderr ?? ''),
    });
    const options = { env, cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
    if (shell) {
      exec([file, ...args].join(' '), options, done);
    } else {
      execFile(file, args, options, done);
    }
  });
}

// Studio's environment with a fresh PATH, so programs installed since Studio
// started are found.
async function freshEnv(reg = createRegistry((file, args) => runProcess(file, args))) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  env.PATH = await freshPath({ platform: process.platform, reg, env: process.env });
  return env;
}

// Where the Studio installer (with Windows Explorer integration) comes from:
// the download page's Windows section (only Windows cards link here).
const STUDIO_DOWNLOAD_URL = 'https://mdzip.org/studio#windows';

// Help > System Integration's cards, at once and without checking anything:
// the Windows rows (on Windows) and the helper programs. Each card's state
// comes from systemIntegrationCheck, so a slow one (markdown-mdz's Python)
// doesn't hold up the rest.
function systemIntegrationCards() {
  const platform = process.platform;
  return {
    platform,
    portable: isPortable,
    // The portable version starts with installing Studio itself.
    windows: platform === 'win32' ? [...(isPortable ? ['studio'] : []), 'markdown', 'preview', 'outlook'] : [],
    helpers: HELPER_PROGRAMS.map((helper) => ({
      id: helper.id,
      name: helper.name,
      purpose: helper.purpose,
      url: helper.url,
      installCommand: installCommandFor(helper, platform),
      uninstallCommand: uninstallCommandFor(helper, platform),
      uninstallNote: helper.uninstallNote ?? null,
      size: helper.size ?? null,
      requires: requirementFor(helper, platform)?.name ?? null,
      requiresAlways: requirementFor(helper, platform)?.always ?? false,
    })),
  };
}

// One PATH for the helper checks that start together (each asks the registry).
let checkEnv = null;
function envForChecks() {
  if (!checkEnv || Date.now() - checkEnv.at > 5000) checkEnv = { at: Date.now(), env: freshEnv() };
  return checkEnv.env;
}

// Runs `<program> <args>` as a newly started program would (fresh PATH).
async function checkRunner() {
  const env = await envForChecks();
  return (file, args) => runProcess(file, args, { env, shell: process.platform === 'win32' });
}

// Where an installed Studio would be (Windows).
function studioInstallPlaces() {
  return {
    programFiles: process.env.ProgramW6432 || process.env.ProgramFiles,
    localAppData: process.env.LOCALAPPDATA,
  };
}

// One card's state: 'studio' (portable only), 'markdown', 'preview' or 'outlook' (Windows), or a helper
// program's id ({ installed, version }).
async function systemIntegrationCheck(id) {
  const reg = createRegistry((file, args) => runProcess(file, args));
  if (process.platform === 'win32') {
    if (id === 'markdown') {
      if (isPortable) return { state: 'unsupported' };
      const [progId, registered] = await Promise.all([
        getMarkdownDefaultProgId(),
        // Only an all-users install with Explorer integration registers
        // Studio for .md; without it, Windows doesn't offer Studio there.
        reg.keyExists(`HKCR\\${MD_PROGID}\\shell\\open\\command`),
      ]);
      return {
        state: progId === MD_PROGID ? 'default' : registered ? 'not-default' : 'unregistered',
        via: usesDefaultAppsSettings() ? 'settings' : 'dialog',
      };
    }
    if (id === 'preview') {
      return previewHandlerStatus({
        reg,
        isPortable,
        fileExists: (file) => existsSync(file),
        listDir: (dir) => readdirSync(dir),
        programFiles: process.env.ProgramW6432 || process.env.ProgramFiles,
      });
    }
    if (id === 'outlook') return outlookStatus(reg);
    if (id === 'studio') return studioInstallStatus({ ...studioInstallPlaces(), run: await checkRunner(), fileExists: existsSync });
  }
  const helper = HELPER_PROGRAMS.find((candidate) => candidate.id === id);
  if (!helper) throw new Error(`Nothing to check called ${id}`);
  const run = await checkRunner();
  const { installed, version, missingReaders } = await helperStatus(helper, run);
  const pythonChoice = usesPip(helper, process.platform) ? await chosenPython() : null;
  // Not installed: is what installs it there? (Python for pip, Node.js for npm...)
  const requirementMissing = !installed && (pythonChoice
    ? !pythonChoice.found
    : !(await requirementInstalled(helper, process.platform, run)));
  // The card's commands, with the Python pip would run with (`py -3.14`).
  const options = { python: pythonChoice?.python };
  return {
    installed,
    version,
    missingReaders,
    requirementMissing,
    installCommand: installCommandFor(helper, process.platform, options),
    uninstallCommand: uninstallCommandFor(helper, process.platform, options),
  };
}

// The Python pip runs with for markitdown-mdz (choosePython), asked once for
// the checks that start together, like envForChecks.
let pythonPick = null;
function chosenPython() {
  if (!pythonPick || Date.now() - pythonPick.at > 5000) {
    pythonPick = { at: Date.now(), choice: checkRunner().then((run) => choosePython(process.platform, run)) };
  }
  return pythonPick.choice;
}

// The options a helper's commands take: the Python, for pip.
async function commandOptions(helper) {
  return usesPip(helper, process.platform) ? { python: (await chosenPython()).python } : {};
}

// Opens a terminal window running `command`, so the user sees the package
// manager's progress and answers its prompts. Returns false where Studio
// doesn't know how to open one (Linux): the row shows the command to copy.
// `onDone(code)`: called when the command has finished (the window stays
// open), with its exit code, so System Integration can check again.
//
// Windows: `start` opens the window, so cmd /k gets a console to read from.
// Spawned directly, its input was Studio's (none), so it read the end of it
// and closed the window as soon as the command finished.
function runInTerminal(command, title, onDone = null) {
  const marker = path.join(app.getPath('temp'), `mdzip-studio-${randomUUID()}.done`);
  const script = terminalScript(command, title, process.platform, marker);
  let batch = null;
  if (process.platform === 'win32') {
    batch = marker.replace(/\.done$/, '.cmd');
    writeFileSync(batch, script);
    const child = spawn('cmd.exe', ['/d', '/c', 'start', `"${title}"`, 'cmd.exe', '/k', `"${batch}"`], {
      cwd: app.getPath('home'),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('osascript', [
      // An AppleScript string: escape the command's own quotes ("markitdown-mdzip[all]").
      '-e', `tell application "Terminal" to do script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      '-e', 'tell application "Terminal" to activate',
    ], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    return false;
  }
  // The batch file goes once it's done, a little after, so cmd has read its
  // end (deleted mid-run, cmd says "The batch file cannot be found").
  watchTerminalMarker(marker, (code) => {
    if (batch) setTimeout(() => fs.unlink(batch).catch(() => {}), 5000);
    onDone?.(code);
  });
  return true;
}

// Waits for a terminal script's marker (checked each second, for up to two
// hours: winget may wait on an installer that waits on the user), then reads
// the exit code, removes the marker and calls onDone(code).
function watchTerminalMarker(marker, onDone) {
  const started = Date.now();
  const timer = setInterval(async () => {
    let text;
    try {
      text = await fs.readFile(marker, 'utf8');
    } catch {
      if (Date.now() - started > 2 * 60 * 60 * 1000) clearInterval(timer);
      return;
    }
    clearInterval(timer);
    fs.unlink(marker).catch(() => {});
    onDone(parseExitCode(text));
  }, 1000);
}

// Tells the window that ran an Install, Update or Uninstall that it finished.
function reportTerminalDone(win, action, id) {
  return (code) => {
    if (win && !win.isDestroyed()) win.webContents.send('mdzip:system-integration-finished', { action, id, code });
  };
}

ipcMain.handle('mdzip:system-integration-cards', () => systemIntegrationCards());
ipcMain.handle('mdzip:system-integration-check', (_event, id) => systemIntegrationCheck(String(id)));

// Each helper program's newest version, asked of its publisher (GitHub
// releases, the npm registry, PyPI) only while System Integration is open, and
// kept for six hours so reopening the dialog doesn't ask again. Separate from
// the status call so a slow or missing network never holds up the dialog.
const LATEST_VERSION_TTL_MS = 6 * 60 * 60 * 1000;
const latestVersionCache = new Map();

async function fetchJson(url) {
  const response = await net.fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'MDZip-Studio' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

ipcMain.handle('mdzip:system-integration-latest', async () => {
  const now = Date.now();
  const entries = await Promise.all(HELPER_PROGRAMS.map(async (helper) => {
    const cached = latestVersionCache.get(helper.id);
    let latest = cached && now - cached.at < LATEST_VERSION_TTL_MS ? cached.version : undefined;
    if (latest === undefined) {
      latest = await latestVersion(helper, fetchJson);
      // Only answers are kept, so a failed check is tried again next time.
      if (latest) latestVersionCache.set(helper.id, { version: latest, at: now });
    }
    return [helper.id, { latest, upgradeCommand: upgradeCommandFor(helper, process.platform, await commandOptions(helper)) }];
  }));
  return Object.fromEntries(entries);
});

ipcMain.handle('mdzip:system-integration-action', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const action = payload?.action;
  try {
    switch (action) {
      case 'markdown-default':
        await promptMarkdownDefault(win);
        return { ok: true };
      case 'outlook-allow':
      case 'outlook-undo':
        if (process.platform !== 'win32') return { ok: false, error: 'Windows only.' };
        await setOutlookAllowed(createRegistry((file, args) => runProcess(file, args)), action === 'outlook-allow');
        return { ok: true };
      case 'preview-off':
      case 'preview-on':
        // Per user only: HKCU overrides hide the machine-wide handler for this
        // account. Turning it off for everyone is the installer's option.
        if (process.platform !== 'win32') return { ok: false, error: 'Windows only.' };
        await setPreviewForUser(createRegistry((file, args) => runProcess(file, args)), action === 'preview-on');
        return { ok: true };
      case 'install-helper': {
        const helper = HELPER_PROGRAMS.find((candidate) => candidate.id === payload?.id);
        const command = helper ? installCommandFor(helper, process.platform, await commandOptions(helper)) : null;
        if (!helper || !command) return { ok: false, error: 'No installer for this program here.' };
        return runInTerminal(command, `Installing ${helper.name}`, reportTerminalDone(win, action, helper.id))
          ? { ok: true }
          : { ok: false, error: 'no-terminal', command };
      }
      case 'uninstall-helper': {
        const helper = HELPER_PROGRAMS.find((candidate) => candidate.id === payload?.id);
        const command = helper ? uninstallCommandFor(helper, process.platform, await commandOptions(helper)) : null;
        if (!helper || !command) return { ok: false, error: 'No uninstaller for this program here.' };
        return runInTerminal(command, `Uninstalling ${helper.name}`, reportTerminalDone(win, action, helper.id))
          ? { ok: true }
          : { ok: false, error: 'no-terminal', command };
      }
      case 'install-studio': {
        // From the portable version: install it with winget or Chocolatey.
        if (!isPortable) return { ok: false, error: 'MDZip Studio is already installed.' };
        const status = await systemIntegrationCheck('studio');
        if (status.installed) return { ok: false, error: 'MDZip Studio is already installed.' };
        if (!status.via) return { ok: false, error: 'Neither winget nor Chocolatey is installed.' };
        return runInTerminal(STUDIO_PACKAGES[status.via].run, 'Installing MDZip Studio', reportTerminalDone(win, action, 'studio'))
          ? { ok: true }
          : { ok: false, error: 'no-terminal', command: STUDIO_PACKAGES[status.via].shown };
      }
      case 'open-studio': {
        // The installed Studio, from the portable one.
        const paths = studioInstallPaths(studioInstallPlaces());
        const exe = [paths.machine, paths.user].find((candidate) => candidate && existsSync(candidate));
        if (!exe) return { ok: false, error: 'MDZip Studio isn’t installed.' };
        const error = await shell.openPath(exe);
        return error ? { ok: false, error } : { ok: true };
      }
      case 'upgrade-helper': {
        const helper = HELPER_PROGRAMS.find((candidate) => candidate.id === payload?.id);
        const command = helper ? upgradeCommandFor(helper, process.platform, await commandOptions(helper)) : null;
        if (!helper || !command) return { ok: false, error: 'No updater for this program here.' };
        return runInTerminal(command, `Updating ${helper.name}`, reportTerminalDone(win, action, helper.id))
          ? { ok: true }
          : { ok: false, error: 'no-terminal', command };
      }
      case 'open-page': {
        // Only Studio's own known pages: a helper's download page, what it
        // needs installed first ("requires:<id>"), or Studio's.
        const id = String(payload?.id ?? '');
        const requires = id.startsWith('requires:');
        const helper = HELPER_PROGRAMS.find((candidate) => candidate.id === (requires ? id.slice('requires:'.length) : id));
        const url = helper
          ? (requires ? requirementFor(helper, process.platform)?.url ?? null : helper.url)
          : id === 'studio' ? STUDIO_DOWNLOAD_URL : null;
        if (!url) return { ok: false, error: 'Unknown page.' };
        await shell.openExternal(url);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Unknown action.' };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
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

// Copy the document's path or containing folder path to the clipboard.
ipcMain.handle('mdzip:path-action', (_event, payload) =>
  runPathAction(
    { filePath: payload?.filePath, action: payload?.action },
    { clipboard, access: (p) => fs.access(p) },
  ));

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
        // Generous: a long document carries every picture inside the page.
        setTimeout(() => reject(new Error('Timed out preparing the document.')), 120000)
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
  if (process.platform === 'darwin') {
    // setMenu is a no-op on macOS; the preview gets its own application menu
    // while it is focused (see applyDarwinMenu).
    const previewWin = printPreviewWindow;
    previewWin.on('focus', () => applyDarwinMenu(previewWin));
    previewWin.on('closed', () => {
      if (darwinMenuWin === previewWin || !darwinMenuWin) applyDarwinMenu(anyWindow());
    });
    applyDarwinMenu(previewWin);
  } else printPreviewWindow.setMenu(Menu.buildFromTemplate([
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

// --- File > Import... and File > Export... (studio#33, studio#41) ------------
// Pandoc (with mdzip-pandoc's scripts, shipped with Studio) and markitdown-mdz,
// found the way System Integration finds them. Programs run with their
// arguments as an array, never through a shell: the file names are the user's.

// mdzip-pandoc's mdz.lua, docx.lua and mdzip-core-lua: next to the app when
// installed (outside app.asar, so Pandoc can read them), vendor/ in development.
function mdzipPandocScripts() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mdzip-pandoc')
    : path.join(__dirname, '..', 'vendor', 'mdzip-pandoc');
}

const CONVERT_TOOLS = ['pandoc', 'markitdown-mdz'];

// Runs a conversion with no time limit (a long document can take a while);
// the dialog's Cancel stops it (mdzip:convert-cancel). Resolves { code,
// stdout, stderr, canceled, startError }: startError is why the program
// couldn't be started at all.
function runConversion(state, file, args, { env, cwd }) {
  return new Promise((resolve) => {
    const child = execFile(file, args, { env, cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (state.conversion === child) state.conversion = null;
      const started = !error || typeof error.code === 'number' || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || child.canceledByUser;
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        canceled: child.canceledByUser === true,
        startError: started ? null : error.message,
      });
    });
    state.conversion = child;
  });
}

// The dialog's Cancel: stop this window's conversion. On Windows the whole
// process tree, since markitdown-mdz's launcher runs Python as a child.
ipcMain.handle('mdzip:convert-cancel', (event) => {
  const child = windowState(BrowserWindow.fromWebContents(event.sender))?.conversion;
  if (!child || child.exitCode !== null) return { ok: false };
  child.canceledByUser = true;
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    child.kill();
  }
  return { ok: true };
});

// Whether Pandoc and markitdown-mdz are here: { env, programs: { pandoc:
// full path | null, ... }, statuses: { pandoc: { installed, version, usable },
// ... } }. Looked for each time it's needed, so a program installed meanwhile
// is found. A program's `--version` is remembered until the program file
// changes (an upgrade): markitdown-mdz's takes over a second (Python starting),
// which made Import wait before its dialog.
const toolVersions = new Map();
let toolsWarmed = false;

async function versionOf(helper, file, env) {
  let key = null;
  try {
    const { size, mtimeMs } = await fs.stat(file);
    key = `${file}|${size}|${mtimeMs}`;
  } catch {
    // Can't tell if it changed: ask it.
  }
  if (key && toolVersions.has(key)) return toolVersions.get(key);
  const status = await helperStatus(helper, (_file, args) => runProcess(file, args, { env }));
  // Not remembered when it didn't answer: it may have been busy.
  if (key && status.installed) toolVersions.set(key, status);
  return status;
}

async function conversionTools() {
  const env = await freshEnv();
  const programs = {};
  const entries = await Promise.all(CONVERT_TOOLS.map(async (id) => {
    const helper = HELPER_PROGRAMS.find((candidate) => candidate.id === id);
    programs[id] = convert.findProgram(helper.command, env.PATH, { exists: (file) => existsSync(file) });
    const status = programs[id] ? await versionOf(helper, programs[id], env) : { installed: false, version: null };
    return [id, { installed: status.installed, version: status.version, usable: convert.toolUsable(id, status) }];
  }));
  return { env, programs, statuses: Object.fromEntries(entries) };
}

async function convertTempFolder() {
  return fs.mkdtemp(path.join(app.getPath('temp'), 'mdzip-studio-convert-'));
}

// Import: pick a file, then the dialog shows the programs that can read it and
// the command each would run.
ipcMain.handle('mdzip:import-pick', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  if (!state) return { canceled: true };
  const result = await dialog.showOpenDialog(win, {
    title: 'Import',
    defaultPath: state.lastImportFolder ?? app.getPath('documents'),
    properties: ['openFile'],
    filters: convert.importDialogFilters(),
  });
  const filePath = result.filePaths?.[0];
  if (result.canceled || !filePath) return { canceled: true };
  state.lastImportFolder = path.dirname(filePath);
  const format = convert.importFormatFor(filePath);
  if (!format) return { canceled: false, error: true, message: `Studio can't import ${path.extname(filePath) || 'this kind of'} files.` };
  // Only the file picked here can be imported (mdzip:import-run).
  state.importPath = filePath;
  const { statuses } = await conversionTools();
  const choices = convert.importChoices(filePath, statuses);
  const fileName = path.basename(filePath);
  const output = convert.withExtension(fileName, 'mdz');
  return {
    canceled: false,
    fileName,
    folder: path.dirname(filePath),
    formatName: format.name,
    defaultTool: convert.defaultImportTool(choices),
    choices: choices.map((choice) => ({
      ...choice,
      commandLine: convert.commandLine(convert.importCommand({ tool: choice.tool, input: fileName, output })),
    })),
  };
});

// Import: convert the picked file into a temporary folder and hand back the
// .mdz, which opens unsaved (Save asks where to keep it).
ipcMain.handle('mdzip:import-run', async (event, payload) => {
  const state = windowState(BrowserWindow.fromWebContents(event.sender));
  const filePath = state?.importPath;
  const tool = payload?.tool;
  if (!filePath || !CONVERT_TOOLS.includes(tool)) return { error: true, message: 'Pick a file to import first.' };
  const { env, programs, statuses } = await conversionTools();
  const choice = convert.importChoices(filePath, statuses).find((candidate) => candidate.tool === tool);
  if (!choice?.usable) return { error: true, message: `${convert.TOOL_NAMES[tool]} isn't ready on this computer. Set it up in Help > System Integration.` };
  const work = await convertTempFolder();
  try {
    const fileName = convert.withExtension(path.basename(filePath), 'mdz');
    const output = path.join(work, fileName);
    const look = payload?.look && typeof payload.look === 'object' ? payload.look : null;
    const notes = payload?.notes === true;
    const { args } = convert.importCommand({ tool, input: filePath, output, scripts: mdzipPandocScripts(), look, notes });
    // In the file's folder, so a web page's pictures are found next to it.
    const run = await runConversion(state, programs[tool], args, { env, cwd: path.dirname(filePath) });
    if (run.canceled) return { canceled: true };
    let bytes = null;
    try {
      bytes = await fs.readFile(output);
    } catch {
      // Not written: the run failed.
    }
    if (run.code !== 0 || !bytes) return { ...convert.describeFailure(tool, run), error: true };
    const imported = { bytes: new Uint8Array(bytes), fileName, warnings: convert.warningsFrom(run.stderr) };
    // Conversion notes: the renderer adds what it did (conversion-notes.ts),
    // with the command as the dialog showed it (file names, no folders).
    if (notes) {
      imported.notes = {
        tool: convert.TOOL_NAMES[tool] ?? tool,
        command: convert.commandLine(convert.importCommand({ tool, input: path.basename(filePath), output: fileName, look, notes })),
        source: path.basename(filePath),
      };
    }
    // A Word document's Import options: the renderer adds its styles and/or
    // the file itself to the .mdz (imported-word.ts), so it gets the file too.
    const keepStyles = payload?.keepStyles === true;
    const keepOriginal = payload?.keepOriginal === true;
    const documentStyle = payload?.documentStyle === true;
    if ((keepStyles || keepOriginal || documentStyle) && /\.(docx|docm|dotx|dotm)$/i.test(filePath)) {
      try {
        imported.original = {
          fileName: path.basename(filePath),
          bytes: new Uint8Array(await fs.readFile(filePath)),
          keepStyles,
          keepOriginal,
          documentStyle,
        };
      } catch {
        // Gone since the import read it: the document comes without them.
      }
    }
    // Never in place of a document that's open: in a new window instead.
    if (state.documentOpen) {
      createWindow({ startupAction: { kind: 'imported', ...imported } });
      return { openedInNewWindow: true, fileName };
    }
    return imported;
  } finally {
    fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
});

// An .mdz's document to export instead of its entry point (the page being
// viewed), or null. mdz.lua checks it names a document in the archive.
function exportDocumentPath(value) {
  return typeof value === 'string' && value.trim() && value.length < 1024 ? value.trim() : null;
}

// Export: whether Pandoc is here, and the command each format would run for
// this document (fileName, sourceFormat 'mdz' | 'markdown', document).
ipcMain.handle('mdzip:export-options', async (_event, payload) => {
  const fileName = path.basename(String(payload?.fileName ?? '')) || 'Document.mdz';
  const sourceFormat = payload?.sourceFormat === 'markdown' ? 'markdown' : 'mdz';
  const document = exportDocumentPath(payload?.document);
  const { statuses } = await conversionTools();
  const commands = {};
  for (const combine of [false, true]) {
    for (const format of convert.EXPORT_FORMATS) {
      commands[`${format.id}${combine ? '+combine' : ''}`] = convert.commandLine(convert.exportCommand({
        format: format.id,
        input: fileName,
        output: convert.withExtension(fileName, format.extension),
        sourceFormat,
        combine,
        document,
      }));
    }
  }
  return {
    pandoc: statuses.pandoc,
    formats: convert.EXPORT_FORMATS.map(({ id, name, extension, tool }) => ({ id, name, extension, tool })),
    commands,
  };
});

// Export's save dialog: in the document's folder (or Documents), named after it.
async function chooseExportPath(win, { fileName, documentPath, format }) {
  const name = convert.withExtension(fileName, format.extension);
  const folder = documentPath ? path.dirname(documentPath) : app.getPath('documents');
  const result = await dialog.showSaveDialog(win, {
    title: `Export as ${format.name}`,
    defaultPath: path.join(folder, name),
    filters: [{ name: format.name, extensions: [format.extension] }],
  });
  return result.canceled || !result.filePath ? null : result.filePath;
}

// Export with Pandoc: { format, bytes, fileName, sourceFormat, combine } →
// { filePath, warnings } | { canceled } | { error, message }. The bytes are
// the document as it is now, unsaved edits included.
ipcMain.handle('mdzip:export-run', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  const format = convert.exportFormat(payload?.format);
  if (!state || !format || format.tool !== 'pandoc' || !payload?.bytes) return { error: true, message: 'Nothing to export.' };
  const fileName = path.basename(String(payload.fileName ?? '')) || 'Document.mdz';
  const sourceFormat = payload.sourceFormat === 'markdown' ? 'markdown' : 'mdz';
  const outputPath = await chooseExportPath(win, { fileName, documentPath: state.documentPath, format });
  if (!outputPath) return { canceled: true };
  const { env, programs, statuses } = await conversionTools();
  if (!statuses.pandoc.usable) return { error: true, message: "Pandoc isn't ready on this computer. Set it up in Help > System Integration." };
  const work = await convertTempFolder();
  try {
    const input = path.join(work, sourceFormat === 'markdown' ? convert.withExtension(fileName, 'md') : convert.withExtension(fileName, 'mdz'));
    await fs.writeFile(input, Buffer.from(payload.bytes));
    const { args, env: documentEnv } = convert.exportCommand({
      format: format.id,
      input,
      output: outputPath,
      sourceFormat,
      combine: !!payload.combine,
      document: exportDocumentPath(payload.document),
      scripts: mdzipPandocScripts(),
    });
    // A plain .md's pictures are found next to it.
    const cwd = sourceFormat === 'markdown' && state.documentPath ? path.dirname(state.documentPath) : work;
    // docx.lua writes the archive's reference document to a temporary folder.
    // MDZ_DOCUMENT only as asked: never one left in Studio's own environment.
    const runEnv = { ...env, TMPDIR: work, TEMP: work, TMP: work };
    delete runEnv.MDZ_DOCUMENT;
    const run = await runConversion(state, programs.pandoc, args, { env: { ...runEnv, ...documentEnv }, cwd });
    if (run.canceled) {
      fs.rm(outputPath, { force: true }).catch(() => {});
      return { canceled: true };
    }
    if (run.code !== 0) return { error: true, ...convert.describeFailure('pandoc', run) };
    state.lastExportPath = outputPath;
    return { filePath: outputPath, warnings: convert.warningsFrom(run.stderr) };
  } finally {
    fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
});

// Insert Word Template: Pandoc's own Word styles, as the bytes of a .docx.
// → { bytes, command } | { error, message }. `command` is the Pandoc command
// that made them, with "reference.docx" for where they went.
ipcMain.handle('mdzip:word-template', async () => {
  const { env, programs, statuses } = await conversionTools();
  if (!statuses.pandoc.usable) {
    return { error: true, message: "Studio makes the template with Pandoc, which isn't ready on this computer. Set it up in Help > System Integration." };
  }
  const work = await convertTempFolder();
  try {
    const output = path.join(work, 'reference.docx');
    const { args } = convert.wordTemplateCommand(output);
    const run = await runConversion({}, programs.pandoc, args, { env, cwd: work });
    if (run.code !== 0) return { error: true, ...convert.describeFailure('pandoc', run) };
    const bytes = new Uint8Array(await fs.readFile(output));
    return { bytes, command: convert.commandLine(convert.wordTemplateCommand('reference.docx')) };
  } catch (error) {
    return { error: true, message: `Couldn't make the Word template: ${error.message}` };
  } finally {
    fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
});

// Export as PDF: Studio's own preview, made into a PDF as Print does.
// { html, fileName } → { filePath } | { canceled } | { error, message }.
ipcMain.handle('mdzip:export-pdf', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const state = windowState(win);
  const html = typeof payload?.html === 'string' ? payload.html : '';
  if (!state || !html) return { error: true, message: 'Nothing to export.' };
  const fileName = path.basename(String(payload?.fileName ?? '')) || 'Document.mdz';
  const outputPath = await chooseExportPath(win, { fileName, documentPath: state.documentPath, format: convert.exportFormat('pdf') });
  if (!outputPath) return { canceled: true };
  const htmlPath = printTempPath('.html');
  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    await fs.writeFile(outputPath, await renderHtmlToPdf(htmlPath));
    state.lastExportPath = outputPath;
    return { filePath: outputPath, warnings: [] };
  } catch (error) {
    return { error: true, message: error?.message ?? 'Could not make the PDF.' };
  } finally {
    fs.unlink(htmlPath).catch(() => {});
  }
});

// The app that opens files like this one ("Word"), for "Open in Word"; null
// when Studio can't tell (not Windows) or nothing is registered.
ipcMain.handle('mdzip:app-for-file', async (_event, payload) => ({
  name: await appNameForExtension(String(payload?.extension ?? '')),
}));

// Open in <app> (how: 'open') or Open With… (how: 'open-with') on a file in
// the document: a copy under the temp folder, watched unless watchChanges is
// false (a read-only document), so each save there comes back
// (mdzip:external-file-changed). token names the window's current document.
ipcMain.handle('mdzip:edit-externally', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { error: 'No window.' };
  if (externalEdit.isRunnable(String(payload?.path ?? ''))) {
    return { error: "it's a program or script, and Studio doesn't run those from a document" };
  }
  let filePath;
  try {
    ({ filePath } = await externalEdits.start(win.id, {
      token: payload?.token,
      path: String(payload?.path ?? ''),
      bytes: payload?.bytes,
      watchChanges: payload?.watchChanges !== false,
    }));
  } catch (error) {
    return { error: error?.message ?? 'Could not copy the file out.' };
  }
  if (payload?.how === 'open-with') {
    if (process.platform === 'win32') {
      // Windows' own Open With: the app picked opens the copy (OAIF_EXEC);
      // "Always use this app" applies as it does in Explorer.
      // Not awaited: the process stays a while after the pick (see the script).
      void showMarkdownOpenWithDialog({ filePath, hwnd: nativeHandleOf(win), flags: 0x05 });
      return { ok: true, filePath };
    }
    if (process.platform === 'darwin') {
      const picked = await dialog.showOpenDialog(win, {
        title: 'Open With',
        buttonLabel: 'Open',
        defaultPath: '/Applications',
        properties: ['openFile'],
        filters: [{ name: 'Applications', extensions: ['app'] }],
      });
      if (picked.canceled || !picked.filePaths.length) return { canceled: true };
      const child = spawn('open', ['-a', picked.filePaths[0], filePath], { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      return { ok: true, filePath };
    }
  }
  const problem = await openInDefaultApp(filePath);
  return problem ? { error: problem } : { ok: true, filePath };
});

// The window's document changed (another opened, or it closed): its copies
// stop coming back and are removed.
ipcMain.handle('mdzip:stop-external-edits', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) await externalEdits.stop(win.id);
  return { ok: true };
});

// A save from the app would replace a file that has also changed in the
// document since it went out (Replace…, say): ask which to keep.
ipcMain.handle('mdzip:confirm-external-replace', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const app = String(payload?.app ?? 'the other app');
  const file = String(payload?.path ?? 'This file');
  const answer = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Replace File?',
    message: `${file} was saved in ${app}, but it has also changed in this document since you opened it there.`,
    detail: `Replace it with the version saved in ${app}?`,
    buttons: [`Use ${app}'s Version`, "Keep the Document's Version"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return { replace: answer.response === 0 };
});

// Export's Open button: the file this window last exported, in its usual app.
ipcMain.handle('mdzip:open-export', async (event) => {
  const filePath = windowState(BrowserWindow.fromWebContents(event.sender))?.lastExportPath;
  if (!filePath) return { error: 'no-path' };
  const problem = await openInDefaultApp(filePath);
  return problem ? { error: problem } : { ok: true };
});

// The status bar's Open after Extract…: the file (in its usual app) or the
// folder this window last extracted to. Only that path, never one the page names.
ipcMain.handle('mdzip:open-extracted', async (event) => {
  const filePath = windowState(BrowserWindow.fromWebContents(event.sender))?.lastExtractPath;
  if (!filePath) return { error: 'no-path' };
  const problem = await openInDefaultApp(filePath);
  return problem ? { error: problem } : { ok: true };
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
// With no window (macOS keeps the app alive after the last window closes),
// items that need a renderer open one first: New/Open via a startup action,
// the rest by dispatching once the new window's renderer has initialized.
function dispatchOrOpenWindow(win, name) {
  if (win) return dispatchAppEvent(win, name);
  const fresh = createWindow();
  windowState(fresh).afterReady.push(() => dispatchAppEvent(fresh, name));
  return undefined;
}

function menuHandlersFor(win) {
  return {
    newDocument: () => (win
      ? dispatchAppEvent(win, 'mdzip-studio:new-archive')
      : createWindow({ startupAction: { kind: 'new-document', format: 'markdown' } })),
    newWindow: () => createWindow(),
    openDocument: () => (win
      ? dispatchAppEvent(win, 'mdzip-studio:open-archive')
      : createWindow({ startupAction: { kind: 'open-dialog' } })),
    // Reuses the same pendingOpenPath delivery a double-click / "Open with" /
    // Jump List launch already uses (see openOrFocus) — the only difference is
    // whether that lands in this window (empty) or a fresh one (this window
    // already has a document open, so don't clobber it).
    openRecentPath: (filePath) => {
      const state = windowState(win);
      if (!state || state.documentOpen) {
        createWindow({ pendingOpenPath: filePath });
        return;
      }
      state.pendingOpenPath = filePath;
      win?.webContents.send('mdzip:open-document-requested');
    },
    packFolder: () => dispatchOrOpenWindow(win, 'mdzip-studio:pack-folder'),
    unpackMdz: () => dispatchOrOpenWindow(win, 'mdzip-studio:unpack-mdz'),
    importDocument: () => dispatchOrOpenWindow(win, 'mdzip-studio:import-document'),
    exportDocument: () => dispatchAppEvent(win, 'mdzip-studio:export-document'),
    save: () => dispatchAppEvent(win, 'mdzip-studio:save-archive'),
    saveAs: () => dispatchAppEvent(win, 'mdzip-studio:save-archive-as'),
    print: () => dispatchAppEvent(win, 'mdzip-studio:print'),
    showInFolder: () => dispatchAppEvent(win, 'mdzip-studio:show-in-folder'),
    copyFilePath: () => dispatchAppEvent(win, 'mdzip-studio:copy-path'),
    copyFolderPath: () => dispatchAppEvent(win, 'mdzip-studio:copy-folder-path'),
    insertAgentsGuide: () => dispatchAppEvent(win, 'mdzip-studio:insert-agents'),
    insertReadme: () => dispatchAppEvent(win, 'mdzip-studio:insert-readme'),
    insertWordTemplate: () => dispatchAppEvent(win, 'mdzip-studio:insert-word-template'),
    closeDocument: () => dispatchAppEvent(win, 'mdzip-studio:close-archive'),
    quit: () => app.quit(),
    reload: () => dispatchAppEvent(win, 'mdzip-studio:reload-document'),
    openReadingView: () => dispatchAppEvent(win, 'mdzip-studio:open-reading-view'),
    toggleLineNumbers: () => dispatchAppEvent(win, 'mdzip-studio:toggle-line-numbers'),
    toggleRemoteImages: () => toggleRemoteImages(),
    toggleTrustFolder: () => toggleTrustFolder(win),
    toggleOutlineSide: () => toggleOutlineSide(),
    toggleDocumentStyles: () => toggleDocumentStyles(),
    toggleDevTools: () => win?.webContents.toggleDevTools(),
    showSystemIntegration: () => dispatchOrOpenWindow(win, 'mdzip-studio:show-system-integration'),
    showHelp: () => openHelpWindow({ doc: 'studio-help' }),
    showKnownIssues: () => dispatchOrOpenWindow(win, 'mdzip-studio:show-known-issues'),
    showChangelog: () => dispatchOrOpenWindow(win, 'mdzip-studio:show-changelog'),
    checkForUpdates: () => checkForUpdates(win),
    showAbout: () => dispatchOrOpenWindow(win, 'mdzip-studio:show-about'),
    exportDraft: () => dispatchAppEvent(win, 'mdzip-studio:export-draft'),
  };
}

// Each window carries its own menu (Save/Print/etc. reflect that window's own
// document-open state) via win.setMenu, rather than one shared app menu.
function refreshWindowMenu(win) {
  if (process.platform === 'darwin') {
    // setMenu is a no-op on macOS: only the window the application menu is
    // currently built for needs a rebuild.
    if (win === darwinMenuWin) applyDarwinMenu(win);
    return;
  }
  const state = windowState(win);
  if (state?.help || state?.reader) {
    win.setMenu(null);
    return;
  }
  const template = buildMenuTemplate({
    documentOpen: state?.documentOpen ?? false,
    isDev,
    platform: process.platform,
    handlers: menuHandlersFor(win),
    updateAvailableVersion: availableUpdateInfo?.version ?? null,
    recentFiles: latestRecentFiles,
    remoteImages: getSettings().remoteImages,
    folderTrust: folderTrustFor(win),
    outlineLeft: getSettings().outlinePosition === 'left',
    documentStyles: getSettings().documentStyles !== false,
  });
  win.setMenu(Menu.buildFromTemplate(template));
}

// The recent-files list is global (one renderer-side store shared across
// windows), so every open window's "Open Recent" submenu needs rebuilding
// whenever it changes — not just the window that reported it.
function refreshAllWindowMenus() {
  for (const win of windows.keys()) {
    refreshWindowMenu(win);
  }
  // No window currently owns the menu (e.g. app idle after the last close):
  // still refresh the no-window menu so the update marker / recents show.
  if (process.platform === 'darwin' && (!darwinMenuWin || darwinMenuWin.isDestroyed())) applyDarwinMenu(null);
}

// macOS: the application menu is global, so it is rebuilt for whichever window
// is focused (focus event, document open/close, recents, update state), bound to
// that window's handlers. null = no window (handlers open one when needed).
// The print-preview window gets its own small menu. UNVERIFIED on a Mac: that
// replacing the application menu inside a 'focus' handler doesn't flicker or
// drop a menu that's currently being tracked.
let darwinMenuWin = null;
function applyDarwinMenu(win) {
  if (process.platform !== 'darwin') return;
  const target = win && !win.isDestroyed() ? win : null;
  darwinMenuWin = target;
  const updateAvailableVersion = availableUpdateInfo?.version ?? null;
  let template;
  if (target && target === printPreviewWindow) {
    template = buildPreviewMenuTemplate({
      updateAvailableVersion,
      handlers: {
        ...menuHandlersFor(anyWindow()),
        quickPrint: () => quickPrintPreviewPdf(),
        closePreview: () => { if (!target.isDestroyed()) target.close(); },
      },
    });
  } else {
    template = buildMenuTemplate({
      documentOpen: windowState(target)?.documentOpen ?? false,
      isDev,
      platform: process.platform,
      handlers: menuHandlersFor(target),
      updateAvailableVersion,
      recentFiles: latestRecentFiles,
      remoteImages: getSettings().remoteImages,
      folderTrust: folderTrustFor(target),
      outlineLeft: getSettings().outlinePosition === 'left',
      documentStyles: getSettings().documentStyles !== false,
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    applyDarwinMenu(null);
    // Dock icon menu: the same actions as the Windows Jump List tasks.
    app.dock?.setMenu(Menu.buildFromTemplate(buildDockMenuTemplate({
      handlers: {
        newMarkdown: () => createWindow({ startupAction: { kind: 'new-document', format: 'markdown' } }),
        newMdz: () => createWindow({ startupAction: { kind: 'new-document', format: 'mdz' } }),
        newWindow: () => createWindow(),
      },
    })));
  });
}

// Swap the window/taskbar icon when the OS theme changes (each BrowserWindow is
// created with the correct one for the current theme). Windows-only: it's the
// only platform with per-theme .ico variants, and `setIcon` with the PNG the
// other platforms use would just be a no-op reassignment.
if (process.platform === 'win32') {
  app.on('ready', () => {
    nativeTheme.on('updated', () => {
      for (const win of windows.keys()) {
        if (!win.isDestroyed()) win.setIcon(windowIconForTheme());
      }
    });
  });
}
