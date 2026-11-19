// Help windows: a Studio window that shows one of Studio's own help documents,
// read-only, at a page and section. The renderer asks for one by name; only
// these names, help-page file names and plain heading ids get through.

// studio-help: the help pages (assets/help/help.mdz). known-issues and
// changelog: the documents the help dialog also shows.
const HELP_DOCUMENTS = Object.freeze(['studio-help', 'known-issues', 'changelog']);

// The startup action for that window, or null when the request isn't one of
// Studio's help documents. A page is a Markdown file at the archive's root; a
// heading id is lowercase letters, digits and hyphens (the slugs the MDZip
// renderer gives headings).
function helpStartupAction(payload) {
  const doc = payload?.doc;
  if (!HELP_DOCUMENTS.includes(doc)) return null;
  const page = typeof payload?.page === 'string' && /^[a-z0-9][a-z0-9-]{0,99}\.md$/.test(payload.page)
    ? payload.page
    : null;
  const anchor = typeof payload?.anchor === 'string' && /^[a-z0-9][a-z0-9-]{0,99}$/.test(payload.anchor)
    ? payload.anchor
    : null;
  return { kind: 'help', doc, page, anchor };
}

// After a window closes: true when only help windows are left, so they close
// too and Studio quits, rather than leaving help open with no way back to a
// Studio window. Not on macOS, where Studio keeps running with no windows and
// its Dock icon opens a new one.
function shouldCloseLeftoverHelp(remainingStates, platform) {
  if (platform === 'darwin' || remainingStates.length === 0) return false;
  return remainingStates.every((state) => state?.help);
}

module.exports = { HELP_DOCUMENTS, helpStartupAction, shouldCloseLeftoverHelp };
