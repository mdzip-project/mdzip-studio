const path = require('path');

// The Jump List is Windows-only, so paths here are always Windows paths (path.win32).
// Launch flags the Jump List's tasks pass. Studio is single-process, so a plain
// relaunch just focuses the running window — the second-instance handler
// (main.js) checks for these to open a fresh window instead.
const NEW_WINDOW_FLAG = '--new-window';
const NEW_MARKDOWN_FLAG = '--new-md';
const NEW_MDZ_FLAG = '--new-mdz';

// Build the relaunch arguments for a Jump List item. A packaged build's
// execPath IS the app, so the file path alone suffices; in dev, execPath is
// electron.exe and needs the app directory before the file argument.
function jumpListLaunchArgs(filePath, { isPackaged, appPath }) {
  const quotedFile = `"${filePath}"`;
  return isPackaged ? quotedFile : `"${appPath}" ${quotedFile}`;
}

function flagLaunchArgs(flag, { isPackaged, appPath }) {
  return isPackaged ? flag : `"${appPath}" ${flag}`;
}

function newWindowLaunchArgs(opts) {
  return flagLaunchArgs(NEW_WINDOW_FLAG, opts);
}

function wantsNewWindow(args) {
  return Array.isArray(args) && args.includes(NEW_WINDOW_FLAG);
}

// The startup action a relaunch's flags ask for: a new blank document of the
// given format (the renderer creates it once it's up), or null.
function startupActionFromArgs(args) {
  if (!Array.isArray(args)) return null;
  if (args.includes(NEW_MARKDOWN_FLAG)) return { kind: 'new-document', format: 'markdown' };
  if (args.includes(NEW_MDZ_FLAG)) return { kind: 'new-document', format: 'mdz' };
  return null;
}

function jumpListIconFor(filePath, fileIconsDir) {
  const iconFile = /\.md$/i.test(filePath) ? 'md.ico' : 'mdz.ico';
  return { iconPath: path.win32.join(fileIconsDir, iconFile), iconIndex: 0 };
}

// Shape the Windows taskbar Jump List from the renderer's recent-files list.
// Each entry relaunches the exe with the file path, which the single-instance
// handler routes through queueOpenDocument just like a double-click would.
function buildJumpList(recentPaths, { isPackaged, appPath, execPath, fileIconsDir }) {
  const items = (Array.isArray(recentPaths) ? recentPaths : [])
    // Only .md/.mdz survive — these are what documentPathFromArgs accepts on relaunch.
    .filter((p) => typeof p === 'string' && /\.(?:mdz|md)$/i.test(p))
    .slice(0, 10)
    .map((p) => ({
      type: 'task',
      program: execPath,
      args: jumpListLaunchArgs(p, { isPackaged, appPath }),
      title: path.win32.basename(p),
      description: p,
      // Per-type document icon instead of the program's (electron.exe) icon.
      ...jumpListIconFor(p, fileIconsDir),
    }));
  const categories = [];
  if (items.length) categories.push({ type: 'custom', name: 'Recent', items });
  // Icons come from the file-type .ico files, not execPath: in dev that's
  // electron.exe, whose icon is Electron's atom.
  const launch = { isPackaged, appPath };
  categories.push({
    type: 'tasks',
    items: [
      {
        type: 'task',
        program: execPath,
        args: flagLaunchArgs(NEW_MARKDOWN_FLAG, launch),
        title: 'New Markdown Document',
        description: 'Create a new Markdown (.md) document in a new window',
        iconPath: path.win32.join(fileIconsDir, 'md.ico'),
        iconIndex: 0,
      },
      {
        type: 'task',
        program: execPath,
        args: flagLaunchArgs(NEW_MDZ_FLAG, launch),
        title: 'New MDZip Document',
        description: 'Create a new MDZip (.mdz) document in a new window',
        iconPath: path.win32.join(fileIconsDir, 'mdz.ico'),
        iconIndex: 0,
      },
      {
        type: 'task',
        program: execPath,
        args: newWindowLaunchArgs(launch),
        title: 'New Window',
        description: 'Open a new MDZip Studio window',
        iconPath: path.win32.join(fileIconsDir, 'mdz.ico'),
        iconIndex: 0,
      },
    ],
  });
  return categories;
}

// macOS: the paths to hand app.addRecentDocument, in call order. The last one
// added is the most recent and the renderer's list is newest-first, so reverse
// it. Same .md/.mdz-only, ten-entry rule as the Jump List.
function recentDocumentsForMac(recentPaths) {
  return (Array.isArray(recentPaths) ? recentPaths : [])
    .filter((p) => typeof p === 'string' && /\.(?:mdz|md)$/i.test(p))
    .slice(0, 10)
    .reverse();
}

module.exports = {
  recentDocumentsForMac,
  NEW_WINDOW_FLAG,
  NEW_MARKDOWN_FLAG,
  NEW_MDZ_FLAG,
  jumpListLaunchArgs,
  newWindowLaunchArgs,
  wantsNewWindow,
  startupActionFromArgs,
  jumpListIconFor,
  buildJumpList,
};
