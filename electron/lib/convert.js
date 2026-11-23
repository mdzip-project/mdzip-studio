// File > Import... and File > Export... (studio#33, studio#41): which program
// converts what, the arguments it gets, and the command line shown in the
// dialogs (so you can run the same thing yourself). Electron-free, so it's
// unit-testable; main.js runs the programs.
//
// The programs are the ones System Integration finds: Pandoc (with
// mdzip-pandoc's mdz.lua and docx.lua, shipped with Studio) and markitdown-mdz.
const path = require('path');

// What Import reads, by file extension, with the programs that can read each,
// best first: Pandoc keeps Word's structure (tables, footnotes, headings)
// better; only markitdown-mdz reads PowerPoint, Excel and PDF.
const IMPORT_FORMATS = Object.freeze([
  { id: 'docx', name: 'Word document', extensions: ['docx'], tools: ['pandoc', 'markitdown-mdz'] },
  { id: 'pptx', name: 'PowerPoint presentation', extensions: ['pptx'], tools: ['markitdown-mdz'] },
  { id: 'xlsx', name: 'Excel workbook', extensions: ['xlsx', 'xls'], tools: ['markitdown-mdz'] },
  { id: 'pdf', name: 'PDF (text only)', extensions: ['pdf'], tools: ['markitdown-mdz'] },
  { id: 'odt', name: 'OpenDocument text', extensions: ['odt'], tools: ['pandoc'] },
  { id: 'epub', name: 'EPUB book', extensions: ['epub'], tools: ['pandoc', 'markitdown-mdz'] },
  { id: 'html', name: 'Web page', extensions: ['html', 'htm'], tools: ['pandoc', 'markitdown-mdz'] },
  { id: 'rtf', name: 'Rich Text', extensions: ['rtf'], tools: ['pandoc'] },
  { id: 'ipynb', name: 'Jupyter notebook', extensions: ['ipynb'], tools: ['pandoc', 'markitdown-mdz'] },
  { id: 'tex', name: 'LaTeX', extensions: ['tex'], tools: ['pandoc'] },
  { id: 'rst', name: 'reStructuredText', extensions: ['rst'], tools: ['pandoc'] },
  { id: 'org', name: 'Org mode', extensions: ['org'], tools: ['pandoc'] },
]);

// What Export writes. `pagebreaks`: start each linked document on a new page
// when they're combined (paged formats only). PDF is made by Studio itself,
// from its own preview (the same as Print), so it matches what you see and
// needs no PDF engine; `equivalent` is the Pandoc command that does much the
// same from a terminal, shown for reference.
const EXPORT_FORMATS = Object.freeze([
  { id: 'docx', name: 'Word document', extension: 'docx', tool: 'pandoc', writer: 'docx.lua', pagebreaks: true },
  { id: 'pdf', name: 'PDF', extension: 'pdf', tool: 'studio', pagebreaks: true, equivalent: ['--pdf-engine=typst'] },
  { id: 'html', name: 'Web page (one file)', extension: 'html', tool: 'pandoc', args: ['--standalone', '--embed-resources'] },
  { id: 'epub', name: 'EPUB book', extension: 'epub', tool: 'pandoc' },
  { id: 'odt', name: 'OpenDocument text', extension: 'odt', tool: 'pandoc', pagebreaks: true },
  { id: 'pptx', name: 'PowerPoint presentation', extension: 'pptx', tool: 'pandoc' },
  { id: 'rtf', name: 'Rich Text', extension: 'rtf', tool: 'pandoc', args: ['--standalone'] },
  { id: 'tex', name: 'LaTeX', extension: 'tex', tool: 'pandoc', args: ['--standalone'] },
]);

const TOOL_NAMES = Object.freeze({ pandoc: 'Pandoc', 'markitdown-mdz': 'markitdown-mdz', studio: 'MDZip Studio' });

function extensionOf(filePath) {
  return path.extname(String(filePath ?? '')).slice(1).toLowerCase();
}

function importFormatFor(filePath) {
  const extension = extensionOf(filePath);
  return IMPORT_FORMATS.find((format) => format.extensions.includes(extension)) ?? null;
}

function exportFormat(id) {
  return EXPORT_FORMATS.find((format) => format.id === id) ?? null;
}

