# mdzip-pandoc

A [Pandoc](https://pandoc.org) reader and writer for **MDZip** (`.mdz`) files: Markdown documents packaged with their images in one ZIP archive. With it, Pandoc converts an `.mdz` to Word, EPUB, PDF, HTML and every other format it writes, and packages any document it reads as an `.mdz`.

```sh
pandoc -f mdz.lua guide.mdz -o guide.docx          # .mdz to Word
pandoc -f mdz.lua guide.mdz -s --embed-resources -o guide.html
pandoc notes.md -t mdz.lua -o notes.mdz             # Markdown and its images to .mdz
pandoc report.docx -t mdz.lua -o report.mdz         # Word to .mdz, images included
```

It's one Lua file, `mdz.lua`, used as a Pandoc [custom reader and writer](https://pandoc.org/custom-readers.html). It needs Pandoc 3 and the [mdzip-core-lua](https://github.com/mdzip-project/mdzip-core-lua) library, which the release download includes.

## Setup

1. Download `mdzip-pandoc-<version>.zip` from the [latest release](https://github.com/mdzip-project/mdzip-pandoc/releases/latest) and unzip it. It holds `mdz.lua`, the two filters and a copy of mdzip-core-lua, so there's nothing else to install.
2. Pass the path of `mdz.lua` to `-f` or `-t`, for example `pandoc -f mdzip-pandoc-0.8.0/mdz.lua guide.mdz -o guide.docx`. Keep the `mdzip-core-lua` folder next to `mdz.lua`.

To use your own copy of mdzip-core-lua instead (a git checkout, or one installed with `luarocks install mdzip-core-lua`), set `MDZIP_LUA_PATH` to its `src` folder, or put the `mdzip-core-lua` folder next to `mdz.lua` or next to the folder `mdz.lua` is in.

Tested with Pandoc 3.13 (Lua 5.4).

## Reading an `.mdz`

- Pandoc converts the archive's **entry point**, the main document the archive names (or `index.md`), or the document you name in `MDZ_DOCUMENT`: see [Another document](#another-document). Links to the archive's other documents stay links.
- A document split over **several files** (a document-mode archive whose entry point links to its chapters) is converted as just the entry point, with a warning, unless you add `+combine`: see [Several files as one document](#several-files-as-one-document).
- A **project-mode** archive, a collection of separate documents, is converted one document at a time: the entry point, with a warning naming how many were left out, or the one you name. `+combine` makes the whole collection one file, each document a part of its own: see [A project as one file](#a-project-as-one-file).
- **Images** are read from inside the archive, never from the web or from files next to the archive, and go into Pandoc's media bag. So Word, EPUB and PDF output include them, and HTML does with `--embed-resources` (or `--extract-media`). This covers Markdown images and `<img>` tags in raw HTML, including ones in a document in a subfolder.
- The archive's **manifest** fills in metadata the document doesn't set itself: `title`, `author`, `lang`, `description`, `keywords` and `cover`. `cover` is the path of the manifest's cover picture in the media bag; in HTML, `mdz-images.lua` turns it into a link preview picture (see below).
- When the document starts with its title as a level-1 heading (`# Trip Notes`, with the title `Trip Notes`), that heading is left out: Pandoc shows the title as a title block above the document (Word's Title style, a web page's title header), so it would appear twice. A different first heading stays.
- A damaged or invalid archive stops Pandoc with the MDZip error code, for example `ERR_ENTRYPOINT_MISSING` or `ERR_ZIP_INVALID`.

The Markdown is read as CommonMark with Pandoc's extensions (`commonmark_x`), so it comes out the way MDZip Studio, VS Code and Obsidian show it: a list or heading right after a paragraph is a list or heading, heading identifiers are the ones editors link to (`## AGENTS.md` is `#agentsmd`), and an image on its own line stays an image, not a figure captioned with its alt text. Footnotes, definition lists, math, fenced divs and `{width=50%}` attributes still work. Add a switch to the format to change it:

| Switch | Effect |
|---|---|
| `-f mdz.lua+gfm` | Read GitHub-Flavored Markdown: bare URLs become links, `~text~` is strikethrough |
| `-f mdz.lua+pandoc` | Read Pandoc's Markdown (the default before 0.7.0): grid tables, figures with captions, citations |
| `-f mdz.lua-raw_html` | Drop raw HTML, event-handler attributes and `javascript:` links |
| `-f mdz.lua+combine` | Read the entry point and the documents it links to as one document (a project: every document, as a collection) |
| `-f mdz.lua+combine+orphans` | Also add the documents nothing links to (a project's collection always has them) |
| `-f mdz.lua+combine+pagebreaks` | Start each document on a new page |

Raw HTML in the archive passes through to HTML output, as it does with Pandoc's own readers. HTML that stands for something Markdown has no syntax for is read as that thing, so Word and PDF output keep it instead of dropping it: a `<table>` (merged cells, or headings and lists in cells), an `<img>` with a size, a `<figure>` with its caption, and `<u>`, `<sup>`, `<sub>`, `<mark>`, `<del>`, `<s>`, `<b>`, `<i>` and `<span class="mark">` or `"smallcaps"` around text. Pandoc's GFM and CommonMark writers write these as HTML, and so does `mdz.lua` with its switches on (see [Keeping the look, or plain Markdown](#keeping-the-look-or-plain-markdown)). For an `.mdz` from someone you don't trust, use `-raw_html`: it removes raw HTML, `on...` event-handler attributes (`{onclick="..."}`) and `javascript:`, `vbscript:` and `data:text/html` links, with any of the reading switches. (Pandoc's own CommonMark and GFM readers ignore `-raw_html`, a [known Pandoc issue](https://github.com/jgm/pandoc/issues/8305), so `mdz.lua` does it itself.) For HTML you publish, a sanitizer is still the safer choice.

### Another document

Set `MDZ_DOCUMENT` to a document's path in the archive to convert it instead of the entry point:

```sh
MDZ_DOCUMENT=chapters/install.md pandoc -f mdz.lua guide.mdz -o install.docx
```

In PowerShell, `$env:MDZ_DOCUMENT = "chapters/install.md"` first; in cmd, `set MDZ_DOCUMENT=chapters/install.md`. A path that names no Markdown document in the archive stops Pandoc with a list of the ones it has. With `+combine`, that document is where combining starts. (An environment variable because Pandoc gives a custom reader on/off switches, not values.)

### Several files as one document

```sh
pandoc -f mdz.lua+combine+pagebreaks guide.mdz -o guide.docx
```

With `+combine`, the entry point and every document it links to become one document, for a single Word file, PDF or EPUB. The spec allows this for document-mode archives (section 5.7.2); for a project-mode archive, see [A project as one file](#a-project-as-one-file).

- **Order:** the entry point, then each document in the order links to it first appear, following each one's own links before going on (depth-first). An entry point with a list of chapters sets the reading order. Each document appears once, however many links lead to it.
- **Documents nothing links to** are left out, with a warning naming them. Add `+orphans` to put them at the end, sorted by path.
- **Links** between the documents become links inside the result: `chapters/install.md#windows` points to that heading, and works in Word too. To keep identifiers apart, each document's headings get a prefix made from its path (`chapters-install--windows`), except in the entry point, whose identifiers stay as they are. Each document is wrapped in a section whose identifier is the prefix alone (`chapters-install`), with class `mdz-document`.
- **Images** are found relative to the document they're in.
- **`+pagebreaks`** starts each document after the first on a new page, in Word, PDF (LaTeX) and printed HTML. In Word you can get the same from a [reference document](https://pandoc.org/MANUAL.html#option--reference-doc) whose Heading 1 style starts a new page.
- **Metadata** comes from the entry point (and the manifest); front matter in the other documents is ignored.

### A project as one file

```sh
pandoc -f mdz.lua+combine+pagebreaks team-notes.mdz -o team-notes.docx
```

A project-mode archive is a set of separate documents, which the spec says mustn't be merged into one; it does allow one output that collects them, each kept a distinct part (section 5.7.3). With `+combine`, `mdz.lua` makes that collection: every document, each in its own section (class `mdz-document`), with links between them working inside the file as above.

- **Order:** the entry point (or the document named in `MDZ_DOCUMENT`) and the documents it links to, as above, then the ones nothing links to, sorted by path. No warning: they're all part of the project.
- **Metadata** comes from the manifest (the project's title, author and so on), not from the first document.

### Word styles carried in the `.mdz`

An `.mdz` can carry its own Word [reference document](https://pandoc.org/MANUAL.html#option--reference-doc), the file Pandoc takes Word's styles from: tables, headings, fonts, page size and margins, headers and footers. Name it in the manifest:

```json
"pandoc": { "referenceDoc": "styles/reference.docx" }
```

and write Word with `docx.lua`, Pandoc's own Word writer plus that reference document:

```sh
pandoc -f mdz.lua guide.mdz -t docx.lua -o guide.docx
```

- A Word template (`.dotx`) works as well as a `.docx`. Only its styles and page setup are used, as with any reference document: its text, and any macros, are not. The result is a normal `.docx`.
- `--reference-doc` on the command line overrides the one in the archive.
- The `pandoc` field is mdzip-pandoc's, not part of the MDZip spec. Other MDZip apps ignore it and keep it when they save (spec 6.3), and show the reference document as just another file.
- Pandoc's own Word writer (`-o guide.docx` without `-t docx.lua`) can't use it, because a reader can't set writer options. It also records the setting as a document property, `mdz-reference-doc`, in the Word file.
- The GitHub Action uses `docx.lua` whenever it turns an `.mdz` into Word.

[`examples/grid-tables.mdz`](examples/grid-tables.mdz) carries a reference document whose tables have grid lines and a grey header row. To make your own, start from Pandoc's (`pandoc -o reference.docx --print-default-data-file reference.docx`), change its styles in Word, and add it to the archive. [`examples/build.lua`](examples/build.lua) builds the example (`pandoc lua examples/build.lua`).

## Writing an `.mdz`

- The document becomes `index.md`, in GitHub-Flavored Markdown by default (`-t mdz.lua+pandoc` writes Pandoc's Markdown, `+commonmark` CommonMark).
- Every image Pandoc can find is packaged under `images/`, keeping its file name, and the document's links are rewritten to match. That includes images on disk, images Pandoc read out of a Word or EPUB file, and `data:` URIs. An image used twice is stored once; two different images with the same name get `-2`, `-3` and so on.
- Web images (`https:`) stay links. An image that can't be found stays as written, with a warning.
- The manifest records the title, the first author, `lang`, `description` and `keywords` from the document's metadata. The title is also added as a heading when the document has no level-1 heading, since Markdown output doesn't keep metadata.
- Pandoc has to write to a file: use `-o name.mdz`.
- A link inside a link, as in a Word table of contents, keeps the inner one's text: Markdown has no nested links.
- From Word, a picture sharing a line with a shape or another picture (a logo on a banner) is kept: Pandoc's Word reader would take only the first, so `mdz.lua` reads the file again with them apart. Shapes themselves aren't kept, but with `image_sizes` a picture drawn on a shape filled with a colour or gradient (a white logo on a blue banner) goes in a `<div>` with that fill behind it. A heading with only pictures in it becomes a paragraph.
- A picture with a caption becomes the picture with the caption as a paragraph under it (GFM and CommonMark have no figures).

The result passes `mdz validate`.

### Keeping the look, or plain Markdown

Some of what a document can have doesn't exist in Markdown. By default `mdz.lua` writes plain Markdown and leaves it out. Turn on any of these switches to keep it as HTML in the Markdown instead, so the `.mdz` looks more like the original and Word output (with `docx.lua`) gets it back. To keep all of it:

```sh
pandoc report.docx -t mdz.lua+image_sizes+html_tables+table_look+html_formatting -o report.mdz
```

MDZip Studio's Import turns all four on unless you turn them off, and shows the command it runs.

| Switch | On | Off (the default) |
|---|---|---|
| `image_sizes` | Pictures at the size the document shows them, as `<img style="width:…">`. From Word, older pictures (VML, from Word 2003 and earlier) too: Pandoc's Word reader ignores their size, so `mdz.lua` reads it from the `.docx`. A picture drawn on a filled shape keeps the fill behind it | Plain `![]()` images, shown at their own size |
| `html_tables` | Tables Markdown can't write (merged cells; headings, lists or several paragraphs in a cell) as HTML, as Pandoc writes them | Made into Markdown tables: each cell on one line (headings bold, list items joined with semicolons), a merged cell split into that cell and empty ones |
| `table_look` | From Word: shaded cells (`style="background-color:#CCCCCC"`, Word's patterns as the flat colour they look like), and the lines (`data-word-borders`) or Word table style (`data-word-style`) of tables that differ from most of the document's. Such a table is written as HTML. `docx.lua` puts them back | Nothing kept |
| `html_formatting` | Underline, superscript, subscript, small caps and highlight, as `<u>`, `<sup>` and so on | Plain text |

The lines most of a Word document's tables share aren't kept per table: they belong in the reference document's `Table` style (see [Word styles carried in the `.mdz`](#word-styles-carried-in-the-mdz)), so those tables stay Markdown tables when they can. MDZip Studio's Import makes such a reference document from the Word file.

### Conversion notes

`+notes` adds `sources/conversion-notes.md` to the archive, a note about the conversion that isn't part of the document:

- **Where it came from:** the original's file name (not its folder), kind, size and SHA-1; when it was converted (`SOURCE_DATE_EPOCH` if set), with which Pandoc and `mdz.lua`; which look switches were on.
- **What didn't come across**, from Word: comments (left out), tracked changes (accepted), shapes and text boxes, fields (TOC, PAGE: their last text, no longer updating), charts, SmartArt, embedded objects, several columns, headers and footers, macros. Each is listed only when the file has it.
- **What's in the archive:** the document, its tables and footnotes, and the pictures under `images/`.

```sh
pandoc report.docx -t mdz.lua+notes -o report.mdz
```

MDZip Studio's Import turns it on unless you turn it off, and adds what it did: the files it added and Pandoc's warnings.

## GitHub Action

The repository is also a GitHub Action. It installs Pandoc (unless the runner already has it), downloads mdzip-core-lua and runs `mdz.lua`, on one file or a whole folder. For example, to turn an `.mdz` into a web page:

```yaml
- uses: actions/checkout@v5
- uses: mdzip-project/mdzip-pandoc@v0
  with:
    input: docs/guide.mdz
    output: site/guide.html
    args: --standalone --embed-resources
```

Or a folder of `.mdz` pages into a website, each page put into your own [Pandoc template](https://pandoc.org/MANUAL.html#templates):

```yaml
- uses: mdzip-project/mdzip-pandoc@v0
  with:
    input: pages
    output: _site
    args: --standalone --embed-resources --template=site/template.html --css=site/style.css
```

[mdzip-pages-example](https://github.com/mdzip-project/mdzip-pages-example) is a whole site built this way and published on GitHub Pages, with a sitemap, canonical addresses and Open Graph tags. Its [template](https://github.com/mdzip-project/mdzip-pages-example/blob/main/site/template.html) shows how to use `page-url`. With `--embed-resources`, mark the canonical link `data-external="1"`, or Pandoc tries to download the page and embed it.

| Input | Default | What it does |
|---|---|---|
| `input` | | The file to convert. An `.mdz` is read with `mdz.lua`; any other file Pandoc reads (`.md`, `.docx`, ...) can be packaged as an `.mdz`. Or a folder: every `.mdz` in it and its subfolders is converted. |
| `output` | | The file to write. Its extension picks the format: `.html`, `.docx`, `.epub`, `.pdf` (needs a PDF engine on the runner), or `.mdz`. When `input` is a folder, the folder to write to, with the same subfolders. Missing folders are created. |
| `extension` | `html` | When `input` is a folder, the format to convert each `.mdz` to, as a file extension (`html`, `docx`, `epub`, ...). |
| `site-url` | | When a folder is converted to HTML: the address it's published at, such as `https://you.github.io/repo/`. The action then writes `sitemap.xml` (each page's address, with its last-changed date when there's git history) and `robots.txt`, and gives each page `page-url` (its full address) and `site-url` for its template. A top-level `404.mdz` is left out of the sitemap and gets no `page-url`. |
| `images` | `files` | For HTML made from an `.mdz`: `files` writes each picture once to an `images/` folder (next to the page, or at the top of `output` for a folder), named by its contents, and points the pages at it. `embed` leaves pictures to Pandoc: add `--embed-resources` to build them into each page. |
| `args` | | Extra Pandoc options, such as `--standalone --embed-resources` for self-contained HTML pages, `--template`, `--css` or `--toc`. They're split on spaces, so a value can't contain one. |
| `pandoc-version` | | Pandoc to install, 3.0 or later. Empty uses the runner's Pandoc if it has one, otherwise installs 3.13, the version this is tested with. |
| `core-lua-version` | `v0.1.0` | The mdzip-core-lua release to use. |

The `output` output is the path written. One of `input` and `output` must be an `.mdz`.

In HTML output, links between `.mdz` files become links between the pages made from them: `guide.mdz#install` becomes `guide.html#install`. The action does this with [`mdz-links.lua`](mdz-links.lua), a Pandoc filter you can also use on its own (`--lua-filter mdz-links.lua`). Links in raw HTML (`<a href="...">`) aren't changed.

Pictures in HTML output are files, not built into the page: [`mdz-images.lua`](mdz-images.lua), another filter, writes each picture from the archive to `images/<hash>.<ext>` and points the page at it. A picture used on several pages is stored once, and browsers download it once. It covers Markdown images and the `<img align="...">` tags MDZip Studio writes, which Pandoc's own `--extract-media` leaves pointing at the old place. It marks the tags `data-external="1"`, so `--embed-resources` still builds the style sheet into each page but leaves the pictures as files. On its own: `pandoc -f mdz.lua --lua-filter mdz-images.lua guide.mdz -s -o site/guide.html` writes `site/images/`.

The manifest's `cover` picture is published the same way, and the template gets two variables: `cover` (the picture's address from the page) and, when the page has a `page-url` (or `site-url`), `cover-url`, its full address. Link previews on social sites and chat apps need the full address, and most don't show SVG, so make the cover a PNG or JPEG, about 1200 × 630 pixels:

```html
$if(cover-url)$
  <meta property="og:image" content="$cover-url$">
  <meta name="twitter:card" content="summary_large_image">
$endif$
```

Pandoc is installed with the official [`pandoc/actions/setup`](https://github.com/pandoc/actions), whose Linux install is x64 only; on a runner it doesn't support, install Pandoc in an earlier step. To check archives before converting them, add [setup-mdz](https://github.com/mdzip-project/setup-mdz) and run `mdz validate`.

## Development

To try it by hand, follow the test script in [TESTING.md](TESTING.md). The automated tests:

```sh
PANDOC=pandoc pandoc lua tests/run.lua
```

The tests run real `pandoc` commands with `mdz.lua` and check the results with mdzip-core-lua: reading (metadata, images into Word and HTML, raw HTML images, switches, the spec's fixture archives and their error codes), writing (images, metadata, `mdz validate`), Word to `.mdz`, and an `.mdz` to `.mdz` round trip. They expect a checkout of mdzip-core-lua next to this repository (`../mdzip-core-lua`), or `MDZIP_LUA_PATH`, and use its test fixtures. CI runs them on Linux, macOS and Windows with the mdzip-core-lua release the action pins (`core-lua-version` in `action.yml`).

To build the release download yourself:

```sh
pandoc lua tools/bundle.lua      # writes dist/mdzip-pandoc-<version>.zip
```

Publishing a release runs the same script and attaches the ZIP. The release tag must match `VERSION` in `mdz.lua`.

## What's left to do

- A GitHub Action input for the reader switches, so the action can use `+combine`.
- Packaging local Markdown files the document links to, not only images.

## License

Apache License 2.0. See [LICENSE](LICENSE).
