# Known Issues

Known issues are tracked in GitHub Issues:

- [MDZip Studio issues](https://github.com/mdzip-project/mdzip-studio/issues)
- [MDZip Editor issues](https://github.com/mdzip-project/mdzip-editor/issues)

## Current Notes

- Raw HTML is not portable across all Markdown renderers. Studio preserves and
  renders safe HTML, but other apps may escape tags such as `<img>` or `<br>`.
  Prefer normal Markdown syntax when maximum portability matters.
- Some Studio fixes are currently host-side workarounds while upstream editor
  issues are tracked, including raw HTML image orphan detection, raw HTML tag
  editor styling, Mermaid error containment, table alignment/layout polish, and
  raw HTML image layout attributes.
- MDZip Studio 1.3.20 uses `@mdzip/editor` / `@mdzip/editor-ng` 1.3.12 from npm.
  Older Studio versions may render some raw HTML image layout differently.
- Printing from the print preview window involves two dialogs on Windows: the
  viewer's print dialog, then the Windows print dialog. The Windows dialog may
  say "This app doesn't support print preview" in its preview pane — this is
  cosmetic (desktop apps can't feed that pane a live preview); the preview is
  Studio's own preview window, and all print settings are honored. This
  double-step is an Electron platform limitation without a supported bypass.
  To skip all dialogs, press **Ctrl+P** in the preview window to send the
  document straight to the default printer.

## Reporting Issues

When reporting a problem, include:

- MDZip Studio version
- Operating system
- Whether the file is `.md` or `.mdz`
- Steps to reproduce
- A small sample document or archive when possible
