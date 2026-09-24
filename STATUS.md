Status: awaiting-test
Last: Linked .md images use the editor's Markdown/HTML dialog (#24; on published @mdzip/editor / editor-ng 1.4.6); earlier: Open Recent entries show the folder; added Copy File Path / Copy Folder Path (File menu, native menu) and a path tooltip on the title; earlier: Fixed #22 (Shift+Right-Click spell-check) and #23 (Open Document/Recent replacing the current window)

## Spell-check context menu (#22) and Open Document/Recent in a new window (#23)

Both closed a real, previously-open bug rather than adding new scope:

- **#22**: Electron never builds a context menu on its own. Added a
  `context-menu` handler in `createWindow` (`electron/main.js`) that pops a
  native menu from `params.dictionarySuggestions`/`misspelledWord` (plus
  cut/copy/paste), only when there's something actionable. This alone did
  nothing for the editor pane, though — `@mdzip/editor`'s own right-click
  handler unconditionally called `preventDefault()`, with no `shiftKey`
  escape hatch despite its own disabled "Spelling Suggestions" menu item
  advertising "Shift+Right-Click" since a 1.3.13-era commit. Fixed there too
  (see `../mdzip-editor/STATUS.md`), released in 1.4.5; this repo's pin is
  now `^1.4.5` from the registry.
- **#23**: `openFilePicker()`/`openRecent()` (`app.component.ts`) now open
  in a new window via two new fire-and-forget IPC calls
  (`openDocumentInNewWindow`, `openPathInNewWindow`) when the requesting
  window already has a document open, reusing the same `pendingOpenPath`/
  `openDialogOnReady` delivery a double-click or Jump List launch already
  uses — an empty window still loads in place. Also added a native "Open
  Recent" submenu (`electron/lib/menu.js`), rebuilt on every window
  whenever the recent-files list changes, so recent files are reachable
  without returning to the empty welcome screen. (The issue's third
  concern — Jump List always focusing an existing window — was half true:
  recent-file entries already open a new window via `openOrFocus`'s per-path
  `findWindowForPath` check, but the app's own taskbar entry has no file and
  just focuses. Added Jump List tasks (`jump-list.js`): New Markdown
  Document (`--new-md`), New MDZip Document (`--new-mdz`) and New Window
  (`--new-window`). The `second-instance` handler in `main.js` (and the first
  launch, when Studio isn't running yet) opens a fresh window for them. New
  windows get a `startupAction` the renderer *pulls* on init
  (`mdzip:take-startup-action`) — this also replaced the earlier pushed
  "open dialog" event, which could arrive before Angular had registered a
  listener. Checked in real Electron: `setJumpList` returns `ok`, and each
  flag reaches the running instance and parses to the right action. Not yet
  seen end to end in the running app.)

Verified: `menu.test.js` covers the new "Open Recent" submenu (placeholder
when empty, base-name labels, 10-entry cap, wired to `openRecentPath`,
available regardless of `documentOpen`); `app.component.test.ts` covers
both `openFilePicker`/`openRecent` routing to a new window instead of
prompting to discard. Full suite green: 86 `ng test` (+2) + 45 `vitest`
electron (+4).

Kyle reported every keystroke causing a visible flash — toolbar
disappearing/reappearing, scrollbar briefly jumping to the title bar —
after hooking Studio up to the local `@mdzip/editor` dev symlink to test
its editor/preview scroll-jump fix (see `../mdzip-editor/STATUS.md`). This
took an extended live-debugging session across both repos to pin down;
three real bugs surfaced and were fixed in `@mdzip/editor` along the way
(see its STATUS.md) but none of them were the actual cause of what Kyle
was seeing — each made the underlying chunk-rendering pipeline more
correct, but the flash persisted after every one of them.

The actual root cause: Studio's global `html, body` had `height: 100%` but
no `overflow: hidden`. `.app-shell` is a fixed `100vh` with `overflow:
hidden` all the way down its own layout tree, so the document should never
need to scroll — but without that constraint, any transient internal
content overflow (even for a single frame, from any of the DOM churn the
`@mdzip/editor` fixes were addressing) made the browser show a native
document scrollbar, narrowing and reflowing the *entire app* for that
instant. Found via frame-by-frame analysis of a screen recording Kyle
provided: a measurable width-reflow (a table row in the editor pane
wrapping to a second line, then back) at the exact moment Kyle reported
seeing the flash, with the outer page's own scrollbar the only remaining
explanation once every internal-pane mechanism had been fixed and
independently verified.

Fixed with `overflow: hidden` on `html, body` (`styles.scss`) and on
`:host` (`app.component.scss`, belt-and-suspenders alongside the same
`.app-shell` invariant). Also removed `[progressiveTextRendering]="true"`
from the live editor's `<mdzip-workspace>` binding, added earlier under a
mistaken diagnosis — eager mounting (the default) is simpler and doesn't
carry the same lazy-tail complexity, with no observed downside for
Studio's typical document sizes.

Verified: Kyle confirmed live in Studio the flash is gone. Full suite (84
`ng test` + 41 `vitest` electron) green throughout.

`@mdzip/editor`/`@mdzip/editor-ng` were on a local dev symlink throughout
this investigation. Pins are now `^1.4.5` (1.4.4 carried this fix plus
#43/#45/#46; 1.4.5 adds the #22 Shift+Right-Click fix and the duplicated-tail
fix), installed from the registry with no symlinks, `.angular/cache` cleared,
and the full suite re-run clean (86 `ng test` + 45 `vitest` electron).

<!-- Status: idle | in-progress | awaiting-test | ready-to-commit | blocked -->
