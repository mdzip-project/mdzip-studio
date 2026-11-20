// Reader windows (View > Reading View): a document from its editing
// window, as it is at that moment (unsaved edits included), read-only, with
// the contents dropdown and no menu or toolbar. One per editing window; it
// closes with it.

// The snapshot the editing window sent, checked: its bytes, a plain .mdz or
// .md file name, and a title for the strip. Null when it isn't one.
function readerSnapshot(payload) {
  const bytes = payload?.bytes;
  if (!ArrayBuffer.isView(bytes)) return null;
  const fileName = payload.fileName;
  if (typeof fileName !== 'string' || fileName.length > 255 || /[\\/\0]/.test(fileName)
    || !/\.(mdz|md|markdown)$/i.test(fileName)) {
    return null;
  }
  // A new .md document can be empty; an .mdz never is.
  if (bytes.byteLength === 0 && /\.mdz$/i.test(fileName)) return null;
  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim().slice(0, 200)
    : fileName.replace(/\.(mdz|md|markdown)$/i, '');
  return { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), fileName, title };
}

// The save dialog's file types for Save a Copy: only the copy's own kind,
// since its bytes are written as they are (no .md to .mdz conversion).
function saveCopyFilters(fileName) {
  const extension = (/\.([^.]+)$/.exec(fileName)?.[1] ?? '').toLowerCase();
  const kind = extension === 'mdz'
    ? { name: 'MDZip Documents', extensions: ['mdz'] }
    : { name: 'Markdown Files', extensions: [extension || 'md'] };
  return [kind, { name: 'All Files', extensions: ['*'] }];
}

// After a window closes: true when only reading windows (help, readers) are
// left, so they close too and Studio quits, rather than leaving one open with
// no way back to a Studio window. Not on macOS, where Studio keeps running
// with no windows and its Dock icon opens a new one.
function shouldCloseLeftoverReaders(remainingStates, platform) {
  if (platform === 'darwin' || remainingStates.length === 0) return false;
  return remainingStates.every((state) => state?.help || state?.reader);
}

module.exports = { readerSnapshot, saveCopyFilters, shouldCloseLeftoverReaders };
