// A document has "changed" if either its modification time or its size moved
// since we last looked — cheap enough to check on every save, and (combined
// with a directory watch) on every external fs event too.
function statsDiffer(previous, next) {
  if (!previous || !next) return previous !== next;
  return previous.mtimeMs !== next.mtimeMs || previous.size !== next.size;
}

module.exports = { statsDiffer };
