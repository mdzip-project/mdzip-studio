const fs = require('fs');

// Remote images in documents (MDZip spec 1.2.0 §9.2). Fetching one tells its
// server the document was opened, so users can turn it off; plain http: is never
// loaded. Electron-free so it's unit-testable; main.js wires it to
// session.webRequest and the View menu.

const DEFAULT_SETTINGS = Object.freeze({
  remoteImages: true,
  colorScheme: 'system',
  previewWidth: 'default',
  outlineVisible: false,
  outlinePosition: 'right',
  outlineWidth: null,
  documentStyles: true,
});

// The editor's own choices Studio remembers: the color scheme and page width
// menus, and the outline panel (shown or not, its side, the width it was
// dragged to); and View > Document Style (a document's own stylesheet, on or
// off). Each window starts with the saved values.
const VIEW_SETTING_VALUES = Object.freeze({
  colorScheme: Object.freeze(['light', 'dark', 'system']),
  previewWidth: Object.freeze(['narrow', 'default', 'wide', 'full']),
  outlineVisible: Object.freeze([true, false]),
  outlinePosition: Object.freeze(['left', 'right']),
  documentStyles: Object.freeze([true, false]),
});

// The editor keeps a dragged outline between 160px and half the window; this
// only keeps out nonsense.
function isValidOutlineWidth(value) {
  return Number.isInteger(value) && value >= 100 && value <= 4000;
}

function isValidViewSetting(key, value) {
  if (key === 'outlineWidth') return isValidOutlineWidth(value);
  return Object.prototype.hasOwnProperty.call(VIEW_SETTING_VALUES, key) && VIEW_SETTING_VALUES[key].includes(value);
}

// The view settings a window starts with.
function viewSettingsOf(settings) {
  const { colorScheme, previewWidth, outlineVisible, outlinePosition, outlineWidth, documentStyles } = settings;
  return { colorScheme, previewWidth, outlineVisible, outlinePosition, outlineWidth, documentStyles };
}

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
        colorScheme: isValidViewSetting('colorScheme', parsed.colorScheme) ? parsed.colorScheme : DEFAULT_SETTINGS.colorScheme,
        previewWidth: isValidViewSetting('previewWidth', parsed.previewWidth) ? parsed.previewWidth : DEFAULT_SETTINGS.previewWidth,
        outlineVisible: isValidViewSetting('outlineVisible', parsed.outlineVisible) ? parsed.outlineVisible : DEFAULT_SETTINGS.outlineVisible,
        outlinePosition: isValidViewSetting('outlinePosition', parsed.outlinePosition) ? parsed.outlinePosition : DEFAULT_SETTINGS.outlinePosition,
        outlineWidth: isValidViewSetting('outlineWidth', parsed.outlineWidth) ? parsed.outlineWidth : DEFAULT_SETTINGS.outlineWidth,
        documentStyles: isValidViewSetting('documentStyles', parsed.documentStyles) ? parsed.documentStyles : DEFAULT_SETTINGS.documentStyles,
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

module.exports = { DEFAULT_SETTINGS, allowImageRequest, isValidViewSetting, loadSettings, saveSettings, viewSettingsOf };
