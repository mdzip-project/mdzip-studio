import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportDialogComponent, ImportedDocument } from './import-dialog.component';
import { DEFAULT_IMPORT_LOOK, ImportPick } from './convert-types';

const WORD_PICK: ImportPick = {
  canceled: false,
  fileName: 'Launch Notes.docx',
  folder: 'C:\\Docs',
  formatName: 'Word document',
  defaultTool: 'pandoc',
  choices: [
    { tool: 'pandoc', name: 'Pandoc', recommended: true, installed: true, usable: true, version: '3.14', commandLine: 'pandoc "Launch Notes.docx" -t mdz.lua -o "Launch Notes.mdz"' },
    { tool: 'markitdown-mdz', name: 'markitdown-mdz', recommended: false, installed: true, usable: true, version: '0.1.0', commandLine: 'markitdown-mdz "Launch Notes.docx" -o "Launch Notes.mdz"' },
  ],
};

// Constructed directly in an injection context, like the other dialogs' tests.
describe('ImportDialogComponent', () => {
  let dialog: ImportDialogComponent;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    runInInjectionContext(TestBed.inject(Injector), () => {
      dialog = new ImportDialogComponent();
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows nothing when the file picker is canceled', async () => {
    vi.stubGlobal('mdzipStudio', { importPick: vi.fn().mockResolvedValue({ canceled: true }) });
    await dialog.start();
    expect(dialog.visible()).toBe(false);
  });

  it("chooses the best program and shows its command, switching when you pick another", async () => {
    vi.stubGlobal('mdzipStudio', { importPick: vi.fn().mockResolvedValue(WORD_PICK) });
    await dialog.start();
    expect(dialog.visible()).toBe(true);
    expect(dialog.choice()?.commandLine).toBe('pandoc "Launch Notes.docx" -t mdz.lua -o "Launch Notes.mdz"');
    dialog.selectTool('markitdown-mdz');
    expect(dialog.choice()?.commandLine).toBe('markitdown-mdz "Launch Notes.docx" -o "Launch Notes.mdz"');
  });

  it('converts with the chosen program and hands back the .mdz', async () => {
    const importRun = vi.fn().mockResolvedValue({ bytes: new Uint8Array([80, 75]), fileName: 'Launch Notes.mdz', warnings: [] });
    vi.stubGlobal('mdzipStudio', { importPick: vi.fn().mockResolvedValue(WORD_PICK), importRun });
    const imported: ImportedDocument[] = [];
    dialog.imported.subscribe((document) => imported.push(document));

    await dialog.start();
    await dialog.run();

    // A Word document: its styles are kept by default, the original isn't.
    expect(importRun).toHaveBeenCalledWith('pandoc', { keepStyles: true, keepOriginal: false, documentStyle: true, look: DEFAULT_IMPORT_LOOK, notes: true });
    expect(imported.map((document) => document.fileName)).toEqual(['Launch Notes.mdz']);
    expect(dialog.visible()).toBe(false);
  });

  it("a Word document's options go with it, and the file comes back with the .mdz", async () => {
    const original = { fileName: 'Launch Notes.docx', bytes: new Uint8Array([1, 2]), keepStyles: false, keepOriginal: true };
    const importRun = vi.fn().mockResolvedValue({ bytes: new Uint8Array([80, 75]), fileName: 'Launch Notes.mdz', warnings: [], original });
    vi.stubGlobal('mdzipStudio', { importPick: vi.fn().mockResolvedValue(WORD_PICK), importRun });
    const imported: ImportedDocument[] = [];
    dialog.imported.subscribe((document) => imported.push(document));

    await dialog.start();
    expect(dialog.isWord()).toBe(true);
    dialog.keepStyles.set(false);
    dialog.keepOriginal.set(true);
    dialog.documentStyle.set(false);
    await dialog.run();

    expect(importRun).toHaveBeenCalledWith('pandoc', { keepStyles: false, keepOriginal: true, documentStyle: false, look: DEFAULT_IMPORT_LOOK, notes: true });
    expect(imported[0].original).toEqual(original);
  });

  it('Keep the look: turning things off changes the command, goes with the import, and is remembered', async () => {
    const importRun = vi.fn().mockResolvedValue({ bytes: new Uint8Array([80, 75]), fileName: 'Launch Notes.mdz', warnings: [] });
    vi.stubGlobal('mdzipStudio', { importPick: vi.fn().mockResolvedValue(WORD_PICK), importRun });
    await dialog.start();
    // All on by default, so the command shows each switch.
    expect(dialog.commandLine()).toBe(
      'pandoc "Launch Notes.docx" -t mdz.lua+image_sizes+html_tables+table_look+html_formatting+notes -o "Launch Notes.mdz"',
    );
    dialog.setLook('htmlTables', false);
    dialog.setLook('tableLook', false);
    expect(dialog.commandLine()).toBe('pandoc "Launch Notes.docx" -t mdz.lua+image_sizes+html_formatting+notes -o "Launch Notes.mdz"');
    dialog.setLook('imageSizes', false);
    dialog.setLook('htmlFormatting', false);
    expect(dialog.commandLine()).toBe('pandoc "Launch Notes.docx" -t mdz.lua+notes -o "Launch Notes.mdz"');
    dialog.setLook('htmlTables', true);
    dialog.setLook('tableLook', true);
    await dialog.run();
    expect(importRun.mock.calls[0][1].look).toEqual({ imageSizes: false, htmlTables: true, tableLook: true, htmlFormatting: false });

    // The next import starts with the same choices.
    runInInjectionContext(TestBed.inject(Injector), () => {
      dialog = new ImportDialogComponent();
    });
    expect(dialog.look().imageSizes).toBe(false);
  });

  it("Keep the look: markitdown-mdz has none, and table shading is Word's alone", async () => {
    const importRun = vi.fn().mockResolvedValue({ bytes: new Uint8Array([80, 75]), fileName: 'page.mdz', warnings: [] });
    vi.stubGlobal('mdzipStudio', {
      importPick: vi.fn().mockResolvedValue({
        ...WORD_PICK,
        fileName: 'page.html',
        formatName: 'Web page',
        choices: WORD_PICK.choices.map((c) => ({ ...c, commandLine: c.commandLine.replaceAll('Launch Notes.docx', 'page.html') })),
      }),
      importRun,
    });
    await dialog.start();
    expect(dialog.commandLine()).toBe('pandoc "page.html" -t mdz.lua+image_sizes+html_tables+html_formatting+notes -o "Launch Notes.mdz"');
    dialog.selectTool('markitdown-mdz');
    expect(dialog.commandLine()).toBe('markitdown-mdz "page.html" -o "Launch Notes.mdz"');
    await dialog.run();
    expect(importRun).toHaveBeenCalledWith('markitdown-mdz', { notes: true });
  });

  it('Conversion notes: on by default, for any program; off drops +notes, is remembered, and the info comes back', async () => {
    const notes = { tool: 'Pandoc', command: 'pandoc "Launch Notes.docx" -t mdz.lua+notes -o "Launch Notes.mdz"', source: 'Launch Notes.docx' };
    const importRun = vi.fn().mockResolvedValue({ bytes: new Uint8Array([80, 75]), fileName: 'Launch Notes.mdz', warnings: [], notes });
    vi.stubGlobal('mdzipStudio', { importPick: vi.fn().mockResolvedValue(WORD_PICK), importRun });
    const imported: ImportedDocument[] = [];
    dialog.imported.subscribe((document) => imported.push(document));
    await dialog.start();
    expect(dialog.notes()).toBe(true);
    await dialog.run();
    expect(imported[0].notes).toEqual(notes);

    dialog.setNotes(false);
    expect(dialog.commandLine()).toBe(
      'pandoc "Launch Notes.docx" -t mdz.lua+image_sizes+html_tables+table_look+html_formatting -o "Launch Notes.mdz"',
    );
    await dialog.start();
    await dialog.run();
    expect(importRun.mock.calls[1][1].notes).toBe(false);
    runInInjectionContext(TestBed.inject(Injector), () => {
      dialog = new ImportDialogComponent();
    });
    expect(dialog.notes()).toBe(false);
  });

  it('stays open with the message and the fix when the conversion fails', async () => {
    const importRun = vi.fn().mockResolvedValue({
      error: true,
      message: "markitdown-mdz is installed without MarkItDown's readers for this kind of file.",
      fix: 'py -m pip install --user --upgrade "markitdown-mdzip[all]"',
    });
    vi.stubGlobal('mdzipStudio', { importPick: vi.fn().mockResolvedValue(WORD_PICK), importRun });
    await dialog.start();
    dialog.selectTool('markitdown-mdz');
    await dialog.run();
    expect(dialog.visible()).toBe(true);
    expect(dialog.failure()?.fix).toBe('py -m pip install --user --upgrade "markitdown-mdzip[all]"');
  });

  it('stays open, with nothing wrong, when Cancel stops the conversion', async () => {
    const cancelConversion = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('mdzipStudio', {
      importPick: vi.fn().mockResolvedValue(WORD_PICK),
      importRun: vi.fn().mockResolvedValue({ canceled: true }),
      cancelConversion,
    });
    await dialog.start();
    dialog.cancelRun();
    await dialog.run();
    expect(cancelConversion).toHaveBeenCalled();
    expect(dialog.visible()).toBe(true);
    expect(dialog.failure()).toBeNull();
    expect(dialog.busy()).toBe(false);
  });

  it('says so when the import opened in a new window', async () => {
    vi.stubGlobal('mdzipStudio', {
      importPick: vi.fn().mockResolvedValue(WORD_PICK),
      importRun: vi.fn().mockResolvedValue({ openedInNewWindow: true, fileName: 'Launch Notes.mdz' }),
    });
    const elsewhere: string[] = [];
    dialog.importedElsewhere.subscribe((name) => elsewhere.push(name));
    await dialog.start();
    await dialog.run();
    expect(elsewhere).toEqual(['Launch Notes.mdz']);
  });

  it('cannot import when no program that reads the file is installed', async () => {
    vi.stubGlobal('mdzipStudio', {
      importPick: vi.fn().mockResolvedValue({
        ...WORD_PICK,
        fileName: 'deck.pptx',
        formatName: 'PowerPoint presentation',
        defaultTool: null,
        choices: [{ tool: 'markitdown-mdz', name: 'markitdown-mdz', recommended: true, installed: false, usable: false, version: null, commandLine: 'markitdown-mdz deck.pptx -o deck.mdz' }],
      }),
    });
    await dialog.start();
    expect(dialog.anyUsable()).toBe(false);
    expect(dialog.isWord()).toBe(false); // no Word options for a presentation
    expect(dialog.choice()?.usable).toBe(false);
    expect(dialog.choiceStatus(dialog.choice()!)).toBe('Not installed');
  });
});
