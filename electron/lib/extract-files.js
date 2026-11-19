const fs = require('fs/promises');
const path = require('path');

// The editor's contents pane "Extract…" (mdzip-editor#69): the editor hands
// Studio `{ files: [{ path, bytes }], selection }` and Studio writes them.
// Electron-free so it's unit-testable; main.js adds the dialogs.

// One file picked on its own goes through a Save dialog under its own name;
// anything else (several files, a folder, the whole archive) goes into a
// folder the user picks, with the archive paths kept.
function planExtract(request) {
  const files = Array.isArray(request?.files) ? request.files : [];
  const selection = request?.selection ?? {};
  const pickedFolders = Array.isArray(selection.folders) ? selection.folders : [];
  if (files.length === 1 && pickedFolders.length === 0) {
    return { kind: 'file', fileName: path.posix.basename(String(files[0].path ?? '')) || 'file' };
  }
  return { kind: 'folder' };
}

// An archive path resolved inside `root`, refusing empty, `.`/`..` segments and
// anything that would land outside it.
function resolveInsideFolder(root, rel) {
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

// The archive paths that would replace a file already in `root`.
async function existingTargets(root, files) {
  const existing = [];
  for (const file of files) {
    try {
      await fs.access(resolveInsideFolder(root, file.path));
      existing.push(file.path);
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }
  return existing;
}

// Writes every file under `root` at its archive path. All paths are checked
// before anything is written.
async function writeFilesInto(root, files) {
  const targets = files.map((file) => ({ abs: resolveInsideFolder(root, file.path), bytes: file.bytes }));
  for (const { abs, bytes } of targets) {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.from(bytes ?? []));
  }
  return targets.length;
}

module.exports = { planExtract, resolveInsideFolder, existingTargets, writeFilesInto };
