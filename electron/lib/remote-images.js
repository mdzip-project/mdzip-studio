const fs = require('fs');

// Remote images in documents (MDZip spec 1.2.0 §9.2). Fetching one tells its
// server the document was opened, so users can turn it off; plain http: is never
// loaded. Electron-free so it's unit-testable; main.js wires it to
// session.webRequest and the View menu.

const DEFAULT_SETTINGS = Object.freeze({ remoteImages: true });

// Whether an image request may go ahead. `appOrigin` is the origin the UI itself
// loads from (the dev server, e.g. http://localhost:4300); its own images are
// never blocked. file:, data: and blob: images never reach here (main.js only
// filters http/https), but they're allowed anyway.
function allowImageRequest(url, { remoteImages, appOrigin = null }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (appOrigin && parsed.origin === appOrigin) return true;
  if (parsed.protocol === 'https:') return remoteImages;
  if (parsed.protocol === 'http:') return false;
  return true;
}

// Settings live in a small JSON file in userData, read once at startup. A
// missing or unreadable file gives the defaults; unknown keys are kept so later
// settings (studio#13) can share the file.
function loadSettings(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        remoteImages: typeof parsed.remoteImages === 'boolean' ? parsed.remoteImages : DEFAULT_SETTINGS.remoteImages,
      };
    }
  } catch {
    // Fall through to the defaults.
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(file, settings) {
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

module.exports = { DEFAULT_SETTINGS, allowImageRequest, loadSettings, saveSettings };
