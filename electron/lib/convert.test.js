import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMATS,
  commandLine,
  defaultImportTool,
  describeFailure,
  exportCommand,
  findProgram,
  importChoices,
  importCommand,
  importDialogFilters,
  importFormatFor,
  toolUsable,
  warningsFrom,
  withExtension,
  wordTemplateCommand,
} from './convert';

const installed = (version) => ({ installed: true, version });
const missing = { installed: false, version: null };

describe('importFormatFor', () => {
  it('knows a file by its extension, whatever its case', () => {
    expect(importFormatFor('C:\\Docs\\Report.DOCX').id).toBe('docx');
    expect(importFormatFor('/tmp/page.htm').id).toBe('html');
    expect(importFormatFor('notes.txt')).toBeNull();
  });

  it('lists every importable extension first in the open dialog', () => {
    const [all, ...kinds] = importDialogFilters();
    expect(all.extensions).toEqual(expect.arrayContaining(['docx', 'pptx', 'pdf', 'html', 'epub']));
    expect(kinds.find((filter) => filter.name === 'Word document').extensions).toEqual(['docx']);
  });
});

describe('importChoices', () => {
  it('prefers Pandoc for Word and falls back to markitdown-mdz when Pandoc is missing', () => {
    const both = importChoices('a.docx', { pandoc: installed('3.14'), 'markitdown-mdz': installed('0.1.0') });
    expect(both.map((choice) => [choice.tool, choice.recommended, choice.usable])).toEqual([
      ['pandoc', true, true],
      ['markitdown-mdz', false, true],
    ]);
    expect(defaultImportTool(both)).toBe('pandoc');

    const noPandoc = importChoices('a.docx', { pandoc: missing, 'markitdown-mdz': installed('0.1.0') });
    expect(defaultImportTool(noPandoc)).toBe('markitdown-mdz');
  });

  it('uses only markitdown-mdz for PowerPoint, and none when it is missing', () => {
    const choices = importChoices('deck.pptx', { pandoc: installed('3.14'), 'markitdown-mdz': missing });
    expect(choices.map((choice) => choice.tool)).toEqual(['markitdown-mdz']);
    expect(defaultImportTool(choices)).toBeNull();
  });

  it('needs Pandoc 3 or newer for mdz.lua', () => {
    expect(toolUsable('pandoc', installed('2.19.2'))).toBe(false);
    expect(toolUsable('pandoc', installed('3.1.9'))).toBe(true);
    expect(toolUsable('pandoc', installed(null))).toBe(true);
    expect(toolUsable('pandoc', missing)).toBe(false);
  });
});

describe('importCommand', () => {
  it('writes an .mdz with mdz.lua, by full path when running and by name for show', () => {
    const scripts = path.join('C:', 'Studio', 'resources', 'mdzip-pandoc');
    expect(importCommand({ tool: 'pandoc', input: 'in.docx', output: 'out.mdz', scripts }).args)
      .toEqual(['in.docx', '-t', path.join(scripts, 'mdz.lua'), '-o', 'out.mdz']);
    expect(commandLine(importCommand({ tool: 'pandoc', input: 'Launch Notes.docx', output: 'Launch Notes.mdz' }), 'win32'))
      .toBe('pandoc "Launch Notes.docx" -t mdz.lua -o "Launch Notes.mdz"');
  });

  it("adds mdz.lua's switches for what Keep the look keeps", () => {
    const look = { imageSizes: false, htmlTables: true, tableLook: false, htmlFormatting: true };
    expect(commandLine(importCommand({ tool: 'pandoc', input: 'a.docx', output: 'a.mdz', look }), 'darwin'))
      .toBe('pandoc a.docx -t mdz.lua+html_tables+html_formatting -o a.mdz');
    // None, or anything that isn't true: nothing added (plain Markdown).
    expect(importCommand({ tool: 'pandoc', input: 'a.docx', output: 'a.mdz', look: { imageSizes: 'yes' } }).args[2]).toBe('mdz.lua');
    expect(commandLine(importCommand({ tool: 'markitdown-mdz', input: 'a.docx', output: 'a.mdz', look }), 'darwin'))
      .toBe('markitdown-mdz a.docx -o a.mdz');
  });

  it('adds +notes for conversion notes, after the look; markitdown-mdz has none', () => {
    const look = { imageSizes: true, htmlTables: false, tableLook: false, htmlFormatting: false };
    expect(importCommand({ tool: 'pandoc', input: 'a.docx', output: 'a.mdz', look, notes: true }).args[2]).toBe('mdz.lua+image_sizes+notes');
    expect(importCommand({ tool: 'pandoc', input: 'a.docx', output: 'a.mdz', notes: 'yes' }).args[2]).toBe('mdz.lua');
    expect(commandLine(importCommand({ tool: 'markitdown-mdz', input: 'a.docx', output: 'a.mdz', notes: true }), 'darwin'))
      .toBe('markitdown-mdz a.docx -o a.mdz');
  });

  it('runs markitdown-mdz with -o', () => {
    expect(commandLine(importCommand({ tool: 'markitdown-mdz', input: 'deck.pptx', output: 'deck.mdz' }), 'darwin'))
      .toBe('markitdown-mdz deck.pptx -o deck.mdz');
  });
});

