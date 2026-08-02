const path = require('path');

// Build the relaunch arguments for a Jump List item. A packaged build's
// execPath IS the app, so the file path alone suffices; in dev, execPath is
// electron.exe and needs the app directory before the file argument.
function jumpListLaunchArgs(filePath, { isPackaged, appPath }) {
  const quotedFile = `"${filePath}"`;
  return isPackaged ? quotedFile : `"${appPath}" ${quotedFile}`;
}

function jumpListIconFor(filePath, fileIconsDir) {
  const iconFile = /\.md$/i.test(filePath) ? 'md.ico' : 'mdz.ico';
  return { iconPath: path.join(fileIconsDir, iconFile), iconIndex: 0 };
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
      title: path.basename(p),
      description: p,
      // Per-type document icon instead of the program's (electron.exe) icon.
      ...jumpListIconFor(p, fileIconsDir),
    }));
  return items.length ? [{ type: 'custom', name: 'Recent', items }] : null;
}

module.exports = { jumpListLaunchArgs, jumpListIconFor, buildJumpList };
