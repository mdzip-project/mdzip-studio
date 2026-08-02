const path = require('path');

// Resolve an archive-relative path back to an absolute path inside the picked
// folder, refusing anything that escapes it.
function resolveInsidePackFolder(root, rel) {
  const abs = path.resolve(root, rel);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error(`Refusing to read outside the selected folder: "${rel}".`);
  }
  return abs;
}

module.exports = { resolveInsidePackFolder };
