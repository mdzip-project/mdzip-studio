# Changelog

## [0.8.0] - Unreleased

- Reading another document: set `MDZ_DOCUMENT` to its path in the archive (`chapters/install.md`) to convert it instead of the entry point, in either mode; with `+combine`, combining starts there. A path that names no Markdown document stops Pandoc with a list of the ones the archive has.
- Reading a project-mode archive with `+combine` makes it one collection: every document, each in a section of its own, linked ones first and then the rest by path, with links between them working and the manifest's title and metadata. MDZip spec 5.7.3 now allows such an output. Without `+combine`, the warning about the documents left out says how to get them.

## [0.7.0] - 2026-11-18

- Reading: Markdown is read as CommonMark with Pandoc's extensions (`commonmark_x`) by default, the way MDZip editors show it, instead of Pandoc's Markdown. Compared on 52 real archives: lists and headings right after a paragraph are no longer merged into it, heading identifiers match the editors' (`#agentsmd`, not `#agents.md`), images on their own line are no longer turned into figures captioned with their alt text (visible captions in Word), and `@name` is no longer read as a citation. `+pandoc` reads Pandoc's Markdown as before.
- Reading with `-raw_html` now removes raw HTML with every reading switch: Pandoc's CommonMark and GFM readers ignore `-raw_html`, so `-f mdz.lua+gfm-raw_html` used to keep `<script>`. It also removes `on...` event-handler attributes and `javascript:`, `vbscript:` and `data:text/html` links, and with `+pandoc` the attributes of `<div>` and `<span>` tags.

## [0.6.0] - 2026-11-17

- Release download: `mdzip-pandoc-<version>.zip` holds `mdz.lua`, `mdz-links.lua`, `mdz-images.lua` and a copy of mdzip-core-lua, so `mdz.lua` works without a separate checkout of the core. Built by `tools/bundle.lua` and attached to each release by a workflow.
- CI: the end-to-end tests run on Linux, macOS and Windows with Pandoc 3.13 and the pinned mdzip-core-lua, and check that the release download works on its own.
- Reading: `+combine` reads a document split over several files as one document: the entry point, then the documents it links to, depth-first in link order. Links between them become internal links, identifiers get a per-document prefix, and images resolve against their own document. `+orphans` adds the documents nothing links to; `+pagebreaks` starts each document on a new page (Word, LaTeX, HTML). Project-mode archives aren't combined.
- `docx.lua`, a Word writer: Pandoc's own, plus the Word reference document (`.docx` or `.dotx`) the archive names in its manifest under `"pandoc": { "referenceDoc": ... }`, an mdzip-pandoc field. The GitHub Action uses it for `.mdz` to Word. Example: `examples/grid-tables.mdz`, with grid lines in its tables.
- Reading a document-mode archive with more than one document, without `+combine`, warns that only the entry point is converted.
- `mdz.lua` reports its version as 0.6.0 in the manifests it writes (it said 0.1.0 since the first release).

## [0.5.0] - 2026-11-12

- Reading: the manifest's `cover` picture goes into the media bag and the
  `cover` metadata field. A `cover` that names no file in the archive is
  ignored with a warning (spec 6.2).
- `mdz-images.lua` publishes the cover to `images/<hash>.<ext>` like the
  other pictures and, when the page has a `page-url` (or `site-url`), sets
  `cover-url` to its full address, for an `og:image` tag in the template.

## [0.4.0] - 2026-11-12

- `mdz-images.lua`, a Pandoc filter: in HTML output, each picture from the
  archive is written once to `images/<hash>.<ext>` and the page points to it,
  for Markdown images and for `<img>`/`<source>` tags in raw HTML (which
  `--extract-media` doesn't update). Tags are marked `data-external="1"` so
  `--embed-resources` leaves them as files.
- GitHub Action: new `images` input. `files` (the default) applies
  `mdz-images.lua`, with one shared `images/` folder when converting a folder;
  `embed` keeps the old behaviour, where `--embed-resources` builds pictures
  into each page.

## [0.3.0] - 2026-11-12

- GitHub Action: new `site-url` input. When a folder is converted to HTML,
  the action writes `sitemap.xml` (with each page's last-changed date from
  git) and `robots.txt`, and passes each page its address as `page-url`
  (and `site-url`) for canonical links and Open Graph tags in the template.

## [0.2.0] - 2026-11-12

- GitHub Action: `input` can be a folder. Every `.mdz` in it and its
  subfolders is converted into `output`, keeping the subfolders, to the
  format named by the new `extension` input (`html` by default).
- `mdz-links.lua`, a Pandoc filter: in HTML output, links to other `.mdz`
  files point to the pages made from them (`guide.mdz#install` becomes
  `guide.html#install`). The action applies it whenever it reads an `.mdz`.

## [0.1.0] - 2026-11-12

First version: `mdz.lua`, a Pandoc 3 custom reader and writer on mdzip-core-lua.

- Reading converts the entry point, loads its images (Markdown and raw HTML)
  from the archive into the media bag, and fills in metadata from the manifest.
  Project-mode archives convert their entry point with a warning. Errors carry
  MDZip error codes. Switches: `+gfm`, `+commonmark`, `-raw_html`.
- Writing packages the document as `index.md` (GFM by default; `+pandoc`,
  `+commonmark`) with every image Pandoc can find under `images/`, and records
  title, author, language, description and keywords in the manifest.
- Writing without `-o` stops with a message instead of printing the ZIP to
  the terminal.
- GitHub Action (`action.yml`): converts one file to or from `.mdz` in a
  workflow. Installs Pandoc if needed (official `pandoc/actions/setup`),
  downloads a pinned mdzip-core-lua release, and runs `mdz.lua`.