// The open dialog's filters: everything importable first, then each kind.
function importDialogFilters() {
  const all = IMPORT_FORMATS.flatMap((format) => format.extensions);
  return [
    { name: 'Documents Studio can import', extensions: all },
    ...IMPORT_FORMATS.map((format) => ({ name: format.name, extensions: format.extensions })),
  ];
}

// Whether a program System Integration reported ({ installed, version }) can
// do the job: mdz.lua needs Pandoc 3 or newer.
function toolUsable(id, status) {
  if (!status?.installed) return false;
  if (id === 'pandoc') {
    const major = Number.parseInt(String(status.version ?? ''), 10);
    return !Number.isFinite(major) || major >= 3;
  }
  return true;
}

// The programs that can import `filePath`, best first, each with whether it's
// ready here. `statuses` maps a tool id to { installed, version }.
function importChoices(filePath, statuses) {
  const format = importFormatFor(filePath);
  if (!format) return [];
  return format.tools.map((tool, index) => ({
    tool,
    name: TOOL_NAMES[tool],
    recommended: index === 0,
    usable: toolUsable(tool, statuses[tool]),
    installed: !!statuses[tool]?.installed,
    version: statuses[tool]?.version ?? null,
  }));
}

// The program Import uses unless the user picks another: the best one that's
// ready, else null.
function defaultImportTool(choices) {
  return choices.find((choice) => choice.usable)?.tool ?? null;
}

// A mdzip-pandoc script: its full path when running, its bare name for the
// command line shown in the dialogs.
function scriptPath(scripts, name) {
  return scripts ? path.join(scripts, name) : name;
}

// What Import keeps as HTML in the Markdown, so the .mdz looks like the
// original (mdz.lua's writing switches; mdz.lua writes plain Markdown without
// them): imageSizes, htmlTables, tableLook (from Word), htmlFormatting.
const IMPORT_LOOK_SWITCHES = [
  ['imageSizes', 'image_sizes'],
  ['htmlTables', 'html_tables'],
  ['tableLook', 'table_look'],
  ['htmlFormatting', 'html_formatting'],
];

// The switches for mdz.lua that turn on what `look` keeps ("" for none).
function importLookSwitches(look) {
  return IMPORT_LOOK_SWITCHES.filter(([key]) => look?.[key] === true).map(([, name]) => `+${name}`).join('');
}

// Import: { command, args } turning `input` into the .mdz `output`. `look`:
// what to keep as HTML (see IMPORT_LOOK_SWITCHES); `notes`: mdz.lua writes
// sources/conversion-notes.md. Both Pandoc only.
function importCommand({ tool, input, output, scripts = null, look = null, notes = false }) {
  if (tool === 'pandoc') {
    const switches = importLookSwitches(look) + (notes === true ? '+notes' : '');
    return { command: 'pandoc', args: [input, '-t', scriptPath(scripts, 'mdz.lua') + switches, '-o', output] };
  }
  if (tool === 'markitdown-mdz') return { command: 'markitdown-mdz', args: [input, '-o', output] };
  throw new Error(`Unknown import program: ${tool}`);
}

// Export: { command, args, env } turning `input` (an .mdz, or a .md when
// `sourceFormat` is 'markdown') into `output`. `combine`: read the entry
// point and the documents it links to as one document (a project: all its
// documents, as a collection). `document`: an .mdz's document to export
// instead of its entry point, when not combining (mdz.lua reads it from
// MDZ_DOCUMENT). For PDF it's the equivalent Pandoc command (Studio makes
// the PDF itself).
function exportCommand({ format: id, input, output, sourceFormat = 'mdz', combine = false, document = null, scripts = null }) {
  const format = exportFormat(id);
  if (!format) throw new Error(`Unknown export format: ${id}`);
  let reader;
  if (sourceFormat === 'mdz') {
    reader = scriptPath(scripts, 'mdz.lua');
    if (combine) reader += format.pagebreaks ? '+combine+pagebreaks' : '+combine';
  } else {
    reader = 'gfm';
  }
  const args = ['-f', reader, input];
  if (format.writer) args.push('-t', scriptPath(scripts, format.writer));
  args.push(...(format.args ?? []), ...(format.equivalent ?? []), '-o', output);
  const env = sourceFormat === 'mdz' && !combine && document ? { MDZ_DOCUMENT: document } : null;
  return { command: 'pandoc', args, env };
}

