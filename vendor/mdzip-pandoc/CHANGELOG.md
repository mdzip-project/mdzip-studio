# Changelog

## [0.8.0] - 2026-11-23

- Reading another document: set `MDZ_DOCUMENT` to its path in the archive (`chapters/install.md`) to convert it instead of the entry point, in either mode; with `+combine`, combining starts there. A path that names no Markdown document stops Pandoc with a list of the ones the archive has.
- Reading a project-mode archive with `+combine` makes it one collection: every document, each in a section of its own, linked ones first and then the rest by path, with links between them working and the manifest's title and metadata. Section 5.7.3 of the MDZip spec now allows such an output. Without `+combine`, the warning about the documents left out says how to get them.
- Reading: HTML that stands for something GFM and CommonMark have no syntax for is read as that thing, so Word and PDF output keep it. Pandoc's writers, `mdz.lua`'s included, write these as HTML, and Word and PDF output dropped them: every picture from a Word document (each has a size, so it's an `<img>`), a table with merged cells or with headings and lists in its cells (a Word document laid out as one such table exported blank), a `<figure>`, and underline, superscript, subscript, highlight, small caps and strikethrough tags around text. A picture's size in its `style` becomes its width and height. Other HTML is left as it was, and `-raw_html` still drops it all.
- Writing: a picture with a caption keeps the caption, as a paragraph under the picture; it used to be dropped.
- Writing gives plain Markdown by default. Switches keep, as HTML, what Markdown can't write: `image_sizes` (pictures' sizes), `html_tables` (tables with merged cells or block content; without it they're made into Markdown tables), `table_look` (from Word: shaded cells, and the lines or Word table style of tables that differ from most of the document's) and `html_formatting` (underline, superscript, subscript, small caps, highlight). **Changed:** earlier versions kept sizes, such tables and such formatting as HTML; add `+image_sizes+html_tables+html_formatting` for that (`-t mdz.lua+image_sizes+html_tables+table_look+html_formatting` keeps everything).
- `docx.lua` puts back a table's look kept in an `.mdz`'s HTML: cell colours (`style="background-color:…"`), and table lines (`data-word-borders`) or a Word table style (`data-word-style`), which Pandoc's Word writer ignores.
- Writing: a link inside a link (a Word table of contents: each entry and its page number link to the heading) keeps the inner one's text. Markdown has no nested links, so each entry used to show as `[text](#target)`.
- Writing from Word: a picture that shares a run with a shape or another picture (a logo drawn on a banner) is no longer lost. Pandoc's Word reader keeps only a run's first drawing, so `mdz.lua` splits such runs and reads the file again. A heading with only pictures in it becomes a paragraph. With `image_sizes`, the shape's colour or gradient goes behind the picture, so a white logo isn't white on white.
- Reading: a document that starts with its title as a heading no longer shows the title twice (a title block, then the same heading). The heading is left out, so a Word document with a title block comes back from `.mdz` with one.
- Writing: `+notes` adds `sources/conversion-notes.md`: where the document came from (the original's name, size and SHA-1, when and with what it was converted, the switches) and, from Word, what didn't come across: comments, tracked changes (accepted), shapes, text boxes, fields, charts, SmartArt, embedded objects, columns, headers and footers, macros, each only when the file has it.
- Writing: a picture's `srcset` (an EPUB's `logo-2x.png 2x, logo.png 1x`) points into the archive too, or is dropped if any of its pictures can't be found, so the picture shows. Only `src` used to be rewritten, and a browser shows `srcset` in preference, so an EPUB's pictures showed broken. Pandoc's EPUB reader loads only the `src` pictures, so from an EPUB the `srcset` is always dropped.
- Writing from a Word file: pictures stored the older way (VML, as in documents from Word 2003 and earlier) keep the size the document shows them at. Pandoc's Word reader ignores it, so they came out at their pixel size: a small logo, huge. `mdz.lua` reads the sizes from the input file itself.

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
