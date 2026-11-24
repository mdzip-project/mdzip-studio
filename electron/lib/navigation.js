// What a Studio window does with a link that would navigate it (will-navigate)
// or open a new window (target="_blank"). Electron-free, so it's unit-testable;
// main.js applies it.
//
// A window only ever shows Studio's own page. A web or mail link opens in the
// browser or mail app; anything else is dropped. A document's relative links
// resolve against Studio's page (file://…/dist/…), not the document, so they
// lead nowhere useful; and a file: link from a document must never reach
// shell.openExternal, which would open the file with whatever the system
// opens it with, a program included.

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

// 'stay' (Studio's own page again, as on a reload or an in-page #anchor),
// 'external' (open with the system), or 'drop'.
function navigationAction(url, currentUrl) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return 'drop';
  }
  if (currentUrl && withoutHash(url) === withoutHash(currentUrl)) return 'stay';
  // Elsewhere on Studio's own server (development: http://localhost:4300/maps/…):
  // a relative link from a document, as for file: above.
  if (currentUrl && sameWebOrigin(target, currentUrl)) return 'drop';
  return EXTERNAL_SCHEMES.has(target.protocol) ? 'external' : 'drop';
}

function sameWebOrigin(target, currentUrl) {
  try {
    return target.protocol.startsWith('http') && target.origin === new URL(currentUrl).origin;
  } catch {
    return false;
  }
}

function withoutHash(url) {
  const index = String(url).indexOf('#');
  return index >= 0 ? String(url).slice(0, index) : String(url);
}

module.exports = { navigationAction };
