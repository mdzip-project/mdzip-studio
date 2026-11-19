// Help > Open in New Window: a new Studio window that shows one of Studio's
// own help documents, read-only, scrolled to a section. The renderer asks for
// it by name; only these names, and plain heading ids, get through.

const HELP_DOCUMENTS = Object.freeze(['known-issues', 'changelog', 'system-integration']);

// The startup action for that window, or null when the request isn't one of
// Studio's help documents. A heading id is lowercase letters, digits and
// hyphens (the slugs the MDZip renderer gives headings).
function helpStartupAction(payload) {
  const doc = payload?.doc;
  if (!HELP_DOCUMENTS.includes(doc)) return null;
  const anchor = typeof payload?.anchor === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(payload.anchor)
    ? payload.anchor
    : null;
  return { kind: 'help', doc, anchor };
}

module.exports = { HELP_DOCUMENTS, helpStartupAction };
