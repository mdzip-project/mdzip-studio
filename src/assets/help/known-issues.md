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

## Reporting Issues

When reporting a problem, include:

- MDZip Studio version
- Operating system
- Whether the file is `.md` or `.mdz`
- Steps to reproduce
- A small sample document or archive when possible
