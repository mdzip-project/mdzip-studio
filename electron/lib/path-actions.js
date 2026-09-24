const path = require('path');

// Copy actions for the current document's location. Electron-free: the
// clipboard and fs.access come in as deps so this is unit-testable.
//   copy-path    → full path of the file
//   copy-folder  → full path of the containing folder
// Errors: 'no-path', 'unknown-action', 'not-found'.
async function runPathAction({ filePath, action }, { clipboard, access }) {
  if (!filePath || typeof filePath !== 'string') return { error: 'no-path' };
  if (!['copy-path', 'copy-folder'].includes(action)) return { error: 'unknown-action' };

  const resolved = path.resolve(filePath);
  const folder = path.dirname(resolved);
  try {
    await access(action === 'copy-path' ? resolved : folder);
  } catch {
    return { error: 'not-found' };
  }

  if (action === 'copy-path') {
    clipboard.writeText(resolved);
    return { ok: true, text: resolved };
  }
  clipboard.writeText(folder);
  return { ok: true, text: folder };
}

module.exports = { runPathAction };
