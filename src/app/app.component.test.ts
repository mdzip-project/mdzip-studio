import { Injector, NgZone, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MdzPackagerCore } from '@mdzip/core-js';
import { MdzipRenderingService } from '@mdzip/editor';
import type { MdzipConversionContext, MdzipEntryRenderContext } from '@mdzip/editor';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { ArchiveService } from './core/services/archive.service';
import { PrintService } from './core/services/print.service';
import { StorageService } from './core/services/storage.service';
import { ValidationService } from './core/services/validation.service';

const mockMermaidInitialize = vi.hoisted(() => vi.fn());
const mockMermaidRender = vi.hoisted(() => vi.fn());

vi.mock('mermaid', () => ({
  default: {
    initialize: mockMermaidInitialize,
    render: mockMermaidRender,
  },
}));

// AppComponent is tested by directly constructing the class inside an injection
// context rather than via TestBed.createComponent, which requires the Angular
// compiler to be present (only available with @analogjs/vitest-angular).

describe('AppComponent', () => {
  let component: AppComponent;

  beforeEach(() => {
    mockMermaidInitialize.mockClear();
    mockMermaidRender.mockReset();
    TestBed.configureTestingModule({});
    const injector = TestBed.inject(Injector);

    runInInjectionContext(injector, () => {
      component = new AppComponent(
        TestBed.inject(ArchiveService),
        TestBed.inject(PrintService),
        TestBed.inject(StorageService),
        TestBed.inject(ValidationService),
        TestBed.inject(NgZone),
      );
    });
  });

  afterEach(() => {
    component.ngOnDestroy();
    vi.unstubAllGlobals();
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

  it('suppresses Mermaid library error DOM while preserving Studio preview errors', async () => {
    mockMermaidRender.mockRejectedValueOnce(new Error('bad diagram'));
    const staleError = document.createElement('div');
    staleError.id = 'dmdzip-mermaid-stale';
    staleError.innerHTML = '<svg id="mdzip-mermaid-stale"><path class="error-icon"></path></svg>';
    document.body.append(staleError);

    const renderer = new MdzipRenderingService(undefined, component.markdownExtensions);
    const html = await renderer.renderMarkdown('```mermaid\nflowchart TD\n  A --\n```', {
      currentPath: 'index.md',
      sourceFormat: 'markdown',
      colorScheme: 'light',
      mode: 'editable',
      manifest: null,
      signal: new AbortController().signal,
    });

    expect(mockMermaidInitialize).toHaveBeenCalledWith(expect.objectContaining({
      suppressErrorRendering: true,
    }));
    expect(html).toContain('mdzip-mermaid-error');
    expect(html).toContain('Mermaid diagram error: bad diagram');
    expect(document.getElementById('dmdzip-mermaid-stale')).toBeNull();
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

  it('opens help documents from the bundled copy when remote fetch fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, text: async () => '# Known Issues\n\nBundled copy' });
    vi.stubGlobal('fetch', fetch);

    await component.openHelpDocument('known-issues');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://raw.githubusercontent.com/mdzip-project/mdzip-studio/main/src/assets/help/known-issues.md',
      { cache: 'no-store' }
    );
    expect(fetch).toHaveBeenNthCalledWith(2, 'assets/help/known-issues.md', { cache: 'no-store' });
    expect(component.helpDialogOpen()).toBe(true);
    expect(component.helpDialogStatus()).toBe('Showing bundled copy');
    expect(new TextDecoder().decode(component.helpDialogBytes() ?? new Uint8Array())).toContain('Bundled copy');
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

  it('renders relative images for a Markdown file opened from disk', async () => {
    // Regression guard for two bugs that fought each other:
    //
    // - Rendering the preview with data: image srcs makes relative .md images
    //   appear, but reserializing/redecoding large data URIs on every keystroke
    //   makes typing slow.
    // - Moving image resolution to mount keeps typing fast with cached blob:
    //   URLs, but the editor's progressive image path may remove the relative
    //   src before mount runs. The mdzip-studio-src marker must survive
    //   sanitization so mount can still resolve the loose sibling file.
    const originalBridge = window.mdzipStudio;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn().mockReturnValue('blob:studio/patio');
    const readMarkdownAsset = vi.fn().mockResolvedValue({
      dataUri: 'data:image/png;base64,aW1hZ2U=',
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    window.mdzipStudio = {
      ...originalBridge,
      readMarkdownAsset,
    };

    const app = component as unknown as {
      openDocumentBytes(
        bytes: Uint8Array,
        name: string,
        filePath?: string,
        readOnly?: boolean,
        recordRecent?: boolean
      ): Promise<void>;
    };

    try {
      await app.openDocumentBytes(
        new TextEncoder().encode('![patio](./images/patio.png)'),
        'patio.md',
        'C:/docs/patio.md',
        false,
        false
      );

      const relativeImages = component.markdownExtensions.find((extension) =>
        extension.name === 'studio-relative-images-mounted'
      );
      expect(relativeImages).toBeTruthy();

      const renderer = new MdzipRenderingService(undefined, relativeImages ? [relativeImages] : []);
      const html = await renderer.renderMarkdown('![patio](./images/patio.png)', {
        currentPath: 'index.md',
        sourceFormat: 'markdown',
        colorScheme: 'light',
        mode: 'editable',
        manifest: null,
        signal: new AbortController().signal,
      });
      const container = document.createElement('div');
      container.innerHTML = html;
      // Simulate MdzipWorkspaceView.mountProgressivePreview(), which removes
      // relative src before extension mounts. Without the marker attribute, this
      // is the live-app path that leaves images broken.
      container.querySelector('img')?.removeAttribute('src');
      await relativeImages?.mount?.(container, {
        currentPath: 'index.md',
        sourceFormat: 'markdown',
        colorScheme: 'light',
        mode: 'editable',
        manifest: null,
        signal: new AbortController().signal,
      });

      expect(readMarkdownAsset).toHaveBeenCalledWith({
        documentPath: 'C:/docs/patio.md',
        relativePath: 'images/patio.png',
      });
      expect(createObjectUrl).toHaveBeenCalledOnce();
      expect(html).toContain('src="./images/patio.png"');
      expect(html).toContain('mdzip-studio-src="./images/patio.png"');
      expect(html).toContain('alt="patio"');
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:studio/patio');

      const rerenderedHtml = await renderer.renderMarkdown('![patio](./images/patio.png)\n\nTyping...', {
        currentPath: 'index.md',
        sourceFormat: 'markdown',
        colorScheme: 'light',
        mode: 'editable',
        manifest: null,
        signal: new AbortController().signal,
      });

      expect(readMarkdownAsset).toHaveBeenCalledOnce();
      expect(createObjectUrl).toHaveBeenCalledOnce();
      expect(rerenderedHtml).toContain('mdzip-studio-src="./images/patio.png"');

      const rerenderedContainer = document.createElement('div');
      rerenderedContainer.innerHTML = rerenderedHtml;
      expect(rerenderedContainer.querySelector('img')?.getAttribute('src')).toBeNull();
      await relativeImages?.mount?.(rerenderedContainer, {
        currentPath: 'index.md',
        sourceFormat: 'markdown',
        colorScheme: 'light',
        mode: 'editable',
        manifest: null,
        signal: new AbortController().signal,
      });

      expect(readMarkdownAsset).toHaveBeenCalledOnce();
      expect(createObjectUrl).toHaveBeenCalledOnce();
      expect(rerenderedContainer.querySelector('img')?.getAttribute('src')).toBe('blob:studio/patio');
    } finally {
      window.mdzipStudio = originalBridge;
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });

  it('honors raw HTML image height and alignment attributes in preview', async () => {
    const imageLayout = component.markdownExtensions.find((extension) =>
      extension.name === 'studio-html-image-layout'
    );
    expect(imageLayout).toBeTruthy();

    const container = document.createElement('div');
    container.innerHTML = '<img src="images/a.png" alt="A" height="300" align="right">';

    await imageLayout?.mount?.(container, {
      currentPath: 'index.md',
      sourceFormat: 'mdz',
      colorScheme: 'light',
      mode: 'editable',
      manifest: null,
      signal: new AbortController().signal,
    });

    const img = container.querySelector('img');
    expect(img?.style.height).toBe('300px');
    expect(img?.style.width).toBe('auto');
    expect(img?.style.cssFloat).toBe('right');
  });

  it('unpacks an MDZip archive into folder entries with relative paths intact', async () => {
    const built = await MdzPackagerCore.buildArchive(
      [
        { path: 'index.md', text: '# Demo\n\n![Photo](images/photo.png)\n' },
        { path: 'images/photo.png', data: new Uint8Array([1, 2, 3]) },
      ],
      'demo',
      {
        createIndex: false,
        mapFiles: false,
        filters: ['**/*'],
        title: 'Demo',
        mode: 'document',
        entryPoint: 'index.md',
      }
    );
    const archiveBytes = new Uint8Array(await built.blob.arrayBuffer());
    interface UnpackWritePayload {
      defaultFolderName: string;
      entries: { path: string; bytes: number[] }[];
    }
    // Captured via a holder object: a plain `let` assigned only inside the mock
    // callback stays narrowed to its `null` initializer at the assertions below.
    const captured: { writePayload: UnpackWritePayload | null } = { writePayload: null };
    const originalBridge = (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio;
    (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = {
      pickMdzForUnpack: vi.fn().mockResolvedValue({
        canceled: false,
        name: 'demo.mdz',
        bytes: Array.from(archiveBytes),
      }),
      writeUnpackedFolder: vi.fn().mockImplementation(async (payload: UnpackWritePayload) => {
        captured.writePayload = payload;
        return { canceled: false, folderPath: 'C:/docs/demo', fileCount: payload.entries.length };
      }),
      showInFolder: vi.fn().mockResolvedValue({ ok: true }),
    };

    try {
      await component.unpackMdzToFolder();

      const writePayload = captured.writePayload;
      expect(writePayload?.defaultFolderName).toBe('demo');
      expect(writePayload?.entries.map((entry) => entry.path).sort()).toEqual([
        'images/photo.png',
        'index.md',
        'manifest.json',
      ]);
      const markdown = new TextDecoder().decode(new Uint8Array(
        writePayload?.entries.find((entry) => entry.path === 'index.md')?.bytes ?? []
      ));
      expect(markdown).toContain('![Photo](images/photo.png)');
      expect(component.statusMessage()).toContain('Unpacked 3 files');
    } finally {
      (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = originalBridge;
    }
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

  it('toggles line numbers through workspace controls', () => {
    component.isDesktopShell.set(true);

    expect(component.showLineNumbers()).toBe(true);
    expect(component.workspaceControls()).toMatchObject({
      lineNumbers: true,
      formatting: { lineBreak: true },
    });

    component.toggleLineNumbers();

    expect(component.showLineNumbers()).toBe(false);
    expect(component.workspaceControls()).toMatchObject({
      lineNumbers: false,
      formatting: { lineBreak: true },
    });
  });

  it('does not treat raw HTML image references as orphaned nav assets', async () => {
    const render = vi.fn();
    const workspace = {
      liveOrphanedPaths: ['images/logo.svg', 'images/unused.png'] as string[] | null,
    };
    Object.defineProperty(component, 'workspaceEditor', {
      configurable: true,
      value: { view: { workspace, render } },
    });

    await (component as unknown as {
      correctWorkspaceOrphansForHtmlImages(snapshot: unknown): Promise<void>;
    }).correctWorkspaceOrphansForHtmlImages({
      sourceFormat: 'mdz',
      currentPath: 'index.md',
      currentPathType: 'markdown',
      currentText: '<img src="images/logo.svg" align="right" width="180" alt="Logo image">',
      content: {
        orphanedAssetPaths: ['images/logo.svg', 'images/unused.png'],
        paths: [
          { path: 'index.md', isImage: false },
          { path: 'images/logo.svg', isImage: true },
          { path: 'images/unused.png', isImage: true },
        ],
      },
      workspace: { manifest: {} },
    });

    expect(workspace.liveOrphanedPaths).toEqual(['images/unused.png']);
    expect(render).toHaveBeenCalledOnce();
  });

  it('seeds orphan state at load so the lazy markdown-only analysis never overwrites it', async () => {
    const render = vi.fn();
    // Fresh load: the editor has not analyzed orphans yet (null state).
    const workspace = { liveOrphanedPaths: null as string[] | null };
    Object.defineProperty(component, 'workspaceEditor', {
      configurable: true,
      value: { view: { workspace, render } },
    });

    await (component as unknown as {
      correctWorkspaceOrphansForHtmlImages(snapshot: unknown): Promise<void>;
    }).correctWorkspaceOrphansForHtmlImages({
      sourceFormat: 'mdz',
      currentPath: 'index.md',
      currentPathType: 'markdown',
      currentText: '<img src="images/star-wars.png" alt="Pasted image" width="250" align="right">',
      content: {
        orphanedAssetPaths: [],
        paths: [
          { path: 'index.md', isImage: false },
          { path: 'images/poster.png', isImage: true },
          { path: 'images/star-wars.png', isImage: true },
        ],
      },
      workspace: { manifest: {} },
    });

    // Seeded (non-null) with the html-aware result: the editor's lazy
    // ensureOrphanedAssetsAnalyzed() only runs while the state is null.
    expect(workspace.liveOrphanedPaths).toEqual(['images/poster.png']);
    expect(render).toHaveBeenCalledOnce();
  });

  it('counts image references from non-open markdown documents when correcting orphans', async () => {
    const render = vi.fn();
    const readPathBytes = vi.fn(async (path: string) =>
      path === 'chapters/two.md'
        ? new TextEncoder().encode('<img src="../images/poster.png" alt="Poster">')
        : undefined
    );
    const workspace = { liveOrphanedPaths: null as string[] | null, readPathBytes };
    Object.defineProperty(component, 'workspaceEditor', {
      configurable: true,
      value: { view: { workspace, render } },
    });

    await (component as unknown as {
      correctWorkspaceOrphansForHtmlImages(snapshot: unknown): Promise<void>;
    }).correctWorkspaceOrphansForHtmlImages({
      sourceFormat: 'mdz',
      currentPath: 'index.md',
      currentPathType: 'markdown',
      currentText: '# No images here',
      content: {
        orphanedAssetPaths: [],
        paths: [
          { path: 'index.md', isImage: false },
          { path: 'chapters/two.md', isImage: false },
          { path: 'images/poster.png', isImage: true },
          { path: 'images/unused.png', isImage: true },
        ],
      },
      workspace: { manifest: {} },
    });

    expect(readPathBytes).toHaveBeenCalledWith('chapters/two.md');
    expect(workspace.liveOrphanedPaths).toEqual(['images/unused.png']);
  });

  it('adds Studio HTML tag highlighting to the mounted editor once', () => {
    const cmEditor = { dispatch: vi.fn() };
    Object.defineProperty(component, 'workspaceEditor', {
      configurable: true,
      value: { view: { cmEditor } },
    });

    (component as unknown as {
      applyStudioHtmlTagHighlightToEditor(): void;
    }).applyStudioHtmlTagHighlightToEditor();
    (component as unknown as {
      applyStudioHtmlTagHighlightToEditor(): void;
    }).applyStudioHtmlTagHighlightToEditor();

    expect(cmEditor.dispatch).toHaveBeenCalledOnce();
    expect(cmEditor.dispatch.mock.calls[0]?.[0]).toHaveProperty('effects');
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

  it('prompts before opening an OS-requested document over dirty work', async () => {
    component.isDesktopShell.set(true);
    openTestArchive('C:/docs/current.mdz');
    component.isDirty.set(true);
    expect(component.needsSave()).toBe(true);

    const setCurrentDocumentPath = vi.fn();
    const originalBridge = (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio;
    (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = {
      setCurrentDocumentPath,
      takePendingOpenDocument: vi.fn().mockResolvedValue({
        canceled: false,
        bytes: Array.from(new TextEncoder().encode('# Next\n')),
        name: 'Next.md',
        filePath: 'C:/docs/Next.md',
        readOnly: false,
      }),
    };

    try {
      const opened = await (component as unknown as {
        requestPendingElectronDocumentOpen(): Promise<boolean>;
      }).requestPendingElectronDocumentOpen();

      expect(opened).toBe(false);
      expect(component.unsavedDialogOpen()).toBe(true);
      expect(component.currentArchive()?.name).toBe('Untitled');
      expect(component.currentArchive()?.path).toBe('C:/docs/current.mdz');
      expect(setCurrentDocumentPath).not.toHaveBeenCalled();

      component.discardUnsavedThenContinue();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      expect(component.unsavedDialogOpen()).toBe(false);
      expect(component.currentArchive()?.name).toBe('Next');
      expect(component.currentArchive()?.path).toBe('C:/docs/Next.md');
      expect(setCurrentDocumentPath).toHaveBeenCalledWith('C:/docs/Next.md');
    } finally {
      (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = originalBridge;
    }
  });

  it('reloads the current file through Studio instead of closing the workspace', async () => {
    component.isDesktopShell.set(true);
    openTestArchive('C:/docs/current.md');
    component.isDirty.set(false);

    const originalBridge = (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio;
    const openDocumentByPath = vi.fn().mockResolvedValue({
      canceled: false,
      bytes: Array.from(new TextEncoder().encode('# Reloaded\n')),
      name: 'current.md',
      filePath: 'C:/docs/current.md',
      readOnly: false,
    });
    const setCurrentDocumentPath = vi.fn();
    (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = {
      openDocumentByPath,
      setCurrentDocumentPath,
    };

    try {
      component.reloadDocumentFromDisk();

      expect(openDocumentByPath).toHaveBeenCalledWith('C:/docs/current.md');
      await vi.waitFor(() => {
        expect(component.currentArchive()?.name).toBe('current');
        expect(component.currentArchive()?.path).toBe('C:/docs/current.md');
        expect(setCurrentDocumentPath).toHaveBeenCalledWith('C:/docs/current.md');
      });
    } finally {
      (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = originalBridge;
    }
  });

  it('suggests the original Markdown folder when saving a converted MDZip', async () => {
    let payload: unknown;
    const originalBridge = (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio;
    (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = {
      saveDocument: vi.fn().mockImplementation(async (nextPayload: unknown) => {
        payload = nextPayload;
        return { canceled: true };
      }),
    };

    try {
      await (component as unknown as {
        openDocumentBytes(
          bytes: Uint8Array,
          name: string,
          filePath?: string,
          readOnly?: boolean,
          recordRecent?: boolean,
        ): Promise<void>;
      }).openDocumentBytes(
        new TextEncoder().encode('# Patio\n'),
        'Patio.md',
        'C:/jobs/patio/Patio.md',
        false,
        false,
      );

      TestBed.inject(ArchiveService).currentArchive.update((archive) =>
        archive ? { ...archive, path: undefined } : archive
      );
      component.sourceFormat.set('mdz');

      await component.saveArchive();

      expect(payload).toMatchObject({
        defaultDirectory: 'C:/jobs/patio',
        defaultName: 'patio.mdz',
        saveAs: false,
      });
    } finally {
      (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = originalBridge;
    }
  });

  it('keeps the reactive workspace bytes current on Save As, so the editor does not reopen on stale content', async () => {
    let savedBytes: number[] | undefined;
    const originalBridge = (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio;
    (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = {
      saveDocument: vi.fn().mockImplementation(async (payload: { bytes: number[] }) => {
        savedBytes = payload.bytes;
        return { canceled: false, filePath: 'C:/jobs/patio/Renamed.mdz', name: 'Renamed.mdz', format: 'mdz' };
      }),
    };

    try {
      await (component as unknown as {
        openDocumentBytes(
          bytes: Uint8Array,
          name: string,
          filePath?: string,
          readOnly?: boolean,
          recordRecent?: boolean,
        ): Promise<void>;
      }).openDocumentBytes(
        new TextEncoder().encode('# Patio\n'),
        'Patio.md',
        'C:/jobs/patio/Patio.md',
        false,
        false,
      );
      component.sourceFormat.set('mdz');

      // `[fileName]` on <mdzip-workspace> is derived from the archive name,
      // so renaming via Save As changes it — which makes the editor reopen
      // from `[bytes]`. workspaceBytes() must reflect what was just saved,
      // not whatever it held before this save.
      await component.saveArchive(true);

      expect(savedBytes).toBeDefined();
      expect(component.currentArchive()?.name).toBe('Renamed');
      expect(Array.from(component.workspaceBytes() ?? [])).toEqual(savedBytes);
    } finally {
      (window as typeof window & { mdzipStudio?: unknown }).mdzipStudio = originalBridge;
    }
  });
});