// Insert Word Template: Pandoc's own Word styles, written to `output`, to
// change in Word and give exported Word documents (manifest
// pandoc.referenceDoc). Made by the Pandoc that will export, so its styles
// are the ones that Pandoc knows.
function wordTemplateCommand(output) {
  return { command: 'pandoc', args: ['-o', output, '--print-default-data-file', 'reference.docx'], env: null };
}

// The full path of `command` on `pathList` (a PATH value), or null. Programs
// run without a shell (the arguments are the user's file names), and then
// Windows looks only on Studio's own PATH, which predates anything installed
// since; so Studio finds them itself. On Windows only .exe and .com: a .cmd
// or .bat needs a shell. `exists(file)` says whether a file is there.
function findProgram(command, pathList, { platform = process.platform, exists }) {
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  const separator = platform === 'win32' ? ';' : ':';
  const names = platform === 'win32' ? [`${command}.exe`, `${command}.com`] : [command];
  for (const folder of String(pathList ?? '').split(separator)) {
    const trimmed = folder.trim().replace(/^"(.*)"$/, '$1');
    if (!trimmed) continue;
    for (const name of names) {
      const candidate = flavour.join(trimmed, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

// The command line as you'd type it: arguments with spaces or shell
// characters quoted for the platform's usual shell (PowerShell on Windows,
// sh/zsh elsewhere), after any environment variables it needs.
function commandLine({ command, args, env = null }, platform = process.platform) {
  const line = [command, ...args].map((arg) => quoteArg(String(arg), platform)).join(' ');
  const vars = Object.entries(env ?? {});
  if (!vars.length) return line;
  if (platform === 'win32') {
    return `${vars.map(([name, value]) => `$env:${name} = "${String(value).replace(/"/g, '`"')}"`).join('; ')}; ${line}`;
  }
  return `${vars.map(([name, value]) => `${name}=${quoteArg(String(value), platform)}`).join(' ')} ${line}`;
}

function quoteArg(arg, platform) {
  if (arg && /^[\w@%+=:,./\\-]+$/.test(arg)) return arg;
  if (platform === 'win32') return `"${arg.replace(/"/g, '\\"')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

// A file name with another extension: "Guide.mdz" → "Guide.docx".
function withExtension(fileName, extension) {
  const base = path.basename(String(fileName ?? ''));
  const stem = base.replace(/\.[^.]+$/, '') || 'Document';
  return `${stem}.${extension}`;
}

// What went wrong, in words, from a failed run's output. markitdown-mdz
// installed without MarkItDown's readers for a kind of file says so with
// MissingDependencyException; the fix is the [all] extra. `startError`: the
// program couldn't be started at all.
function describeFailure(tool, { code, stdout = '', stderr = '', startError = null }, platform = process.platform) {
  const name = TOOL_NAMES[tool] ?? tool;
  if (startError) return { message: `Couldn't start ${name}: ${startError}`, fix: null };
  const text = `${stderr}\n${stdout}`.trim();
  if (tool === 'markitdown-mdz' && /MissingDependencyException/.test(text)) {
    const pip = platform === 'win32' ? 'py -m pip' : 'python3 -m pip';
    return {
      message: 'markitdown-mdz is installed without MarkItDown\'s readers for this kind of file.',
      fix: `${pip} install --user --upgrade "markitdown-mdzip[all]"`,
    };
  }
  // The last few lines say what happened; Python's traceback above them doesn't help.
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  return { message: lines.slice(-4).join('\n') || `${name} stopped with code ${code}.`, fix: null };
}

// Pandoc's warnings ("[WARNING] Could not fetch resource ...") from a run
// that worked, one per entry.
function warningsFrom(stderr) {
  return String(stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\[WARNING\]\s*/, ''));
}

module.exports = {
  EXPORT_FORMATS,
  IMPORT_FORMATS,
  TOOL_NAMES,
  commandLine,
  defaultImportTool,
  describeFailure,
  exportCommand,
  exportFormat,
  findProgram,
  importChoices,
  importCommand,
  importLookSwitches,
  importDialogFilters,
  importFormatFor,
  toolUsable,
  warningsFrom,
  withExtension,
  wordTemplateCommand,
};
