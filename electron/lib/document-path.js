const path = require('path');

function documentPathFromArgs(args) {
  const candidate = args.find((arg) =>
    typeof arg === 'string' && /\.(?:mdz|md)$/i.test(arg) && !arg.startsWith('--')
  );
  if (!candidate) return null;
  // Linux .desktop launchers pass the opened file as a file:// URI (%U); the
  // Windows/macOS association paths pass a plain filesystem path.
  if (/^file:\/\//i.test(candidate)) {
    // Parse by hand rather than fileURLToPath(): the URI form only comes from
    // the Linux launcher, so a POSIX path is always the right reading — but
    // fileURLToPath() throws on a driveless path when Node runs on Windows
    // (e.g. a dev running the tests there).
    try {
      const decoded = decodeURIComponent(new URL(candidate).pathname);
      // A Windows drive-letter URI ("file:///C:/x") decodes to "/C:/x".
      if (/^\/[a-zA-Z]:[/\\]/.test(decoded)) {
        return path.win32.normalize(decoded.slice(1));
      }
      // A UNC host ("file://server/share/x") is dropped here — fileURLToPath()
      // would keep it as "\\server\\share\\x". Harmless: the Linux launcher is
      // the only source of this branch and SMB mounts surface as POSIX paths.
      return decoded;
    } catch {
      return null;
    }
  }
  return path.resolve(candidate);
}

module.exports = { documentPathFromArgs };