describe('wordTemplateCommand', () => {
  it("writes Pandoc's own Word styles to a file", () => {
    expect(commandLine(wordTemplateCommand('C:\\Temp\\My Styles\\reference.docx'), 'win32'))
      .toBe('pandoc -o "C:\\Temp\\My Styles\\reference.docx" --print-default-data-file reference.docx');
  });
});

describe('exportCommand', () => {
  it('writes Word with docx.lua, combining linked documents with page breaks', () => {
    expect(commandLine(exportCommand({ format: 'docx', input: 'Guide.mdz', output: 'Guide.docx', combine: true }), 'win32'))
      .toBe('pandoc -f mdz.lua+combine+pagebreaks Guide.mdz -t docx.lua -o Guide.docx');
  });

  it('writes a self-contained web page, combined without page breaks', () => {
    expect(exportCommand({ format: 'html', input: 'Guide.mdz', output: 'Guide.html', combine: true }).args)
      .toEqual(['-f', 'mdz.lua+combine', 'Guide.mdz', '--standalone', '--embed-resources', '-o', 'Guide.html']);
  });

  it('reads a plain .md as GitHub-Flavored Markdown', () => {
    expect(exportCommand({ format: 'epub', input: 'notes.md', output: 'notes.epub', sourceFormat: 'markdown', combine: true }).args)
      .toEqual(['-f', 'gfm', 'notes.md', '-o', 'notes.epub']);
  });

  it("shows PDF's equivalent Pandoc command", () => {
    expect(commandLine(exportCommand({ format: 'pdf', input: 'Guide.mdz', output: 'Guide.pdf' }), 'linux'))
      .toBe('pandoc -f mdz.lua Guide.mdz --pdf-engine=typst -o Guide.pdf');
  });

  it("exports another of an .mdz's documents through MDZ_DOCUMENT, unless combining", () => {
    const single = exportCommand({ format: 'docx', input: 'Guide.mdz', output: 'Guide.docx', document: 'chapters/install.md' });
    expect(single.env).toEqual({ MDZ_DOCUMENT: 'chapters/install.md' });
    expect(commandLine(single, 'win32'))
      .toBe('$env:MDZ_DOCUMENT = "chapters/install.md"; pandoc -f mdz.lua Guide.mdz -t docx.lua -o Guide.docx');
    expect(commandLine(single, 'darwin'))
      .toBe('MDZ_DOCUMENT=chapters/install.md pandoc -f mdz.lua Guide.mdz -t docx.lua -o Guide.docx');
    expect(exportCommand({ format: 'docx', input: 'Guide.mdz', output: 'Guide.docx', document: 'a.md', combine: true }).env).toBeNull();
    expect(exportCommand({ format: 'html', input: 'notes.md', output: 'notes.html', sourceFormat: 'markdown', document: 'a.md' }).env).toBeNull();
  });

  it('has a command for every format', () => {
    for (const format of EXPORT_FORMATS) {
      expect(exportCommand({ format: format.id, input: 'a.mdz', output: `a.${format.extension}` }).command).toBe('pandoc');
    }
  });
});

