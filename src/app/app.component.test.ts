import { Injector, NgZone, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MdzPackagerCore } from '@mdzip/core-js';
import type { MdzipConversionContext, MdzipEntryRenderContext } from '@mdzip/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { ArchiveService } from './core/services/archive.service';
import { StorageService } from './core/services/storage.service';
import { ValidationService } from './core/services/validation.service';

// AppComponent is tested by directly constructing the class inside an injection
// context rather than via TestBed.createComponent, which requires the Angular
// compiler to be present (only available with @analogjs/vitest-angular).

describe('AppComponent', () => {
  let component: AppComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    const injector = TestBed.inject(Injector);

    runInInjectionContext(injector, () => {
      component = new AppComponent(
        TestBed.inject(ArchiveService),
        TestBed.inject(StorageService),
        TestBed.inject(ValidationService),
        TestBed.inject(NgZone),
      );
    });
  });

  afterEach(() => {
    component.ngOnDestroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts on the welcome screen with no document open', () => {
    expect(component.currentArchive()).toBeNull();
  });

  it('creates an untitled document from the dialog', () => {
    component.createArchiveFromDialog();
    expect(component.currentArchive()?.name).toBe('Untitled');
    expect(component.documents().length).toBe(1);
  });

  it('should create a named archive from the dialog', () => {
    component.newArchiveName = 'Test Archive';
    component.newArchiveMode = 'project';
    component.createArchiveFromDialog();

    expect(component.currentArchive()?.name).toBe('Test Archive');
    expect(component.currentArchive()?.mode).toBe('project');
    expect(component.documents().length).toBe(1);
  });

  it('should open About dialog when mdzip-studio:show-about is dispatched', () => {
    expect(component.aboutOpen()).toBe(false);

    window.dispatchEvent(new CustomEvent('mdzip-studio:show-about'));

    expect(component.aboutOpen()).toBe(true);
  });

  it('should close About dialog via aboutOpen signal', () => {
    component.aboutOpen.set(true);
    expect(component.aboutOpen()).toBe(true);

    component.aboutOpen.set(false);
    expect(component.aboutOpen()).toBe(false);
  });

  it('routes manifest editor changes into Studio archive state', () => {
    component.createArchiveFromDialog();
    component.onManifestEditorChange({ field: 'title', value: 'Updated title' });
    component.onManifestEditorChange({ field: 'mode', value: 'project' });
    component.onManifestEditorChange({ field: 'author', value: 'Ada Lovelace' });

    expect(component.currentArchive()?.name).toBe('Updated title');
    expect(component.currentArchive()?.mode).toBe('project');
    expect(component.currentArchive()?.manifest.mode).toBe('project');
    expect(component.metadataField('author')).toBe('Ada Lovelace');
  });

  it('uses the archive name as the centered document title', () => {
    component.createArchiveFromDialog();
    expect(component.documentTitle()).toBe('Untitled');

    component.onManifestEditorChange({ field: 'title', value: 'Manifest title' });

    expect(component.documentTitle()).toBe('Manifest title');
  });

  it('persists embedded manifest edits through the entry render context', async () => {
    const updateManifest = vi.fn().mockResolvedValue(undefined);
    const manifest = MdzPackagerCore.updateManifest(null, {
      title: 'Before',
      mode: 'document',
      entryPoint: 'index.md',
    });
    const context = {
      manifest,
      signal: new AbortController().signal,
      updateManifest,
    } as unknown as MdzipEntryRenderContext;

    await component.onEmbeddedManifestChange(context, {
      field: 'title',
      value: 'After',
    });

    expect(updateManifest).toHaveBeenCalledOnce();
    expect(updateManifest.mock.calls[0][0].title).toBe('After');
    expect(updateManifest.mock.calls[0][0].entryPoint).toBe('index.md');
  });

  it('stores the library conversion context for an intercepted image action', () => {
    const context = {
      insertMarkdown: vi.fn(),
      convertToMdz: vi.fn(),
    } as unknown as MdzipConversionContext;
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    expect(component.handleConversionRequested({ kind: 'image-file', file }, context)).toBe(true);
    expect(component.imageDestinationDialogOpen()).toBe(true);

    component.cancelImageDestination();
  });

  it('inserts a relative image reference through the library conversion context', async () => {
    const insertMarkdown = vi.fn().mockResolvedValue(true);
    const context = {
      insertMarkdown,
      convertToMdz: vi.fn(),
    } as unknown as MdzipConversionContext;

    const file = new File(['image'], 'team-photo.png', { type: 'image/png' });
    component.handleConversionRequested({ kind: 'image-file', file }, context);
    const app = component as unknown as {
      insertPendingMarkdown(text: string): Promise<boolean>;
      markdownImageReference(fileName: string, relativePath: string): string;
    };
    const reference = app.markdownImageReference(
      'team-photo.png',
      'project images/team photo.png'
    );

    expect(await app.insertPendingMarkdown(reference)).toBe(true);
    expect(insertMarkdown).toHaveBeenCalledWith(
      '![team photo](project%20images/team%20photo.png)'
    );

    component.cancelImageDestination();
  });

  // ── Unsaved-state tracking (isDirty / needsSave) ──────────────────────────

  const setArchivePath = (path: string | undefined) =>
    TestBed.inject(ArchiveService).currentArchive.update((archive) =>
      archive ? { ...archive, path } : archive
    );

  // Seed an open document (the app starts on the welcome screen with none), then
  // optionally record an on-disk path to simulate a saved file.
  const openTestArchive = (path?: string) => {
    component.createArchiveFromDialog();
    if (path !== undefined) setArchivePath(path);
  };

  it('tracks dirty state from the workspace dirtyChanged event', () => {
    component.onWorkspaceDirtyChanged({ dirty: true } as never);
    expect(component.isDirty()).toBe(true);

    component.onWorkspaceDirtyChanged({ dirty: false } as never);
    expect(component.isDirty()).toBe(false);
  });

  it('clears a stale dirty flag when a document loads (onWorkspaceChanged)', () => {
    // Simulate dirty state left over from a previously open document.
    component.isDirty.set(true);

    component.onWorkspaceChanged({
      bytes: new Uint8Array(),
      snapshot: { dirty: false, currentPath: 'index.md' },
    } as never);

    expect(component.isDirty()).toBe(false);
  });

  it('needsSave is false for a saved on-disk document with no edits', () => {
    component.isDesktopShell.set(true);
    openTestArchive('C:/docs/sample.mdz');
    component.isDirty.set(false);

    expect(component.hasFileOnDisk()).toBe(true);
    expect(component.needsSave()).toBe(false);
  });

  it('needsSave is true for an in-memory document not yet on disk (desktop)', () => {
    component.isDesktopShell.set(true);
    openTestArchive(); // new/converted/packed: in memory, no path
    component.isDirty.set(false);

    expect(component.hasFileOnDisk()).toBe(false);
    expect(component.needsSave()).toBe(true);
  });

  it('needsSave is true when there are unsaved edits even if on disk', () => {
    component.isDesktopShell.set(true);
    openTestArchive('C:/docs/sample.mdz');
    component.isDirty.set(true);

    expect(component.needsSave()).toBe(true);
  });

  // ── Unsaved-changes guard on close/new ────────────────────────────────────

  it('closes immediately when there is nothing to save', () => {
    component.isDesktopShell.set(true);
    openTestArchive('C:/docs/sample.mdz');
    component.isDirty.set(false);
    expect(component.needsSave()).toBe(false);

    component.closeDocument();

    expect(component.unsavedDialogOpen()).toBe(false);
    expect(component.currentArchive()).toBeNull();
  });

  it('prompts before closing a document that needs saving', () => {
    component.isDesktopShell.set(true);
    openTestArchive(); // in memory, no path → needsSave
    expect(component.needsSave()).toBe(true);

    component.closeDocument();

    expect(component.unsavedDialogOpen()).toBe(true);
    expect(component.currentArchive()).not.toBeNull();
  });

  it('prompts before starting a new document when there is unsaved work', () => {
    component.isDesktopShell.set(true);
    openTestArchive();

    component.newArchive('markdown');

    expect(component.unsavedDialogOpen()).toBe(true);
    expect(component.newDialogOpen()).toBe(false);
  });

  it('discards and proceeds when the user chooses Don\'t Save', () => {
    component.isDesktopShell.set(true);
    openTestArchive();
    component.closeDocument();
    expect(component.unsavedDialogOpen()).toBe(true);

    component.discardUnsavedThenContinue();

    expect(component.unsavedDialogOpen()).toBe(false);
    expect(component.currentArchive()).toBeNull();
  });

  it('keeps the document when the unsaved-changes prompt is canceled', () => {
    component.isDesktopShell.set(true);
    openTestArchive();
    component.closeDocument();
    expect(component.unsavedDialogOpen()).toBe(true);

    component.cancelUnsavedDialog();

    expect(component.unsavedDialogOpen()).toBe(false);
    expect(component.currentArchive()).not.toBeNull();
  });

  it('proceeds after a successful save from the unsaved-changes prompt', async () => {
    component.isDesktopShell.set(true);
    openTestArchive();
    component.closeDocument();

    // Simulate a successful save: a path is recorded and dirty clears.
    vi.spyOn(component, 'saveArchive').mockImplementation(async () => {
      setArchivePath('C:/docs/saved.mdz');
      component.isDirty.set(false);
    });

    await component.saveUnsavedThenContinue();

    expect(component.needsSave()).toBe(false);
    expect(component.currentArchive()).toBeNull(); // close proceeded
  });

  it('stays put when the save is canceled from the unsaved-changes prompt', async () => {
    component.isDesktopShell.set(true);
    openTestArchive();
    component.closeDocument();

    // Save that does nothing (e.g. user canceled the save dialog) leaves needsSave true.
    vi.spyOn(component, 'saveArchive').mockResolvedValue(undefined);

    await component.saveUnsavedThenContinue();

    expect(component.needsSave()).toBe(true);
    expect(component.currentArchive()).not.toBeNull(); // close did not proceed
  });
});
