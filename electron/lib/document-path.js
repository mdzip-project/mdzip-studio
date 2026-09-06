const path = require('path');
const { fileURLToPath } = require('url');

function documentPathFromArgs(args) {
  const candidate = args.find((arg) =>
    typeof arg === 'string' && /\.(?:mdz|md)$/i.test(arg) && !arg.startsWith('--')
  );
  if (!candidate) return null;
  // Linux .desktop launchers pass the opened file as a file:// URI (%U); the
  // Windows/macOS association paths pass a plain filesystem path.
  if (/^file:\/\//i.test(candidate)) {
    try {
      return fileURLToPath(candidate);
    } catch {
      return null;
    }
  }
  return path.resolve(candidate);
}

module.exports = { documentPathFromArgs };