describe('commandLine', () => {
  it("quotes for the platform's shell", () => {
    expect(commandLine({ command: 'pandoc', args: ["Kyle's notes.md"] }, 'darwin')).toBe(`pandoc 'Kyle'\\''s notes.md'`);
    expect(commandLine({ command: 'pandoc', args: ['say "hi".md'] }, 'win32')).toBe('pandoc "say \\"hi\\".md"');
    expect(commandLine({ command: 'pandoc', args: ['C:\\Docs\\a.md'] }, 'win32')).toBe('pandoc C:\\Docs\\a.md');
  });
});

describe('withExtension', () => {
  it('swaps the extension, keeping the name', () => {
    expect(withExtension('Field Guide.mdz', 'docx')).toBe('Field Guide.docx');
    expect(withExtension('C:\\Docs\\notes.md', 'pdf')).toBe('notes.pdf');
    expect(withExtension('', 'html')).toBe('Document.html');
  });
});

describe('describeFailure', () => {
  it('names the [all] extra when markitdown-mdz lacks a reader', () => {
    const failure = describeFailure('markitdown-mdz', {
      code: 1,
      stderr: 'DocxConverter threw MissingDependencyException with message: ...',
    }, 'win32');
    expect(failure.fix).toBe('py -m pip install --user --upgrade "markitdown-mdzip[all]"');
  });

  it("keeps the last lines of a program's output", () => {
    const failure = describeFailure('pandoc', { code: 1, stderr: 'line 1\nline 2\nline 3\nline 4\nERR_ZIP_INVALID: not a zip' });
    expect(failure.message).toBe('line 2\nline 3\nline 4\nERR_ZIP_INVALID: not a zip');
    expect(failure.fix).toBeNull();
  });

  it("says when a program couldn't be started", () => {
    expect(describeFailure('pandoc', { code: -1, startError: 'spawn C:\\Pandoc\\pandoc.exe EACCES' }).message)
      .toBe("Couldn't start Pandoc: spawn C:\\Pandoc\\pandoc.exe EACCES");
    expect(describeFailure('pandoc', { code: 64 }).message).toBe('Pandoc stopped with code 64.');
  });
});

describe('warningsFrom', () => {
  it("lists Pandoc's warnings without their tag", () => {
    expect(warningsFrom('[WARNING] Could not fetch resource a.png\n\n[WARNING] Duplicate identifier')).toEqual([
      'Could not fetch resource a.png',
      'Duplicate identifier',
    ]);
  });
});

describe('findProgram', () => {
  it('finds an .exe on a Windows PATH, in PATH order, skipping .cmd shims', () => {
    const files = new Set(['C:\\Py\\Scripts\\markitdown-mdz.exe', 'C:\\npm\\pandoc.cmd', 'C:\\Pandoc\\pandoc.exe']);
    const exists = (file) => files.has(file);
    const pathList = 'C:\\npm;"C:\\Pandoc";C:\\Py\\Scripts';
    expect(findProgram('pandoc', pathList, { platform: 'win32', exists })).toBe('C:\\Pandoc\\pandoc.exe');
    expect(findProgram('markitdown-mdz', pathList, { platform: 'win32', exists })).toBe('C:\\Py\\Scripts\\markitdown-mdz.exe');
    expect(findProgram('typst', pathList, { platform: 'win32', exists })).toBeNull();
  });

  it('finds a program by its bare name elsewhere', () => {
    const exists = (file) => file === '/opt/homebrew/bin/pandoc';
    expect(findProgram('pandoc', '/usr/bin:/opt/homebrew/bin', { platform: 'darwin', exists })).toBe('/opt/homebrew/bin/pandoc');
  });
});
