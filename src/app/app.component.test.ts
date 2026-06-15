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

  it('should initialize with an untitled archive', () => {
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
    component.onManifestEditorChange({ field: 'title', value: 'Updated title' });
    component.onManifestEditorChange({ field: 'mode', value: 'project' });
    component.onManifestEditorChange({ field: 'author', value: 'Ada Lovelace' });

    expect(component.currentArchive()?.name).toBe('Updated title');
    expect(component.currentArchive()?.mode).toBe('project');
    expect(component.currentArchive()?.manifest.mode).toBe('project');
    expect(component.metadataField('author')).toBe('Ada Lovelace');
  });

  it('uses the archive name as the centered document title', () => {
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
});
