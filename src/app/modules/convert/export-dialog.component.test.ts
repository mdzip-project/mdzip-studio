import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportDialogComponent } from './export-dialog.component';
import { ExportOptions } from './convert-types';

function options(pandocUsable: boolean): ExportOptions {
  return {
    pandoc: { installed: pandocUsable, version: pandocUsable ? '3.14' : null, usable: pandocUsable },
    formats: [
      { id: 'docx', name: 'Word document', extension: 'docx', tool: 'pandoc' },
      { id: 'pdf', name: 'PDF', extension: 'pdf', tool: 'studio' },
      { id: 'html', name: 'Web page (one file)', extension: 'html', tool: 'pandoc' },
    ],
    commands: {
      docx: 'pandoc -f mdz.lua Guide.mdz -t docx.lua -o Guide.docx',
      'docx+combine': 'pandoc -f mdz.lua+combine+pagebreaks Guide.mdz -t docx.lua -o Guide.docx',
      pdf: 'pandoc -f mdz.lua Guide.mdz --pdf-engine=typst -o Guide.pdf',
      'pdf+combine': 'pandoc -f mdz.lua+combine+pagebreaks Guide.mdz --pdf-engine=typst -o Guide.pdf',
      html: 'pandoc -f mdz.lua Guide.mdz --standalone --embed-resources -o Guide.html',
      'html+combine': 'pandoc -f mdz.lua+combine Guide.mdz --standalone --embed-resources -o Guide.html',
    },
  };
}

describe('ExportDialogComponent', () => {
  let dialog: ExportDialogComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    runInInjectionContext(TestBed.inject(Injector), () => {
      dialog = new ExportDialogComponent();
    });
    localStorage.removeItem('mdzip-studio.exportFormat');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('starts on Word and shows the command, combined or not', async () => {
    vi.stubGlobal('mdzipStudio', { exportOptions: vi.fn().mockResolvedValue(options(true)) });
    await dialog.open('Guide.mdz', 'mdz');
    expect(dialog.formatId()).toBe('docx');
    expect(dialog.command()).toBe('pandoc -f mdz.lua+combine+pagebreaks Guide.mdz -t docx.lua -o Guide.docx');
    dialog.setCombine(false);
    expect(dialog.command()).toBe('pandoc -f mdz.lua Guide.mdz -t docx.lua -o Guide.docx');
  });

  it("exports a project's page you're viewing by default, or all its documents as one file", async () => {
    const exportOptions = vi.fn().mockResolvedValue(options(true));
    vi.stubGlobal('mdzipStudio', { exportOptions });
    const runExport = vi.fn().mockResolvedValue({ canceled: true });
    dialog.runExport = runExport;
    await dialog.open('mdzip-studio-help.mdz', 'mdz', 'project', 'studio-getting-started.md');
    expect(exportOptions).toHaveBeenCalledWith({ fileName: 'mdzip-studio-help.mdz', sourceFormat: 'mdz', document: 'studio-getting-started.md' });
    expect(dialog.projectMode()).toBe(true);
    expect(dialog.canCombine()).toBe(true);
    expect(dialog.combine()).toBe(false);
    await dialog.run();
    expect(runExport).toHaveBeenLastCalledWith({ format: 'docx', combine: false, document: 'studio-getting-started.md' });

    dialog.setCombine(true);
    await dialog.run();
    expect(runExport).toHaveBeenLastCalledWith({ format: 'docx', combine: true, document: null });
  });

  it('offers only PDF without Pandoc, and PDF never combines', async () => {
    vi.stubGlobal('mdzipStudio', { exportOptions: vi.fn().mockResolvedValue(options(false)) });
    await dialog.open('Guide.mdz', 'mdz');
    expect(dialog.formatId()).toBe('pdf');
    expect(dialog.available(options(false).formats[0])).toBe(false);
    expect(dialog.canCombine()).toBe(false);
    expect(dialog.command()).toBe('pandoc -f mdz.lua Guide.mdz --pdf-engine=typst -o Guide.pdf');
  });

  it('exports the chosen format, remembers it, and shows where it went', async () => {
    vi.stubGlobal('mdzipStudio', { exportOptions: vi.fn().mockResolvedValue(options(true)) });
    const runExport = vi.fn().mockResolvedValue({ filePath: 'C:\\Docs\\Guide.html', warnings: ['Could not fetch resource a.png'] });
    dialog.runExport = runExport;
    await dialog.open('Guide.mdz', 'mdz');
    dialog.selectFormat('html');
    await dialog.run();
    expect(runExport).toHaveBeenCalledWith({ format: 'html', combine: true, document: null });
    expect(dialog.done()).toEqual({ name: 'Guide.html', filePath: 'C:\\Docs\\Guide.html', warnings: ['Could not fetch resource a.png'] });

    dialog.close();
    await dialog.open('Guide.mdz', 'mdz');
    expect(dialog.formatId()).toBe('html');
  });

  it("shows Pandoc's error and stays on the format", async () => {
    vi.stubGlobal('mdzipStudio', { exportOptions: vi.fn().mockResolvedValue(options(true)) });
    dialog.runExport = vi.fn().mockResolvedValue({ error: true, message: 'ERR_ZIP_INVALID: not a zip' });
    await dialog.open('Guide.mdz', 'mdz');
    await dialog.run();
    expect(dialog.failure()?.message).toBe('ERR_ZIP_INVALID: not a zip');
    expect(dialog.done()).toBeNull();
  });

  it('does nothing more when the save dialog is canceled', async () => {
    vi.stubGlobal('mdzipStudio', { exportOptions: vi.fn().mockResolvedValue(options(true)) });
    dialog.runExport = vi.fn().mockResolvedValue({ canceled: true });
    await dialog.open('notes.md', 'markdown');
    await dialog.run();
    expect(dialog.done()).toBeNull();
    expect(dialog.failure()).toBeNull();
  });
});
