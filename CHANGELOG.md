# Changelog

All notable changes to MDZip Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.8.0] - 2026-11-23

### Added
- **File → Import…** (#33) turns a Word document, PowerPoint presentation, Excel workbook, PDF (text only), web page, EPUB, OpenDocument, Rich Text, Jupyter notebook, LaTeX, reStructuredText or Org file into an `.mdz`, pictures included. It opens unsaved, so Save asks where to keep it (in a new window when one is already open here). It opens in View with the outline on the left, to read through what came across, and Studio remembers the outline that way. Studio uses the best program you have for each kind of file: Pandoc for Word and most others, markitdown-mdz for PowerPoint, Excel and PDF, or the other one when only it's installed; you can choose. Get them in **Help → System Integration…**.
- **File → Export…** (Ctrl+E, #41) saves the document as a Word document, PDF, a web page (one file, pictures inside), EPUB, OpenDocument, PowerPoint, Rich Text or LaTeX, unsaved changes included. For an `.mdz` with several pages, **Include the pages it links to** makes them one document (in Word, each starting on a new page); for a project, **Include all its documents** makes one file with each document a part of its own. Otherwise it exports the page you're viewing. Word uses the styles the document carries, if any. PDF is made by Studio from its own preview, as Print does, so it needs nothing installed; the other formats need Pandoc. **Open** and **Show in Folder** follow.
- **File → Insert Word Template** gives exported Word documents your own styles. It adds Pandoc's own Word styles to the `.mdz` as `styles/reference.docx` and names it in the manifest (`pandoc.referenceDoc`), so **Export… → Word document** uses it, for anyone who exports the document. Change its styles in Word (**Open in Word** on the file) and exports follow. The template is marked as current Word, so Word doesn't open it, or documents exported with it, in Compatibility Mode. It asks before replacing Word styles the document already has, and needs Pandoc. The help's new **Import and Export** page has the steps.
- **Import: keep the look, or plain Markdown.** Importing with Pandoc has a **Keep the look** group: **Picture sizes**, **Complex tables** (merged cells; headings, lists or paragraphs in a cell), **Table shading and lines** (Word: shaded cells, and tables lined differently from the rest, which Export as Word puts back) and **Underline, superscript and highlight**. Markdown can't write these, so they're kept as HTML: the document looks like the original but is harder to edit by hand. All on by default; turn them off for plain Markdown (tables simplified, pictures at their own size, plain text). The command shows the switches, and Studio remembers the choices. Help: Import and Export, Keeping the look. A Word table of contents also imports as working links now.
- **A document's own look: fonts, colours and table lines, in light and dark.** Importing a Word document has a third choice, **Show it with its fonts and colours** (on by default): its Normal text, headings, links, quotes and usual table (lines and header shading) become a stylesheet (with the font most of the text is set in, where that isn't its style's, as LibreOffice saves), `styles/style.css`, which the manifest names (`"styles": "styles/style.css"`, the one-file form of the styles proposal, mdzip-spec#19; Studio-only until the spec has it). Each colour gets a dark version (same hue, readable on the dark page); shaded table cells keep their colour with dark text. The preview, **File → Print** and PDF export use it; **View → Document Style** turns it off for every document. Any `.mdz` can name a stylesheet this way: Studio applies it only to the document's pages, and only with files inside the archive (`@import` and anything from the web or the disk are dropped). Help: Import and Export, The document's own look. For printing, its `@page` rules apply too, pictures from the archive included: a letterhead in the first page's top margin, a page number in the others'.
- **A Word template shows what it does.** `styles/reference.docx`, from an imported Word document or from **Insert Word Template**, opens in Word with a line of help and a sample of each style an export uses: title, headings, body text with bold, italic, code and a link, bulleted and numbered lists (nested), a quote, and a captioned table in its usual look, so there's something to look at while changing them. Pandoc uses only the styles, so the samples never reach an export.
- **Conversion notes.** Import has a **Conversion notes** choice (on by default, for any file, remembered) that adds `sources/conversion-notes.md` beside the document: where it came from (file name, size, checksum, when, with which program), and for a Word document imported with Pandoc, what didn't come across (comments, tracked changes, shapes, text boxes, fields, charts, headers and footers…, each only when it has them), written by mdz.lua's `+notes`. Studio adds its own part: the command it ran, the files the Import choices added and the program's warnings. Help: Import and Export, Conversion notes.
- **Print and Export as PDF show their progress, and no longer time out on long documents.** The copy Studio renders for printing only loaded the pictures near its top, so a long document with pictures further down never finished and failed after two minutes ("timed out rendering the document"). It now loads every picture (the editor's new `eagerImages`), and the status bar shows a progress bar, "Pictures 9 of 24", and **Cancel**. It gives up only when nothing has happened for a minute, however long the whole document takes.
- **Empty table rows are a full line tall,** in the preview, Print and PDF, as in Word: the blank rows of a revision log no longer collapse to thin strips.
- **Import's dialog opens without a wait.** Studio asked each program its version every time (markitdown-mdz takes over a second to answer); it now remembers the answer until the program is upgraded, and asks once in the background after Studio starts. **Help → System Integration…** shows every card at once, each with a spinner until its own check answers, so one slow program doesn't hold up the page.
- **Tables from Word fit the page.** Pandoc makes a Word table's first row its header whenever Word's table settings tick "header row" (the default), and the preview never wrapped header cells, so a first row with paragraphs in it ran off the page. With the document's own look, header cells wrap and look like a header only when the table's Word style makes them one.
- **Importing a Word document can keep its look and the original.** Import's dialog has two choices for a `.docx` or `.dotx`: **Use its styles when exporting to Word** (on by default) adds a copy with only its styles, page setup, headers and footers, and the look most of its tables have, such as grid lines (no text, comments or authors) as `styles/reference.docx`, named in the manifest, so Export as Word looks like the original; **Keep a copy of the original file** (off by default) adds it unchanged under `sources/`.
- **Export to Word keeps what Import wrote as HTML.** Markdown has no syntax for a picture's size, merged cells, headings in table cells, underline, superscript, subscript or highlight, so Import writes them as HTML, and exporting to Word or PDF left them out: every picture from an imported Word document was missing, and a document laid out as one table came out blank. They come through now, pictures at their size. Import also keeps a picture's caption, as a paragraph under it, and the size of pictures in older Word documents (a small logo used to come in huge).
- **Import and Export show their command.** Both dialogs show the exact Pandoc or markitdown-mdz command they run, with a Copy button, and it changes as you choose: run it yourself in a terminal, or put it in a script. Studio comes with mdzip-pandoc 0.8.0 (`mdz.lua`, `docx.lua`), which those commands use.
- **Uninstall helper programs.** Each installed program's card in System Integration has **Uninstall…**, which asks inside the card, shows the command, and then runs it in a terminal window with the same tool that installed it (winget, Homebrew, npm or pip). The card says what stays behind: the Mermaid CLI's copies of Chrome, and markitdown-mdz's MarkItDown and readers. When an Install, Update or Uninstall finishes in its terminal window, the dialog checks its cards again and says whether it worked; before, it still showed the old state until you clicked **Check Again**.
- **Portable or installed.** **Help → About** says which version of Studio is running on Windows: **Portable version** or **Installed** (also in the About dialog's debug information). In the portable version, System Integration starts with **Install MDZip Studio**, which says what the installed version adds (opening `.mdz` files from File Explorer, `.md` files, Explorer previews, downloading and installing a new version when you choose to). Where winget or Chocolatey is installed, its **Install** button installs Studio with it for all users, with Explorer integration, in a terminal window (winget first: `--scope machine`; Chocolatey as administrator); otherwise **Get the Installer** opens the Windows section of the download page. Once Studio is installed too, the card becomes **Installed version**, with **Open Installed Version**.
- **System Integration says what an install costs and needs.** Each program's card says roughly how much it downloads (Pandoc about 45 MB, markitdown-mdz about 115 MB with its readers, the Mermaid CLI about 750 MB of disk for its two copies of Chrome) and what it needs first (Python, Node.js). If what runs its install command is missing (Python, Node.js, winget or Homebrew), the card says "Needs Python first" and its button, **Get Python**, opens where to get it, instead of an **Install** that would fail in the terminal.
- **System Integration notices missing readers.** markitdown-mdz installed without MarkItDown's readers used to show as installed and the latest, and then failed to import a Word, PowerPoint or Excel file. Its card now says which kinds of file it can't read ("Installed, version 0.1.1, but can't read Word, PowerPoint and Excel files"), with **Add Readers**, which runs the install command with `[all]`. Needs markitdown-mdz 0.1.1, whose `--version` names the missing readers.
- **Help → System Integration…** (#11) shows how MDZip fits into your computer, with a button to fix what can be fixed. On Windows: whether Studio opens `.md` files, with a button to change it (on Windows 11 it opens MDZip Studio's page in **Settings → Apps → Default apps**, where you click `.md` and pick Studio; this replaces **Help → Set as Default for .md Files…**, which Windows 11 now refuses; when Studio isn't installed for all users with Explorer integration, Windows doesn't offer it for `.md`, so the dialog says so and links to the installer instead), whether File Explorer previews `.mdz` files and what to do if not (with **Turn Off for Me** and **Turn On**, which change it only for you, not for other people who use the computer), and whether classic Outlook blocks `.mdz` attachments, with **Allow .mdz** to let them through (and **Block Again**). Everywhere: the helper programs Import and Export use (Pandoc, Typst, rsvg-convert, Mermaid CLI, markitdown-mdz and the `mdz` command line), each with whether it's installed (including programs `pip install --user` puts outside PATH; markitdown-mdz installs with `[all]`, the readers it needs for Word, PowerPoint, Excel and PDF), its version and whether a newer one is out (asked of GitHub, npm or PyPI while the dialog is open), with **Install** and **Update** buttons that run winget, Homebrew, npm or pip in a terminal window you can watch.
- **View → Reading View** opens the document in its own window for reading, the way Studio's help reads: no menu or toolbar, and a strip whose title opens the contents, every page and its sections. For a project, the pages come in the order the entry page links to them. It shows the document as it is, unsaved changes included; choosing Reading View again brings that window forward, up to date. It closes with its editing window. As in a browser, pointing at a link to a website shows its address at the bottom left of the window (the help window too).
- **MDZip Studio Help** (Help menu, or F1) opens Studio's help in the help window: a contents page, **Getting Started** and **System Integration**, with links between them. Click the page title in the help strip for the contents: every page and its sections, one click to any of them (the archive's files are there too, on request). The help strip names the page you're on and links to it on mdzip.org, where the same pages are published. The help comes with Studio, so it describes this version and works offline. **Save a Copy…** at the bottom of the contents keeps the help, named for that version (`mdzip-studio-help-1.7.0.mdz`); Reading View has it too.
- **Context help:** the blue **(?)** after each System Integration card's title opens its section of the System Integration help page (another (?) brings the same window forward at that section). The page comes with Studio and describes this version; **View the latest online** opens it on mdzip.org. Help opens in a narrower help window of its own, at that section: titled "MDZip Studio Help", with a blue help strip (the version it describes and a link to the latest online) instead of the menu, toolbar and status bar, and the outline on the left, so you can read it next to what you're doing. **Help → Known Issues** and **Help → Change Log** open in help windows too (in the browser version, which can't open windows, in a dialog). Help windows close with the last Studio window (except on macOS, where Studio keeps running).
- **Open in Word, with the changes coming back** (#29). A file in the document, such as `styles/reference.docx`, has **Open in <app>** (the app Windows opens that kind of file with, named) and **Open With…** on its card and its right-click menu. The app gets a copy; each time you save there, the change comes back into the document, which you then save. The card says the file is open elsewhere; if the file also changed in the document meanwhile, Studio asks which version to keep. Changes stop coming back when the document closes or another opens; a read-only document's copy never comes back. Word templates (`.dotx`) open for editing, not as a new document from them. Programs and scripts (`.exe`, `.bat`, `.ps1`, …) aren't offered and are refused.
- **Files the preview can't show** (a Word document, a spreadsheet, a ZIP) show as a card with what the file is, **Extract…** and **Replace…** buttons, a line on what each does, and a link to the new **Other kinds of files** section of Getting Started, instead of "Binary file preview unavailable".
- **After Extract…, Open and Show in Folder.** The status bar's "Extracted to …" has **Open** and **Show in Folder** links, as Export has (**Open Folder** when several files went into a folder).
- **Open works with Word.** Export's **Open**, and **Open** after Extract…, did nothing for a Word document on Windows: Word takes the file over DDE, which Electron's way of opening files cut off. Studio now opens files the way a double-click does.
- **Extract files from a document.** Select files in the contents pane (Ctrl+click, Shift+click, Ctrl+A) or right-click a folder, and choose **Extract…**. One file is saved where you choose; several files or a folder go into a folder you pick, keeping their folders, and Studio asks before replacing files that are already there. The document isn't changed.
- **Outline panel.** A table of contents beside the preview: the toolbar's outline button puts it on the left, then on the right, then hides it (its icon shows the side, and its tooltip says what the next click does); a click goes to a section, and the section you're reading is marked. Drag its edge to make it wider. **View → Outline on the Left** also switches sides, and its check mark follows the button. Studio remembers whether it's open, its side and its width (`@mdzip/editor` 2.5.0).
- **Edit the manifest as a form or as JSON** (#43). `manifest.json` opens as **Document properties** (title, description, author, keywords, language, license, document version, and under Advanced the entry point and mode); Edit shows its JSON, which you can now change, including fields of your own. Problems are marked as you type, and a manifest with errors can't be saved: Save says so and shows it. This replaces Studio's own Settings/JSON manifest view.
- **Find in View** searches the rendered document without opening the source, and in Split the source now stays level with the preview block by block (`@mdzip/editor` 2.5.0).

## [1.7.0] - 2026-11-07

### Added
- **MDZip Studio for macOS.** One `.dmg` runs natively on Apple Silicon and Intel Macs (macOS 12 or later). The app isn't signed by Apple, so the first launch needs **System Settings → Privacy & Security → Open Anyway**; the README has the steps.
- **Homebrew:** `brew install --cask mdzip-project/mdzip/mdzip-studio`, upgrade with `brew upgrade --cask mdzip-studio`.
- On Mac, `.mdz` files open in Studio by double-click and show the MDZip document icon in Finder. Studio is offered under **Open With** for `.md` files without taking over as their default.
- Mac menus: an **MDZip Studio** app menu (About, Check for Updates, Hide, Quit), a **Window** menu, **Reveal in Finder**, and `⌘` shortcuts in menus and tooltips. The menu follows the focused window.
- Mac Dock: open files by dropping them on the Dock icon; the Dock menu has **New Markdown Document**, **New MDZip Document** and **New Window**, and recent documents.
- **Check for Updates on Mac** downloads the new `.dmg` to Downloads and opens it, for you to drag the new app to Applications. Homebrew installs are told to run `brew upgrade --cask mdzip-studio` instead.

### Not on Mac yet
- The Explorer preview pane has no Quick Look counterpart, and **Make default Markdown editor** is Windows-only (use Finder's **Get Info → Open with → Change All…**).

## [1.6.1] - 2026-11-02

### Fixed
- **Right-aligned text stays right-aligned in the preview.** Content inside an HTML wrapper such as `<div align="right">` could show on the left in a long document, because the preview drew it in chunks and split the wrapper. The "Me" messages in Google Voice exports, for example, now sit on the right (`@mdzip/editor` 2.4.1).
- **The front matter table no longer shows up a second time while you type.** In a long document with front matter, typing made a copy of the table appear under the heading you were editing. Editing the front matter itself now updates the table, which used to keep the old values (`@mdzip/editor` 2.4.2).
- **Image syntax shown as an example in an HTML table or `<pre>` is no longer reported as a missing image** (`@mdzip/core-js` 2.2.1).
- **Inserting `AGENTS.md` or `README.md` marks the document unsaved** (#28). The new file could be lost by closing the document or opening another one without a prompt. Converting a Markdown file to MDZip now marks it unsaved too, and an undo no longer clears the unsaved mark after either.
- **File Explorer previews show SVG images**, such as the letter avatars in Google Voice exports. Scripts in a previewed document now run in an isolated frame.
- **The installer no longer looks stuck while it sets up File Explorer previews** (#21). Its header says when it is downloading and installing the .NET 10 Desktop Runtime and that the install can take several minutes. It shows download progress in its details, retries a stalled download, and waits for another installation that's still running (for example one left behind by a closed installer) instead of failing. If the download or the install fails, it offers **Retry**.

### Changed
- Uses `@mdzip/editor` 2.4.2 and `@mdzip/core-js` 2.2.1. Links in SVG diagrams, such as draw.io `.drawio.svg` files, can be clicked, and a `.drawio` image shows a card that explains how to display the diagram instead of a broken image.

## [1.6.0] - 2026-10-16

### Added
- **Portable version**: `MDZip-Studio-<version>-portable.exe`, a single `.exe` that runs without installing and keeps its settings in a **MDZip Studio Data** folder beside it. It doesn't register file types or the Explorer preview, and **Check for Updates** offers the download page instead of installing.
- **View → Load Remote Images** (on by default). Images from `https://` URLs in documents load only while it's checked; turning it off stops documents from telling remote servers they were opened. The choice is saved in `settings.json` in Studio's user-data folder (studio#13).
- The editor toolbar's **color scheme** menu (Light, Dark, System) and new **page width** menu (Narrow, Default, Wide, Full Width). Studio remembers both choices in the same `settings.json`; each window opens with them. System, the default, follows Windows' light/dark setting live.
- The preview's right-click menu has **Copy** and **Copy All** submenus by format (Plain Text, Formatted Text, HTML, and Markdown for the whole document) and **Select All**. Ctrl+A selects the rendered document; Ctrl+A, Ctrl+C copies all of it as formatted text with images embedded, for Word or email.

### Fixed
- **Large documents show their images within seconds.** The preview now renders in chunks near what's on screen, as in VS Code. Before, Studio built the whole document first; on a large chat export (a Google Voice archive with about 15,000 images) the text appeared quickly but images stayed blank for minutes.
- **Plain `http://` images are no longer loaded** in documents, following MDZip spec 1.2.0 §9.2. Images inside an archive (and `data:` images) are unaffected.

### Changed
- Uses `@mdzip/editor` 2.2.0 and Mermaid 12: ER diagrams and flowcharts use the ELK layout (right-angle lines), switching light/dark keeps the preview in place, and footnotes and task list checkboxes render (see the editor's 2.1.0 and 2.2.0 changelogs). Studio's own code that pushed Windows' light/dark changes into the editor is gone: the editor follows Windows itself, and no longer overrides a Light or Dark choice when Windows changes.
- Uses `@mdzip/core-js` 2.0.1 (MDZip spec 1.2.0). Saved archives always contain a `manifest.json` with `spec.version`, `title`, `entryPoint` and `mode`, and keep unknown manifest fields and untouched files byte-for-byte. Paths inside an archive are case-sensitive: `![](Images/Logo.png)` no longer shows `images/logo.png`, and the orphaned-image markers follow the same rule. Renaming a file to a different case of its own name now works.

## [1.5.1] - 2026-10-08

### Fixed

- **Nested lists weren't indented in the preview.** Second- and third-level
  bullets and numbered items sat flush with their parent (they only changed
  marker), and top-level bullets hung at the pane's edge. Lists now indent
  per level as in VS Code and on GitHub (#27).

## [1.5.0] - 2026-10-07

### Added

- **File location actions**: File menu items **Copy File Path** and
  **Copy Folder Path**, and the full path as a tooltip on
  the title bar's document name.
- **Linked images in `.md`** now open the same insert dialog a `.mdz` gets — Markdown or HTML, alt text, size and alignment. Cancelling writes nothing (#24).
- **Open Recent** entries now show the folder after the file name
  (`notes.mdz — F:\Docs`), shortened in the middle when long.
- **Front matter** — a leading `---` YAML block now renders as front matter
  in the preview instead of a stray rule plus heading.
- **Heading links** — every heading gets a GitHub-style anchor, so
  `[text](#some-heading)` links (and `other.md#heading`) scroll the preview
  to the target, and it stays on target while images or diagrams above it
  are still loading.

### Changed

- **`@mdzip/editor` / `@mdzip/editor-ng` updated from 1.4.0 to 1.5.0.** Most
  of the entries above and below come from it. Editing is lighter: Mermaid
  diagrams and images no longer re-render on every keystroke in short
  documents, and fenced code in an uncommon language renders unhighlighted
  rather than loading every highlighter.

### Fixed

- **Saving a `.mdz` jumped back to the entry-point document** when you were
  editing another `.md` file inside it. Save now leaves you where you were.
- **Editor and preview jumping scroll position** when starting to edit a
  document with images or a Mermaid diagram.
- **A Mermaid diagram failing to render** ("Cannot read properties of null")
  after an edit that re-rendered the preview twice in quick succession, such
  as adding an image.
- **The status bar keeps showing "Viewing <file>" for the file you're on**
  when you open another file in a `.mdz`. The updated editor no longer
  reports plain navigation as an archive change, so the status bar now
  follows the selection instead.
- **Clicking a preview link with malformed percent-encoding** (e.g.
  `bad%E0%A4%A.md`) threw an error. It's now treated as an unresolved link.

- **Every keystroke causing a brief visible flash** (toolbar
  disappearing/reappearing, scrollbar jumping to the title bar) while
  editing. Studio's global `html`/`body` had `height: 100%` but no
  `overflow: hidden`; since every layout ancestor down to `.app-shell` is
  already a fixed `100vh` with `overflow: hidden`, the document itself
  should never need to scroll — but without that constraint, any transient
  internal content overflow (even for a single frame) made the browser
  show a native document scrollbar, narrowing and reflowing the entire app
  for that instant. Added `overflow: hidden` to `html`/`body` and to the
  app's `:host`.

- **Shift+Right-Click for spell-check suggestions did nothing.** Electron
  builds no context menu on its own, and the embedded editor's own
  right-click handler unconditionally suppressed the native one it would
  otherwise fall through to (its own bug, fixed in `@mdzip/editor` 1.4.5 —
  see its CHANGELOG; `@mdzip/editor`/`-ng` bumped to `^1.4.5`). Added a `context-menu` handler on
  each window that builds a native menu from Chromium's own spelling
  suggestions (plus cut/copy/paste) whenever something actionable is
  actually there. Closes #22.

- **File > Open Document... (and Open Recent) replaced the current
  document instead of opening alongside it**, even though Studio already
  supports multiple windows. Both now open in a new window when the
  requesting window already has a document open; a "New" empty window still
  loads in place, since there's nothing to lose. Also added a native "Open
  Recent" submenu (previously only reachable from the empty welcome
  screen), so recent files are reachable without closing what's open. The
  Windows taskbar Jump List also gets "New Markdown Document", "New MDZip
  Document" and "New Window" tasks, since clicking the app's own entry there
  only focused the running window. Closes #23.

## [1.4.0] - 2026-09-10

The first published release since 1.3.21. Rolls up the Linux packaging and
release-pipeline work that was tagged as 1.3.22 and 1.3.23 but never published.

### Added

- **Linux packaging** — `electron-builder` now produces a `.deb` package and an
  AppImage for x64 alongside the Windows installer (`npm run build` on Linux).
  The `.deb` registers a `.mdz` file association (MIME type
  `application/vnd.mdzip`, per the spec) so double-clicking an archive opens
  Studio; the Windows-only shell preview handler is excluded from non-Windows
  builds. (mdzip-studio#9)
- **CI release pipeline** — pushing a `v*` tag now builds Windows **and** Linux
  in GitHub Actions and uploads every artifact (`.exe`/`.deb`/`.AppImage` plus
  the `latest*.yml` update feeds and blockmap) to a draft GitHub release for
  review before publishing. See `RELEASE_CHECKLIST.md`. (mdzip-studio#9)
- **Background update check** — Studio now checks for a newer release shortly
  after launch and every few hours after that. Nothing downloads or installs on
  its own; when an update is found the Help menu gets a "•" and its
  "Check for Updates..." entry becomes "Download Update (x.y.z)...". "Up to
  date" and connection errors from the background check are silent — only a
  check you start from the menu reports those. (mdzip-studio#17)
- **Document stats in the status bar** — word, character, and line counts, plus
  reading time past a minute, for the open Markdown document; live as you type.
  Hidden for the manifest panel and on a narrow window. (mdzip-studio#16)
- **Title from the file name** — opening an empty `.md` with a real, chosen name
  (e.g. `weekly-report.md` created in the file manager) seeds a `# Weekly Report`
  heading so you don't start on a blank page. Studio's own default names and
  repo meta files (`README.md`, `index.md`, …) stay blank; the seeded heading
  counts as an unsaved change until you save. (mdzip-studio#18) The same applies
  when a document-mode `.mdz` archive's entry-point document is still empty —
  the heading is seeded from the archive's file name. (mdzip-studio#19)

### Changed

- **New Document no longer prompts for a name.** `File > New` (and the
  welcome-screen buttons) create an untitled document immediately; the name and
  location are chosen at the first Save, via the existing Save As dialog — the
  way most editors handle "Untitled". (mdzip-studio#15)
- The `@mdzip/core-js`, `@mdzip/editor`, and `@mdzip/editor-ng` dependencies are
  now the published npm releases (`^1.5.0` / `^1.4.0`) instead of local `.tgz`
  paths, so the project builds from a clean checkout. The About dialog now
  reports the versions actually shipped.
- Releasing no longer auto-increments the patch version on every `npm run build`.
  The version changes only via `npm version <patch|minor|major>`, which also
  tags the release; `prebuild` just syncs `src/app/app-version.ts` to whatever
  is in `package.json`.

### Fixed

- **Linux: first launch could open no window.** The window is created hidden and
  shown on `ready-to-show`, which on Linux (X11/XWayland, software GPU) can fail
  to fire for the first window — the app was running but invisible, so the first
  launch looked like nothing happened and a second launch was needed. It now
  also reveals on `did-finish-load` with a timeout backstop.
- **Closing a window or quitting no longer discards unsaved work silently.**
  Clicking a window's close button, or quitting the app, now runs the same
  Save / Don't Save / Cancel prompt as `File > Close` for each window that has
  unsaved changes — a Cancel on any of them aborts the quit with every window
  still open. (mdzip-studio#8)
- The document passed by a Linux `.desktop` launcher (a `file://` URI) is now
  resolved to a real path on open, matching the Windows/macOS association
  behaviour.
- Linux/macOS builds no longer crash on an OS theme change — the window icon is
  a PNG there instead of the Windows-only `.ico` (which Electron can't load
  outside Windows, throwing from the `nativeTheme` handler).
- Removed an invalid `linux.syncDesktopName` key from the `electron-builder`
  config that made `electron-builder` reject the whole configuration on any
  Linux build (the option was dropped in electron-builder 25; desktop-file
  naming is handled automatically now).

## [1.3.21] - 2026-07-08

### Added

- **Find & Replace in the editor (Ctrl/Cmd+F)** — the search panel from
  `@mdzip/editor` 1.3.15, with a toolbar search button. Works in edit and
  read-only viewing alike; opening search from preview mode switches to a
  layout with the source visible.
- Added **File -> Print... (Ctrl+P)** in the desktop app. It opens a paginated
  print preview of the open document (rendered light, with images and Mermaid
  diagrams included), from which you can print via the system dialog or save a
  PDF. For `.mdz` archives it prints the document entry currently being viewed.
  Unsaved edits are included, the same as Save.
- The print preview window has a small **Print** menu: **Quick Print to
  Default Printer (Ctrl+P)** sends the document straight to the default
  printer with no further dialogs, and **Close Preview (Ctrl+W)** closes the
  preview (instead of falling through to the main window and closing the
  document).
- The manifest.json view (formerly "Document Internals") is now titled
  **Manifest** and has two tabs: the **Settings** form and a read-only
  **JSON** tab showing the manifest as it will be saved, pretty-printed with
  greyscale syntax highlighting.

### Fixed

- Images referenced only by raw HTML `<img>` tags no longer show as orphaned
  in the contents pane when it is first opened, and images referenced from a
  different document than the open one are no longer flagged either.
- The manifest Settings form no longer shows stale values after an edit when
  the manifest entry is reopened.

### Changed

- Updated the embedded MDZip editor libraries to the published
  `@mdzip/editor` / `@mdzip/editor-ng` **1.3.15** (from npm rather than local
  packages): find/replace search, raw HTML tag muting in the source pane,
  image layout attributes for raw HTML `<img>`, table alignment fixes, and
  contained Mermaid error rendering.

## [1.3.20] - 2026-06-22

### Added

- Added **File -> Unpack .mdz to Folder...** in the desktop app. It writes an
  archive into a normal folder using the archive-relative paths, so regular
  Markdown editors can open the unpacked `.md` files with local image links
  intact.
- Added **Help -> Known Issues** and **Help -> Change Log** views inside the
  app. The help viewer loads the current GitHub copy when available and falls
  back to bundled files when offline.
- Added a **View -> Line Numbers** toggle for the hosted editor.
- Added a design note for a possible future standalone Markdown Hints effort:
  portable Markdown comments carrying optional presentation hints, with MDZip
  Studio as a possible early testbed.

### Changed

- Updated the embedded MDZip editor libraries to `@mdzip/editor` /
  `@mdzip/editor-ng` 1.3.12.
- Tightened Studio's table preview behavior so ordinary Markdown tables use the
  available width, honor Markdown alignment markers, and avoid wrapping short
  right-aligned values such as prices.
- Raw HTML image layout in Studio preview now honors native `width`, `height`,
  and `align` attributes directly, instead of depending on Studio-specific
  source markup.

### Fixed

- Mermaid syntax errors no longer leave Mermaid's own large error SVGs stuck in
  the app layout after the source is edited or removed.
- Raw HTML image references such as `<img src="images/logo.svg">` are now
  accounted for when Studio corrects the navigation pane's orphaned-asset
  indicators.
- Raw HTML tags in the source editor now get the same muted styling treatment
  as existing `<br>` markers.
- Save As for a converted Markdown document now suggests the original Markdown
  folder instead of starting from a less helpful default location.
- OS-requested document opens, reloads, and dirty-state prompts now handle
  unsaved work more consistently.

## [1.3.19] - 2026-06-18

### Added

- The status bar now makes the open document's format clear: a format icon
  (document for Markdown `.md`, archive for MDZip `.mdz`) plus a clearer label —
  `Viewing/Editing <file>.md` for Markdown, and
  `Viewing/Editing <entry> (<file>.mdz)` for an MDZip archive (so it's obvious
  you're viewing one entry of a bundle).
- Recent files now show Markdown/MDZip file-type icons for faster scanning.

### Changed

- The native **File** menu now hides its document-only items (Save, Save As,
  Show in File Manager, Close Document) when no document is open, instead of
  showing them greyed — Electron's native menu has no clear disabled styling, so
  they looked enabled until hovered.
- Updates are no longer automatic. The app no longer checks for or downloads
  updates on startup, and nothing installs on its own. Use **Help → Check for
  Updates…** to check; if one is found you confirm the download, then choose
  when to restart and install. This keeps a release from reaching users before
  it's been vetted.

### Fixed

- Typing in a Markdown (`.md`) document that references images was laggy: the
  preview inlined each image as a multi-megabyte `data:` URI and re-emitted them
  on every keystroke, so the browser rebuilt a huge preview and re-decoded every
  image each time. The preview now references stable `blob:` object URLs
  (decoded once and reused); the data-URI cache is kept only for embedding
  images on conversion/save.
- Relative images in Markdown (`.md`) previews now keep working with that fast
  blob-backed preview path, including when the editor's progressive image
  placeholder removes the original relative `src` before extension mounting.

## [1.3.18] - 2026-06-17

### Fixed

- The "unsaved changes" prompt on Close / New / Open now also fires for a
  document that was converted, packed, or created but never written to disk —
  previously it only triggered after edits, so closing a just-converted `.mdz`
  discarded it without warning.
- The native **File** menu's document-only items (Save, Save As, Close
  Document, Show in File Manager) are now disabled on the welcome screen when no
  document is open.

## [1.3.17] - 2026-06-17

### Fixed

- Saving a plain Markdown (`.md`) file was slow: every save rebuilt a full
  `.mdz` archive — reading and compressing all referenced images — only to
  discard it when keeping the `.md` format. The archive is now built only when
  you Save As to `.mdz`; an in-place `.md` save just writes the text.

## [1.3.16] - 2026-06-17

### Fixed

- Opening a Markdown (`.md`) file flagged it as having unsaved changes (Save
  enabled and dotted) even though nothing was edited, because the file's on-disk
  path wasn't recorded. Opening a `.md` now records its path, so it isn't
  flagged unsaved and **Save** writes back to the same file instead of prompting
  Save As.

## [1.3.15] - 2026-06-17

### Fixed

- A freshly opened document could show the Save button's "unsaved" dot even
  though nothing had changed. The unsaved-edits state wasn't reset on load, so
  it could carry over from the previously open document; it's now synced from
  the editor whenever a document loads.

## [1.3.14] - 2026-06-17

### Fixed

- Auto-update could detect a new version but failed to download it with HTTP
  404. The installer file name in `latest.yml` used hyphens while the asset
  uploaded to GitHub had spaces converted to dots, so the two never matched.
  Installer artifacts are now built without spaces
  (`MDZip-Studio-Setup-<version>.exe`), so the update feed and the uploaded
  asset names line up.

## [1.3.13] - 2026-06-17

### Fixed

- The Save button stayed disabled for a document that only lives in memory and
  has never been written to disk — a new document, a packed folder, or a `.md`
  just converted to `.mdz` — even though the status bar said to save it. Save is
  now enabled (and dotted) whenever there are unsaved edits *or* the document
  isn't on disk yet. (Ctrl+S and File → Save were never affected.)

## [1.3.12] - 2026-06-17

### Changed

- **Help → Check for Updates…** now reports its result in a dialog ("You're up
  to date", an update was found, or an error) instead of a native notification,
  so the outcome is always visible. The silent startup check still uses
  notifications.

## [1.3.11] - 2026-06-17

### Fixed

- The packaged Windows app failed to launch with "Cannot find module
  'electron-updater'" — no runtime dependencies were being bundled into the
  app. The build now ships `electron-updater` (the only runtime dependency) in
  the package; the renderer libraries remain bundled by the Angular build.

## [1.3.10] - 2026-06-17

### Added

- Automatic updates via `electron-updater`: a silent check runs shortly after
  launch, and **Help → Check for Updates...** triggers one on demand. Updates
  download in the background and install on restart, with native OS
  notifications for "update available", "update ready", "up to date", and
  errors. Updates are delivered from this repo's GitHub Releases.
- The Save button now reflects unsaved state: it is disabled when there is
  nothing to save and shows a dot when you have unsaved edits.
- A prompt to save (or discard) unsaved edits when closing, creating, or
  opening a document.
- A "Saving…" status message while a save is in progress.
- **Show in File Manager** to reveal the saved document on disk.
- Convert a Markdown document to an MDZip archive (with a confirmation
  dialog), embedding the document's relative images so the archive is
  self-contained.
- Relative images referenced by a Markdown document now render in the preview.

### Fixed

- Preview images no longer re-run their reveal animation (fade/slide) on every
  keystroke while editing.

## [1.3.0] - 2026-06-16

### Added

- Pack-a-folder workflow and recent-file management.

### Changed

- Reworked the GitHub release process and checklist.

## [0.1.14] - 2026-06-14

### Added

- First public release: create, view, edit, and validate MDZip archives, with
  Markdown editor/preview, asset browser, and manifest editing.

[Unreleased]: https://github.com/mdzip-project/mdzip-studio/compare/v1.8.0...HEAD
[1.8.0]: https://github.com/mdzip-project/mdzip-studio/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/mdzip-project/mdzip-studio/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/mdzip-project/mdzip-studio/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/mdzip-project/mdzip-studio/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/mdzip-project/mdzip-studio/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/mdzip-project/mdzip-studio/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.21...v1.4.0
[1.3.21]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.20...v1.3.21
[1.3.20]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.19...v1.3.20
[1.3.19]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.18...v1.3.19
[1.3.18]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.17...v1.3.18
[1.3.17]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.16...v1.3.17
[1.3.16]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.15...v1.3.16
[1.3.15]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.14...v1.3.15
[1.3.14]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.13...v1.3.14
[1.3.13]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.12...v1.3.13
[1.3.12]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.11...v1.3.12
[1.3.11]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.10...v1.3.11
[1.3.10]: https://github.com/mdzip-project/mdzip-studio/compare/v1.3.0...v1.3.10
[1.3.0]: https://github.com/mdzip-project/mdzip-studio/compare/v0.1.14...v1.3.0
[0.1.14]: https://github.com/mdzip-project/mdzip-studio/releases/tag/v0.1.14
