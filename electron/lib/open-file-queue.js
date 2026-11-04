const { documentPathFromArgs } = require('./document-path');

// macOS delivers files through the 'open-file' event, which can fire before the
// app is ready. This holds those paths until main.js drains them into its
// open handler; after that, pushes go straight through. Only .md/.mdz paths
// are kept (same rule as launch arguments).
function createOpenFileQueue() {
  let pending = [];
  let handler = null;

  function push(filePath) {
    const docPath = documentPathFromArgs([filePath]);
    if (!docPath) return false;
    if (handler) handler(docPath);
    else pending.push(docPath);
    return true;
  }

  // Hand every queued path to fn in arrival order, then send later pushes to it.
  function drain(fn) {
    handler = fn;
    const queued = pending;
    pending = [];
    for (const docPath of queued) fn(docPath);
  }

  return { push, drain, pendingCount: () => pending.length };
}

module.exports = { createOpenFileQueue };
