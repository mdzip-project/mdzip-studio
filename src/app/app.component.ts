import { Component, computed, effect, ElementRef, NgZone, OnDestroy, signal, VERSION as NG_VERSION, ViewChild } from '@angular/core';
import { APP_VERSION } from './app-version';
import { APP_LICENSE_NAME, APP_LICENSE_TEXT, FIRST_PARTY_LIBRARIES, LibraryInfo, OPEN_SOURCE_LIBRARIES } from './app-about-data';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TabsModule } from 'primeng/tabs';
import { TreeModule } from 'primeng/tree';
import { TreeNode } from 'primeng/api';
import { MdzArchiveCore, MdzManifest, MdzPackagerCore } from '@mdzip/core-js';
import {
  MdzipColorScheme,
  MdzipConversionAction,
  MdzipConversionContext,
  MdzipDocumentChangeEvent,
  MdzipEntryRenderContext,
  MdzipMarkdownRenderContext,
  MdzipMarkdownRenderExtension,
  MdzipWorkspaceChange,
  MdzipWorkspaceSave,
  MdzipWorkspaceSnapshot,
} from '@mdzip/editor';
import { mdzipMermaidExtension } from '@mdzip/editor/mermaid';
import { MdzipEntryRendererDirective, MdzipWorkspaceComponent } from '@mdzip/editor-ng';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideCircleCheck,
  lucideCircleMinus,
  lucideCircleX,
  lucideClock,
  lucideCopy,
  lucideFile,
  lucideFilePen,
  lucideFolder,
  lucideFolderOpen,
  lucideImage,
  lucideLayoutGrid,
  lucideList,
  lucideDownload,
  lucideInfo,
  lucidePlus,
  lucideSave,
  lucideSaveAll,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';
import { ArchiveService, Asset, Document, Manifest, MDZipArchive } from './core/services/archive.service';
import { StorageService } from './core/services/storage.service';
import { ValidationError, ValidationService } from './core/services/validation.service';
import {
  ManifestEditorChange,
  ManifestEditorComponent,
} from './modules/manifest/manifest-editor.component';

type AssetViewMode = 'tiles' | 'list';
type ArchiveTreeKind = 'folder' | 'document' | 'asset';
type SaveValidationState = 'unchecked' | 'valid' | 'invalid';

interface ElectronDocumentOpenResult {
  canceled: boolean;
  filePath?: string;
  name?: string;
  bytes?: number[];
  readOnly?: boolean;
  error?: string;
}

interface ElectronDocumentSaveResult {
  canceled: boolean;
  filePath?: string;
  name?: string;
  format?: 'markdown' | 'mdz';
}

interface ElectronMarkdownImageResult {
  filePath: string;
  relativePath: string;
}

interface MarkdownDefaultStatus {
  supported: boolean;
  isDefault: boolean;
}

interface ElectronFolderFile {
  path: string;
  bytes: Uint8Array | number[];
}

// Path-only scan (no file contents) returned by the folder picker — like the
// browser's webkitdirectory listing. manifestText pre-fills the option fields.
interface ElectronPickFolderResult {
  canceled: boolean;
  folderPath?: string;
  folderName?: string;
  paths?: string[];
  manifestText?: string | null;
}

interface ElectronReadFolderResult {
  files?: ElectronFolderFile[];
}

interface PackFolderProgress {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

interface FolderFile {
  path: string;
  bytes: Uint8Array;
}

// Rough DEFLATE throughput used only to estimate the packing-step duration for
// the progress bar (buildArchive gives no real progress). ~25 MB/s; the bar
// caps at 95% so an under-estimate just holds near the end rather than lying.
const PACK_BYTES_PER_MS = (25 * 1024 * 1024) / 1000;

type PackMode = 'document' | 'project';

// Where the to-be-packed files come from. Both keep the full path list up front
// (no contents); only files matching the include-filters are read at build.
type PackSource =
  | { kind: 'electron' }
  | { kind: 'browser'; entries: { path: string; file: File }[] };

interface ElectronBridge {
  isElectron?: boolean;
  platform?: string;
  arch?: string;
  versions?: {
    electron?: string;
    chrome?: string;
    node?: string;
    v8?: string;
  };
  openDocument?: () => Promise<ElectronDocumentOpenResult>;
  openDocumentByPath?: (filePath: string) => Promise<ElectronDocumentOpenResult>;
  setRecentFiles?: (paths: string[]) => void;
  setDocumentOpen?: (open: boolean) => void;
  pickFolder?: () => Promise<ElectronPickFolderResult>;
  readFolder?: (payload: { paths: string[] }) => Promise<ElectronReadFolderResult>;
  onPackFolderProgress?: (callback: (data: PackFolderProgress) => void) => () => void;
  takePendingOpenDocument?: () => Promise<ElectronDocumentOpenResult>;
  onOpenDocumentRequested?: (callback: () => void) => () => void;
  saveDocument?: (payload: {
    filePath?: string;
    defaultName: string;
    bytes: number[];
    mdzBytes?: number[];
    saveAs: boolean;
  }) => Promise<ElectronDocumentSaveResult>;
  writeMarkdownImage?: (payload: {
    documentPath: string;
    relativeDirectory: string;
    fileName: string;
    bytes: number[];
  }) => Promise<ElectronMarkdownImageResult>;
  readMarkdownAsset?: (payload: {
    documentPath: string;
    relativePath: string;
  }) => Promise<{ dataUri?: string; error?: string }>;
  showInFolder?: (filePath: string) => Promise<{ ok?: boolean; error?: string }>;
  getMarkdownDefaultStatus?: () => Promise<MarkdownDefaultStatus>;
  promptMarkdownDefault?: () => Promise<MarkdownDefaultStatus>;
}

declare global {
  interface Window {
    mdzipStudio?: ElectronBridge;
  }
}
interface ArchiveTreeData {
  kind: ArchiveTreeKind;
  path: string;
  document?: Document;
  asset?: Asset;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    TabsModule,
    TreeModule,
    ManifestEditorComponent,
    MdzipEntryRendererDirective,
    MdzipWorkspaceComponent,
    NgIconComponent,
  ],
  providers: [
    provideIcons({
      lucideCheck,
      lucideCircleCheck,
      lucideCircleMinus,
      lucideCircleX,
      lucideClock,
      lucideCopy,
      lucideDownload,
      lucideFile,
      lucideFilePen,
      lucideFolder,
      lucideFolderOpen,
      lucideImage,
      lucideInfo,
      lucideLayoutGrid,
      lucideList,
      lucidePlus,
      lucideSave,
      lucideSaveAll,
      lucideTrash2,
      lucideX,
    }),
  ],
  template: `
    <main class="app-shell">
      @if (packProgress()) {
        <div class="loading-overlay" aria-live="polite" aria-label="Packing folder">
          <div class="loading-spinner"></div>
          <span>{{ packProgressLabel() }}</span>
          <div class="progress-track"><div class="progress-fill" [style.width.%]="packProgressPercent()"></div></div>
          <span class="progress-detail">{{ packProgressDetail() }}</span>
        </div>
      } @else if (isLoading()) {
        <div class="loading-overlay" aria-live="polite" aria-label="Opening document...">
          <div class="loading-spinner"></div>
          <span>Opening...</span>
        </div>
      }
      <header class="app-chrome">
        @if (!isDesktopShell()) {
        <div class="menubar">
          <div class="menubar-brand">
            <picture>
              <source srcset="assets/mdzip-mark/mdzip-mark-square-dark.svg" media="(prefers-color-scheme: dark)" />
              <img class="brand-icon" src="assets/mdzip-mark/mdzip-mark-square.svg" alt="" />
            </picture>
            <span class="doc-title">{{ documentTitleDisplay() || 'MDZip Studio' }}</span>
          </div>
          <nav class="menu-nav">
            <div class="menu-root" (click)="$event.stopPropagation(); toggleMenu('file')" (mouseenter)="hoverMenu('file')">
              <button class="menu-root-btn" type="button" [class.active]="openMenu() === 'file'">File</button>
              @if (openMenu() === 'file') {
                <ul class="menu-popup" role="menu" (click)="$event.stopPropagation()">
                  <li role="none"><button class="menu-item" type="button" role="menuitem" (click)="newArchive(); closeMenu()"><ng-icon name="lucidePlus" size="13" /><span>New</span><kbd>Ctrl+N</kbd></button></li>
                  <li role="none"><button class="menu-item" type="button" role="menuitem" (click)="openFilePicker(); closeMenu()"><ng-icon name="lucideFolderOpen" size="13" /><span>Open...</span><kbd>Ctrl+O</kbd></button></li>
                  <li role="none"><button class="menu-item" type="button" role="menuitem" (click)="packFolder(); closeMenu()"><ng-icon name="lucideFolder" size="13" /><span>Pack Folder to .mdz...</span></button></li>
                  <li class="menu-sep" role="separator"></li>
                  @if (isDesktopShell()) {
                    <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!currentArchive()" (click)="saveArchive(); closeMenu()"><ng-icon name="lucideSave" size="13" /><span>Save</span><kbd>Ctrl+S</kbd></button></li>
                    <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!currentArchive()" (click)="saveArchive(true); closeMenu()"><ng-icon name="lucideSaveAll" size="13" /><span>Save As...</span><kbd>Ctrl+Shift+S</kbd></button></li>
                  } @else {
                    <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!currentArchive()" (click)="saveArchive(); closeMenu()"><ng-icon name="lucideDownload" size="13" /><span>Download</span><kbd>Ctrl+S</kbd></button></li>
                  }
                  @if (isDesktopShell()) {
                    <li class="menu-sep" role="separator"></li>
                    <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!hasFileOnDisk()" (click)="showInFileManager()"><ng-icon name="lucideFolderOpen" size="13" /><span>Show in File Manager</span></button></li>
                  }
                  <li class="menu-sep" role="separator"></li>
                  <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!currentArchive()" (click)="closeDocument(); closeMenu()"><ng-icon name="lucideX" size="13" /><span>Close Document</span><kbd>Ctrl+W</kbd></button></li>
                  <li class="menu-sep" role="separator"></li>
                  <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!currentArchive()" (click)="exportDraft(); closeMenu()"><span></span><span>Export Draft...</span></button></li>
                </ul>
              }
            </div>
            <div class="menu-root" (click)="$event.stopPropagation(); toggleMenu('help')" (mouseenter)="hoverMenu('help')">
              <button class="menu-root-btn" type="button" [class.active]="openMenu() === 'help'">Help</button>
              @if (openMenu() === 'help') {
                <ul class="menu-popup" role="menu" (click)="$event.stopPropagation()">
                  <li role="none"><button class="menu-item" type="button" role="menuitem" (click)="showAbout(); closeMenu()"><ng-icon name="lucideInfo" size="13" /><span>About MDZip Studio</span></button></li>
                </ul>
              }
            </div>
          </nav>
          <div class="menubar-spacer"></div>
          @if (currentArchive()) {
            <span class="menubar-status" [class.valid]="saveValidationState() === 'valid'" [class.invalid]="saveValidationState() === 'invalid'">
              <ng-icon [name]="saveValidationState() === 'valid' ? 'lucideCircleCheck' : saveValidationState() === 'invalid' ? 'lucideCircleX' : 'lucideCircleMinus'" size="12"></ng-icon>
              {{ saveValidationLabel() }}
            </span>
          }
        </div>
        }
        <div class="toolbar">
          <button class="tb-btn" type="button" title="New (Ctrl+N)" (click)="newArchive()"><ng-icon name="lucidePlus" size="15" /></button>
          <button class="tb-btn" type="button" title="Open (Ctrl+O)" (click)="openFilePicker()"><ng-icon name="lucideFolderOpen" size="15" /></button>
          @if (isDesktopShell()) {
            <button class="tb-btn" type="button" [title]="readOnly() ? readOnlyHint : (needsSave() ? 'Save — you have unsaved changes (Ctrl+S)' : 'Saved (Ctrl+S)')" [disabled]="!currentArchive() || readOnly() || !needsSave()" (click)="saveArchive()"><ng-icon name="lucideSave" size="15" />@if (needsSave()) {<span class="tb-dot"></span>}</button>
          } @else {
            <button class="tb-btn" type="button" [title]="needsSave() ? 'Download — you have unsaved changes (Ctrl+S)' : 'Saved (Ctrl+S)'" [disabled]="!currentArchive() || !needsSave()" (click)="saveArchive()"><ng-icon name="lucideDownload" size="15" />@if (needsSave()) {<span class="tb-dot"></span>}</button>
          }
        </div>
        <input #fileInput class="file-input" type="file" accept=".md,.mdz,.json,text/markdown,application/json" (change)="openArchive($event)" />
        <input #assetInput class="file-input" type="file" multiple accept="image/*,video/*,audio/*,application/pdf,.svg" (change)="onAssetFileSelected($event)" />
        <input #markdownImageInput class="file-input" type="file" accept="image/*,.svg" (change)="onMarkdownImageSelected($event)" />
        <input #folderInput class="file-input" type="file" webkitdirectory (change)="onFolderInputSelected($event)" />
      </header>

      <section class="workspace">
        <section class="content">
          @if (!currentArchive()) {
            <div class="empty-state">
              <h2>Create or open a document</h2>
              <p>Write, add images, and save everything together in one portable file.</p>
              <div class="empty-actions">
                <p-button label="New Markdown (.md)" (onClick)="newArchive('markdown')">
                  <ng-template #icon><ng-icon name="lucidePlus" size="14" /></ng-template>
                </p-button>
                <p-button label="New MDZip (.mdz)" (onClick)="newArchive('mdz')">
                  <ng-template #icon><ng-icon name="lucidePlus" size="14" /></ng-template>
                </p-button>
                <p-button label="Open Document" severity="secondary" (onClick)="openFilePicker()">
                  <ng-template #icon><ng-icon name="lucideFolderOpen" size="14" /></ng-template>
                </p-button>
              </div>
              @if (recentFiles().length > 0) {
                <div class="recent-files">
                  <div class="recent-header">
                    <h3>Recent</h3>
                    <button class="recent-clear" type="button" (click)="clearRecentFiles()">Clear</button>
                  </div>
                  <div class="recent-list">
                    @for (path of recentFiles(); track path) {
                      <div class="recent-item">
                        <button class="recent-open" type="button" (click)="openRecent(path)" [title]="path">
                          <ng-icon name="lucideClock" size="14" />
                          <div class="recent-meta">
                            <span class="recent-name">{{ recentDisplayName(path) }}</span>
                            <span class="recent-path">{{ recentFilePath(path) }}</span>
                          </div>
                        </button>
                        <button class="recent-remove" type="button" (click)="removeRecent(path)" title="Remove from recent" aria-label="Remove from recent">
                          <ng-icon name="lucideX" size="14" />
                        </button>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }

          @if (currentArchive()) {
            <section class="panel workspace-panel">
              <mdzip-workspace
                #workspaceEditor
                [bytes]="workspaceBytes()"
                [fileName]="workspaceFileName()"
                mode="editable"
                [sourceFormat]="sourceFormat()"
                [controls]="workspaceControls()"
                [markdownExtensions]="markdownExtensions"
                [onConversionRequested]="handleConversionRequested"
                initialLayout="split"
                [navigationButtonActive]="navigationActive()"
                (changed)="onWorkspaceChanged($event)"
                (manifestChanged)="onWorkspaceManifestChanged($event)"
                (dirtyChanged)="onWorkspaceDirtyChanged($event)"
                (saved)="onWorkspaceSaved($event)"
                (failed)="onWorkspaceFailed($event)"
              >
                <ng-template
                  mdzipEntryRenderer="manifest.json"
                  mdzipEntryRendererId="mdzip-studio-manifest"
                  [mdzipEntryRendererPriority]="100"
                  let-context
                >
                  <section class="studio-entry-view">
                    <div class="studio-entry-view-header">
                      <div>
                        <h2>Document Internals</h2>
                        <p>Structured manifest settings provided by MDZip Studio.</p>
                      </div>
                    </div>
                    <app-manifest-editor
                      [title]="entryManifestTitle(context)"
                      [author]="entryManifestText(context, 'author')"
                      [description]="entryManifestText(context, 'description')"
                      [mode]="entryManifestMode(context)"
                      [version]="entryManifestVersion(context)"
                      [entryPoint]="entryManifestEntryPoint(context)"
                      [documents]="documentPaths()"
                      (fieldChange)="onEmbeddedManifestChange(context, $event)"
                    />
                  </section>
                </ng-template>
              </mdzip-workspace>
            </section>
          }
        </section>
      </section>

      <footer class="statusbar">
        <span [class.statusbar-url]="isHoveringLink()">{{ displayStatus() }}</span>
        <span class="statusbar-version">v{{ appVersion }}</span>
      </footer>
    </main>

    <p-dialog [header]="newArchiveFormat() === 'mdz' ? 'New MDZip Document' : 'New Markdown Document'" [visible]="newDialogOpen()" (visibleChange)="newDialogOpen.set($event)" [modal]="true" [style]="{ width: 'min(92vw, 440px)' }">
      <div class="dialog-form">
        <label>
          Name
          <input type="text" [(ngModel)]="newArchiveName" autofocus />
          <small>Saves as {{ (newArchiveName.trim() || 'Untitled') }}{{ newArchiveFormat() === 'mdz' ? '.mdz' : '.md' }}</small>
        </label>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="newDialogOpen.set(false)" />
        <p-button label="Create" (onClick)="createArchiveFromDialog()">
          <ng-template #icon><ng-icon name="lucidePlus" size="14" /></ng-template>
        </p-button>
      </ng-template>
    </p-dialog>

    <p-dialog header="Unsaved changes" [visible]="unsavedDialogOpen()" (visibleChange)="onUnsavedDialogVisibleChange($event)" [modal]="true" [style]="{ width: 'min(92vw, 440px)' }">
      <p class="unsaved-message">You have unsaved changes to <strong>{{ currentArchive()?.name || 'this document' }}</strong>. Do you want to save them before continuing?</p>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="cancelUnsavedDialog()" />
        <p-button label="Don't Save" severity="secondary" (onClick)="discardUnsavedThenContinue()" />
        <p-button [label]="readOnly() ? 'Save As...' : 'Save'" (onClick)="saveUnsavedThenContinue()">
          <ng-template #icon><ng-icon name="lucideSave" size="14" /></ng-template>
        </p-button>
      </ng-template>
    </p-dialog>

    <p-dialog header="Pack Folder to .mdz" [visible]="packFolderDialogOpen()" (visibleChange)="packFolderDialogOpen.set($event)" [modal]="true" [style]="{ width: 'min(92vw, 560px)' }">
      <div class="dialog-form">
        <p>Packaging <strong>{{ packFolderName() }}</strong> — {{ packFileCount() }} file{{ packFileCount() === 1 ? '' : 's' }} found. Only files matching the include filters are added.</p>
        <label class="full-width">
          Include filters <small>(one glob per line)</small>
          <textarea class="pack-filters" [ngModel]="packFilters()" (ngModelChange)="packFilters.set($event)" rows="6" spellcheck="false"></textarea>
        </label>
        <div class="pack-fields">
          <label>
            Mode
            <select [ngModel]="packMode()" (ngModelChange)="packMode.set($any($event))">
              <option value="document">Document — open in memory</option>
              <option value="project">Project — save to disk first</option>
            </select>
          </label>
          <label>
            Entry point
            <select [ngModel]="packEntryPoint()" (ngModelChange)="packEntryPoint.set($event)">
              <option value="">auto-detect</option>
              @for (path of packEntryOptions(); track path) {
                <option [value]="path">{{ path }}</option>
              }
            </select>
          </label>
          <label>
            Title
            <input type="text" [ngModel]="packTitle()" (ngModelChange)="packTitle.set($event)" placeholder="Optional" />
          </label>
          <label>
            Author
            <input type="text" [ngModel]="packAuthor()" (ngModelChange)="packAuthor.set($event)" placeholder="Optional" />
          </label>
          <label class="full-width">
            Description
            <input type="text" [ngModel]="packDescription()" (ngModelChange)="packDescription.set($event)" placeholder="Optional" />
          </label>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="packFolderDialogOpen.set(false)" />
        <p-button label="Pack" (onClick)="confirmPackFolder()">
          <ng-template #icon><ng-icon name="lucideFolder" size="14" /></ng-template>
        </p-button>
      </ng-template>
    </p-dialog>

    <p-dialog header="Convert to MDZip" [visible]="convertDialogOpen()" (visibleChange)="onConvertDialogVisibleChange($event)" [modal]="true" [style]="{ width: 'min(92vw, 460px)' }">
      <div class="dialog-form">
        <p>Convert this Markdown document into an MDZip archive? Its relative images are embedded so the archive is self-contained.</p>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="cancelConvertToMdz()" />
        <p-button label="Convert" (onClick)="confirmConvertToMdz()" />
      </ng-template>
    </p-dialog>

    <p-dialog
      header="Add Image"
      [visible]="imageDestinationDialogOpen()"
      (visibleChange)="onImageDestinationDialogVisibleChange($event)"
      [modal]="true"
      [style]="{ width: 'min(92vw, 520px)' }"
    >
      <div class="image-destination-dialog">
        <p>Choose how this image should be stored.</p>

        <button
          type="button"
          class="destination-option"
          [disabled]="!canWriteLinkedMarkdownImage()"
          (click)="chooseMarkdownImageDestination('same')"
        >
          <strong>Put file in same folder</strong>
          <span>Copy the image beside the Markdown file and insert a relative link.</span>
        </button>

        <div class="destination-option destination-subfolder" [class.disabled]="!canWriteLinkedMarkdownImage()">
          <button
            type="button"
            [disabled]="!canWriteLinkedMarkdownImage() || !isValidImageSubfolder()"
            (click)="chooseMarkdownImageDestination('subfolder')"
          >
            <strong>Put file in subfolder</strong>
            <span>Create or use a folder beside the Markdown file.</span>
          </button>
          <label>
            Subfolder name
            <input
              type="text"
              [ngModel]="imageSubfolder()"
              (ngModelChange)="imageSubfolder.set($event)"
              placeholder="images"
              [disabled]="!canWriteLinkedMarkdownImage()"
            />
          </label>
        </div>

        <button type="button" class="destination-option" (click)="convertMarkdownForImage()">
          <strong>Convert to .mdz</strong>
          <span>Embed the image in a portable MDZip document.</span>
        </button>

        @if (!canWriteLinkedMarkdownImage()) {
          <p class="destination-note">Save this Markdown file to disk before placing linked images beside it.</p>
        }
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="cancelImageDestination()" />
      </ng-template>
    </p-dialog>

    <p-dialog header="About MDZip Studio" [visible]="aboutOpen()" (visibleChange)="aboutOpen.set($event)" [modal]="true" [style]="{ width: 'min(92vw, 640px)' }">
      <p-tabs [value]="aboutTab()" (valueChange)="aboutTab.set($any($event))">
        <p-tablist>
          <p-tab value="about">About</p-tab>
          <p-tab value="libraries">Libraries</p-tab>
          <p-tab value="license">License</p-tab>
          <p-tab value="debug">Debug</p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="about">
            <div class="about-dialog">
              <picture>
                <source srcset="assets/mdzip-mark/mdzip-mark-square-dark.svg" media="(prefers-color-scheme: dark)" />
                <img class="about-mark" src="assets/mdzip-mark/mdzip-mark-square.svg" alt="MDZip" />
              </picture>
              <div class="about-body">
                <h2>MDZip Studio</h2>
                <p class="about-version">Version {{ appVersion }}</p>
                <p>A Markdown editor that saves as <strong>MDZip</strong> when you need it - portable documents with embedded images and assets. It uses CommonMark-based editing, GFM-style preview rendering, HTML sanitization, highlighted fenced code blocks, and inline Mermaid diagrams.</p>
                <div class="about-links">
                  <a href="https://mdzip.org" target="_blank" rel="noopener">mdzip.org</a>
                  <a href="https://github.com/mdzip-project" target="_blank" rel="noopener">GitHub</a>
                </div>
              </div>
            </div>
          </p-tabpanel>
          <p-tabpanel value="libraries">
            <div class="about-tab-scroll">
              <p class="about-section-note">MDZip Studio is built with these open source libraries. Thank you to their authors and contributors.</p>
              <h3 class="about-section-title">MDZip Libraries</h3>
              <table class="library-table">
                <thead>
                  <tr><th>Library</th><th>Version</th><th>License</th></tr>
                </thead>
                <tbody>
                  @for (lib of firstPartyLibraries; track lib.name) {
                    <tr>
                      <td><a [href]="lib.homepage" target="_blank" rel="noopener">{{ lib.name }}</a></td>
                      <td>{{ lib.version }}</td>
                      <td>{{ lib.license }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <h3 class="about-section-title">Third-Party Libraries</h3>
              <table class="library-table">
                <thead>
                  <tr><th>Library</th><th>Version</th><th>License</th></tr>
                </thead>
                <tbody>
                  @for (lib of openSourceLibraries; track lib.name) {
                    <tr>
                      <td><a [href]="lib.homepage" target="_blank" rel="noopener">{{ lib.name }}</a></td>
                      <td>{{ lib.version }}</td>
                      <td>{{ lib.license }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </p-tabpanel>
          <p-tabpanel value="license">
            <div class="about-tab-scroll">
              <p class="about-section-note">MDZip Studio is released under the {{ appLicenseName }} license.</p>
              <pre class="license-text">{{ appLicenseText }}</pre>
            </div>
          </p-tabpanel>
          <p-tabpanel value="debug">
            <div class="about-tab-scroll">
              <div class="debug-header">
                <p class="about-section-note">Detailed version information for bug reports.</p>
                <p-button [label]="debugCopied() ? 'Copied' : 'Copy'" severity="secondary" size="small" (onClick)="copyDebugInfo()">
                  <ng-template #icon><ng-icon [name]="debugCopied() ? 'lucideCheck' : 'lucideCopy'" size="13" /></ng-template>
                </p-button>
              </div>
              <table class="library-table debug-table">
                <tbody>
                  @for (entry of debugInfo(); track entry.label) {
                    <tr>
                      <td>{{ entry.label }}</td>
                      <td>{{ entry.value }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
      <ng-template pTemplate="footer">
        <p-button label="Close" (onClick)="aboutOpen.set(false)" />
      </ng-template>
    </p-dialog>

    <p-dialog header="Default Markdown editor" [visible]="mdDefaultPromptOpen()" (visibleChange)="mdDefaultPromptOpen.set($event)" [modal]="true" [closable]="!mdDefaultBusy()" [style]="{ width: 'min(92vw, 460px)' }">
      <div class="dialog-form">
        <p>Make MDZip Studio the default app for opening <strong>.md</strong> files? Windows will ask you to confirm the choice.</p>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Not now" severity="secondary" [text]="true" [disabled]="mdDefaultBusy()" (onClick)="dismissMarkdownDefaultPrompt()" />
        <p-button label="Set as Default" [loading]="mdDefaultBusy()" (onClick)="setMarkdownDefault()" />
      </ng-template>
    </p-dialog>
  `,
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnDestroy {
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('assetInput') private assetInput?: ElementRef<HTMLInputElement>;
  @ViewChild('markdownImageInput') private markdownImageInput?: ElementRef<HTMLInputElement>;
  @ViewChild('folderInput') private folderInput?: ElementRef<HTMLInputElement>;
  @ViewChild('workspaceEditor') private workspaceEditor?: MdzipWorkspaceComponent;

  readonly currentArchive = this.archiveService.currentArchive;
  readonly isDesktopShell = signal(Boolean(window.mdzipStudio?.isElectron));
  readonly documents = this.archiveService.documents;
  readonly assets = this.archiveService.assets;
  readonly selectedDocumentId = signal<string | null>(null);
  readonly selectedAssetId = signal<string | null>(null);
  readonly assetViewMode = signal<AssetViewMode>('tiles');
  readonly statusMessage = signal('Ready');
  private readonly hoverUrl = signal<string | null>(null);
  readonly displayStatus = computed(() => this.hoverUrl() ?? this.statusMessage());
  readonly isHoveringLink = computed(() => this.hoverUrl() !== null);
  readonly validationIssues = signal<ValidationError[]>([]);
  readonly saveValidationState = signal<SaveValidationState>('unchecked');
  readonly recentFiles = signal<string[]>(this.storageService.getRecentFiles());
  readonly recentTitles = signal<Record<string, string>>(this.storageService.getRecentTitles());
  readonly workspaceBytes = signal<Uint8Array | null>(null);
  // Whether the workspace nav pane starts open. Off by default; turned on when
  // a packed folder opens, since those archives benefit from the file tree.
  readonly navigationActive = signal(false);
  readonly workspaceFileName = computed(() => {
    const archive = this.currentArchive();
    const name = archive ? this.toSafeFilename(archive.name) : 'document';
    return this.sourceFormat() === 'markdown' ? `${name}.md` : `${name}.mdz`;
  });
  readonly latestWorkspaceBytes = signal<Uint8Array | null>(null);
  readonly latestWorkspaceSnapshot = signal<MdzipWorkspaceSnapshot | null>(null);
  readonly documentTree = computed(() =>
    this.buildTree(this.documents(), 'document')
  );
  readonly assetTree = computed(() =>
    this.buildTree(this.assets(), 'asset')
  );
  readonly selectedDocumentTreeNode = computed(() =>
    this.findTreeNode(this.documentTree(), (node) => node.data?.document?.id === this.selectedDocumentId())
  );
  readonly selectedAssetTreeNode = computed(() =>
    this.findTreeNode(this.assetTree(), (node) => node.data?.asset?.id === this.selectedAssetId())
  );
  readonly selectedDocument = computed(() => {
    const selectedId = this.selectedDocumentId();
    return this.documents().find((document) => document.id === selectedId) ?? this.documents()[0];
  });
  readonly selectedDocumentName = computed(() => this.selectedDocument()?.name ?? 'No document selected');
  readonly documentTitle = computed(() => this.currentArchive()?.name ?? '');
  // True when the opened file carries the OS read-only attribute. The app does
  // not clear it; the user must do so in the OS and reopen to edit/save.
  readonly readOnly = signal(false);
  readonly readOnlyHint = 'This file is read-only. Use "Save As" to save your changes to a new file, or clear the read-only attribute in your operating system and reopen it to edit in place.';
  readonly documentTitleDisplay = computed(() => {
    const name = this.documentTitle();
    return name && this.readOnly() ? `${name} (read-only)` : name;
  });
  readonly manifestDraft = computed(() => this.currentArchive()?.manifest ?? null);
  readonly documentPaths = computed(() => this.documents().map((document) => document.name));
  readonly validationSummary = computed(() => {
    const issueCount = this.validationIssues().length;
    if (this.saveValidationState() === 'unchecked') return 'Checks will run the next time you save.';
    if (issueCount === 0) return 'No technical issues reported.';
    return `${issueCount} issue${issueCount === 1 ? '' : 's'} found.`;
  });
  readonly saveValidationLabel = computed(() => {
    switch (this.saveValidationState()) {
      case 'valid':
        return 'Saved checks passed';
      case 'invalid':
        return 'Needs attention';
      default:
        return 'Not checked';
    }
  });

  readonly openMenu = signal<string | null>(null);
  readonly sourceFormat = signal<'markdown' | 'mdz'>('markdown');
  readonly workspaceControls = computed(() =>
    this.isDesktopShell()
      ? { preset: 'hosted-editor' as const, title: false }
      : 'hosted-editor'
  );

  // Mermaid render extension (lazy-loads the mermaid library only when a
  // document actually contains a ```mermaid block). theme: 'auto' follows the
  // editor's color scheme. Stable reference: the workspace diffs extensions by name.
  // Disk path of the currently open plain-Markdown file, and a per-document
  // cache of inlined sibling images. Used to render relative `![](./img.png)`
  // references that the renderer can't resolve against its own origin.
  private currentMarkdownPath: string | null = null;
  // Data-URI cache for a .md's relative images, keyed by archive path. Used to
  // recover bytes when embedding images on conversion/save.
  private readonly mdAssetCache = new Map<string, string>();
  // Preview cache of blob: object URLs for the same images. The preview re-runs
  // on every keystroke, so it must reference short, stable URLs the browser can
  // decode once and reuse — inlining multi-MB data URIs re-decoded every image
  // on each render and made typing laggy. Revoked when the cache is cleared.
  private readonly mdPreviewUrlCache = new Map<string, string>();
  readonly markdownExtensions: readonly MdzipMarkdownRenderExtension[] = [
    mdzipMermaidExtension(),
    {
      name: 'studio-relative-images',
      transformHtml: (html, context) => this.inlineRelativeMarkdownImages(html, context),
    },
  ];

  readonly appVersion = APP_VERSION;
  readonly newDialogOpen = signal(false);
  // True while the editor holds unsaved edits, driven by the workspace's
  // (dirtyChanged) event. Powers the Save button's emphasis and the
  // unsaved-changes guard on close/new/open.
  readonly isDirty = signal(false);
  // Unsaved-changes confirmation. `pendingDiscardAction` is the close/new/open
  // the user was attempting; it runs only after they Save or choose Don't Save.
  readonly unsavedDialogOpen = signal(false);
  private pendingDiscardAction: (() => void) | null = null;
  // Folder→.mdz packing state (issue #2). Modeled on mdzip.org/packager.html:
  // a path-only scan shows the options instantly; only files matching the
  // include-filters are read at build time.
  readonly packFolderDialogOpen = signal(false);
  readonly packFolderName = signal('');
  readonly packFileCount = signal(0);
  readonly packFilters = signal(MdzPackagerCore.DEFAULT_FILTERS.join('\n'));
  readonly packMode = signal<PackMode>('document');
  readonly packTitle = signal('');
  readonly packEntryPoint = signal('');
  readonly packAuthor = signal('');
  readonly packDescription = signal('');
  readonly packEntryOptions = signal<string[]>([]);
  private packAllPaths: string[] = [];
  private pendingPackSource: PackSource | null = null;
  // Folder read/pack progress overlay (null when idle).
  readonly packProgress = signal<{ phase: 'reading' | 'packing'; done: number; total: number; bytesDone: number; bytesTotal: number } | null>(null);
  private packStartMs = 0;
  // Estimated duration (ms) of the CPU-bound packing step. buildArchive exposes
  // no real progress, so we drive the packing bar from elapsed/this estimate.
  private packEstMs = 0;
  readonly packProgressPercent = computed(() => {
    const p = this.packProgress();
    if (!p || p.bytesTotal === 0) return 0;
    return Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100));
  });
  readonly packProgressLabel = computed(() => {
    const p = this.packProgress();
    if (!p) return '';
    return p.phase === 'packing'
      ? `Packing… ${this.packProgressPercent()}%`
      : `Reading files… ${this.packProgressPercent()}%`;
  });
  readonly packProgressDetail = computed(() => {
    const p = this.packProgress();
    if (!p) return '';
    const eta = this.packEtaText();
    if (p.phase === 'packing') return `compressing • ${eta || 'estimating…'}`;
    return `${p.done}/${p.total} files${eta ? ` • ${eta}` : ''}`;
  });
  newArchiveName = 'Untitled';
  newArchiveMode: 'document' | 'project' = 'document';
  readonly newArchiveFormat = signal<'markdown' | 'mdz'>('markdown');
  readonly aboutOpen = signal(false);
  readonly aboutTab = signal<'about' | 'libraries' | 'license' | 'debug'>('about');
  readonly debugCopied = signal(false);
  readonly mdDefaultPromptOpen = signal(false);
  readonly mdDefaultBusy = signal(false);
  private static readonly MD_DEFAULT_PROMPT_KEY = 'mdDefaultPromptSeen';
  readonly imageDestinationDialogOpen = signal(false);
  // Confirmation before converting a Markdown doc to .mdz (nav-button path).
  // A deliberate seam for a future options dialog (title, subfolder, mode…).
  readonly convertDialogOpen = signal(false);
  readonly imageSubfolder = signal('images');
  readonly canWriteLinkedMarkdownImage = computed(() =>
    Boolean(this.currentArchive()?.path && window.mdzipStudio?.writeMarkdownImage)
  );
  readonly isValidImageSubfolder = computed(() => {
    const name = this.imageSubfolder().trim();
    return Boolean(name)
      && name !== '.'
      && name !== '..'
      && !/[<>:"/\\|?*\x00-\x1f]/.test(name);
  });
  readonly firstPartyLibraries: LibraryInfo[] = FIRST_PARTY_LIBRARIES;
  readonly openSourceLibraries: LibraryInfo[] = OPEN_SOURCE_LIBRARIES;
  readonly appLicenseName = APP_LICENSE_NAME;
  readonly appLicenseText = APP_LICENSE_TEXT;
  readonly debugInfo = computed(() => {
    const bridge = window.mdzipStudio;
    const entries: Array<{ label: string; value: string }> = [
      { label: 'MDZip Studio', value: APP_VERSION },
      { label: 'Shell', value: this.isDesktopShell() ? 'Electron (desktop)' : 'Browser' },
      ...this.firstPartyLibraries.map((lib) => ({ label: lib.name, value: lib.version })),
      { label: 'Angular', value: NG_VERSION.full },
    ];
    if (bridge?.versions) {
      entries.push(
        { label: 'Electron', value: bridge.versions.electron ?? 'unknown' },
        { label: 'Chromium', value: bridge.versions.chrome ?? 'unknown' },
        { label: 'Node.js', value: bridge.versions.node ?? 'unknown' },
        { label: 'V8', value: bridge.versions.v8 ?? 'unknown' },
      );
    }
    entries.push(
      { label: 'Platform', value: bridge?.platform ? `${bridge.platform}${bridge.arch ? ` (${bridge.arch})` : ''}` : navigator.platform || 'unknown' },
      { label: 'Language', value: navigator.language },
      { label: 'User agent', value: navigator.userAgent },
    );
    return entries;
  });
  readonly isLoading = signal(false);
  private workspaceLoadPending = false;
  private workspaceLoadTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pendingConversionAction: MdzipConversionAction | null = null;
  private pendingConversionContext: MdzipConversionContext | null = null;
  // One-shot status held across the conversion's own re-render (see onWorkspaceChanged).
  private postConvertStatus: string | null = null;
  private pendingMarkdownImageDestination: 'same' | 'subfolder' | 'mdz' | null = null;
  private removeOpenDocumentRequestedListener: (() => void) | null = null;
  private pendingElectronOpen: Promise<boolean> | null = null;
  private electronOpenRequestedWhilePending = false;

  readonly handleConversionRequested = (
    action: MdzipConversionAction,
    context: MdzipConversionContext
  ): boolean => {
    this.pendingConversionContext = context;
    if (action.kind === 'navigation') {
      // The nav button needs an archive. Show our own convert prompt (the future
      // home for title/subfolder/mode options) instead of the editor's built-in
      // dialog, which can't reach the document's loose image files.
      this.pendingConversionAction = null;
      this.convertDialogOpen.set(true);
      return true;
    }
    this.pendingConversionAction = action;
    this.pendingMarkdownImageDestination = null;
    this.imageSubfolder.set('images');
    this.imageDestinationDialogOpen.set(true);
    return true;
  };

  private readonly closeMenuOnDocumentClick = () => this.openMenu.set(null);

  // The editor reads the OS color scheme once when its view is created but does
  // not track later OS changes. Follow live OS changes here and push them into
  // the open editor; the user can still flip the editor's own toggle afterward
  // (until the next OS change). The app chrome follows the OS via CSS media query.
  private readonly osColorSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly handleOsColorSchemeChange = (event: MediaQueryListEvent) => {
    this.ngZone.run(() => this.applyOsColorSchemeToEditor(event.matches ? 'dark' : 'light'));
  };

  private readonly handleLinkMouseOver = (e: MouseEvent) => {
    if (!this.isDesktopShell()) return;
    const href = (e.target as Element).closest('a')?.getAttribute('href');
    if (href) this.hoverUrl.set(href);
  };

  private readonly handleLinkMouseOut = (e: MouseEvent) => {
    if (!this.isDesktopShell()) return;
    if ((e.target as Element).closest('a')) this.hoverUrl.set(null);
  };

  private readonly handleNewArchiveCommand = () => this.newArchive();
  private readonly handleOpenArchiveCommand = () => this.openFilePicker();
  private readonly handleSaveArchiveCommand = () => void this.saveArchive();
  private readonly handleSaveArchiveAsCommand = () => void this.saveArchive(true);
  private readonly handleCloseArchiveCommand = () => this.closeDocument();
  private readonly handleExportDraftCommand = () => this.exportDraft();
  private readonly handleShowAboutCommand = () => this.showAbout();
  private readonly handleSetMdDefaultCommand = () => void this.promptMarkdownDefaultManually();
  private readonly handlePackFolderCommand = () => void this.packFolder();
  private readonly handleShowInFolderCommand = () => void this.showInFileManager();

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    switch (e.key) {
      case 'n':
        e.preventDefault();
        this.newArchive();
        break;
      case 'o':
        e.preventDefault();
        void this.openFilePicker();
        break;
      case 's':
        e.preventDefault();
        void this.saveArchive(e.shiftKey);
        break;
      case 'w':
        e.preventDefault();
        this.closeDocument();
        break;
    }
  };

  constructor(
    private archiveService: ArchiveService,
    private storageService: StorageService,
    private validationService: ValidationService,
    private ngZone: NgZone,
  ) {
    effect(() => {
      document.title = this.documentTitleDisplay() || 'MDZip Studio';
    });

    // Keep the native menu's document-only items (Save, Save As, Close, Show in
    // File Manager) enabled only while a document is open.
    effect(() => {
      window.mdzipStudio?.setDocumentOpen?.(!!this.currentArchive());
    });

    window.addEventListener('mdzip-studio:new-archive', this.handleNewArchiveCommand);
    window.addEventListener('mdzip-studio:open-archive', this.handleOpenArchiveCommand);
    window.addEventListener('mdzip-studio:save-archive', this.handleSaveArchiveCommand);
    window.addEventListener('mdzip-studio:save-archive-as', this.handleSaveArchiveAsCommand);
    window.addEventListener('mdzip-studio:close-archive', this.handleCloseArchiveCommand);
    window.addEventListener('mdzip-studio:export-draft', this.handleExportDraftCommand);
    window.addEventListener('mdzip-studio:show-about', this.handleShowAboutCommand);
    window.addEventListener('mdzip-studio:set-md-default', this.handleSetMdDefaultCommand);
    window.addEventListener('mdzip-studio:pack-folder', this.handlePackFolderCommand);
    window.addEventListener('mdzip-studio:show-in-folder', this.handleShowInFolderCommand);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('click', this.closeMenuOnDocumentClick);
    document.addEventListener('mouseover', this.handleLinkMouseOver);
    document.addEventListener('mouseout', this.handleLinkMouseOut);
    this.osColorSchemeQuery?.addEventListener('change', this.handleOsColorSchemeChange);
    this.removeOpenDocumentRequestedListener = window.mdzipStudio?.onOpenDocumentRequested?.(
      () => this.ngZone.run(() => {
        if (this.pendingElectronOpen) {
          this.electronOpenRequestedWhilePending = true;
        } else {
          void this.openPendingElectronDocument();
        }
      })
    ) ?? null;
    if (window.mdzipStudio?.takePendingOpenDocument) {
      // Electron may have launched us with a file (double-click / "Open with").
      // Open it if one is pending; otherwise leave the workspace empty so the
      // welcome screen shows (no archive open) instead of a blank new document.
      this.isLoading.set(true);
      void this.openPendingElectronDocument().then((opened) => {
        if (!opened) this.isLoading.set(false);
      });
    }

    void this.maybePromptMarkdownDefault();

    // Seed the taskbar Jump List with the recents we loaded from storage.
    window.mdzipStudio?.setRecentFiles?.(this.recentFiles());
  }

  ngOnDestroy(): void {
    window.removeEventListener('mdzip-studio:new-archive', this.handleNewArchiveCommand);
    window.removeEventListener('mdzip-studio:open-archive', this.handleOpenArchiveCommand);
    window.removeEventListener('mdzip-studio:save-archive', this.handleSaveArchiveCommand);
    window.removeEventListener('mdzip-studio:save-archive-as', this.handleSaveArchiveAsCommand);
    window.removeEventListener('mdzip-studio:close-archive', this.handleCloseArchiveCommand);
    window.removeEventListener('mdzip-studio:export-draft', this.handleExportDraftCommand);
    window.removeEventListener('mdzip-studio:show-about', this.handleShowAboutCommand);
    window.removeEventListener('mdzip-studio:set-md-default', this.handleSetMdDefaultCommand);
    window.removeEventListener('mdzip-studio:pack-folder', this.handlePackFolderCommand);
    window.removeEventListener('mdzip-studio:show-in-folder', this.handleShowInFolderCommand);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('click', this.closeMenuOnDocumentClick);
    document.removeEventListener('mouseover', this.handleLinkMouseOver);
    document.removeEventListener('mouseout', this.handleLinkMouseOut);
    this.osColorSchemeQuery?.removeEventListener('change', this.handleOsColorSchemeChange);
    this.removeOpenDocumentRequestedListener?.();
    if (this.workspaceLoadTimeoutId !== null) clearTimeout(this.workspaceLoadTimeoutId);
  }

  toggleMenu(id: string): void {
    this.openMenu.set(this.openMenu() === id ? null : id);
  }

  hoverMenu(id: string): void {
    if (this.openMenu() !== null) {
      this.openMenu.set(id);
    }
  }

  closeMenu(): void {
    this.openMenu.set(null);
  }

  showAbout(): void {
    this.aboutTab.set('about');
    this.debugCopied.set(false);
    this.aboutOpen.set(true);
  }

  // First run only: offer to become the default .md editor when we aren't
  // already. Runs at most once automatically (tracked in storage) so we never
  // nag; the Help menu re-triggers it on demand afterwards.
  private async maybePromptMarkdownDefault(): Promise<void> {
    const bridge = window.mdzipStudio;
    if (!bridge?.getMarkdownDefaultStatus) return;
    if (this.storageService.getItem<boolean>(AppComponent.MD_DEFAULT_PROMPT_KEY, false)) return;
    try {
      const status = await bridge.getMarkdownDefaultStatus();
      if (!status.supported || status.isDefault) return;
      this.mdDefaultPromptOpen.set(true);
    } catch {
      // Best-effort: never block startup on the association check.
    }
  }

  // Help menu entry: open the prompt on demand, regardless of the first-run flag.
  private async promptMarkdownDefaultManually(): Promise<void> {
    const bridge = window.mdzipStudio;
    if (!bridge?.promptMarkdownDefault) return;
    try {
      const status = await bridge.getMarkdownDefaultStatus?.();
      if (status?.isDefault) {
        this.statusMessage.set('MDZip Studio is already the default for .md files');
        return;
      }
    } catch {
      // Ignore status failures and just offer the dialog.
    }
    this.mdDefaultPromptOpen.set(true);
  }

  async setMarkdownDefault(): Promise<void> {
    const bridge = window.mdzipStudio;
    this.storageService.setItem(AppComponent.MD_DEFAULT_PROMPT_KEY, true);
    if (!bridge?.promptMarkdownDefault) {
      this.mdDefaultPromptOpen.set(false);
      return;
    }
    this.mdDefaultBusy.set(true);
    try {
      const status = await bridge.promptMarkdownDefault();
      this.statusMessage.set(
        status.isDefault
          ? 'MDZip Studio is now the default for .md files'
          : 'You can set the default anytime from Help'
      );
    } catch {
      this.statusMessage.set('Could not open the Windows default-app dialog');
    } finally {
      this.mdDefaultBusy.set(false);
      this.mdDefaultPromptOpen.set(false);
    }
  }

  dismissMarkdownDefaultPrompt(): void {
    this.storageService.setItem(AppComponent.MD_DEFAULT_PROMPT_KEY, true);
    this.mdDefaultPromptOpen.set(false);
  }

  async copyDebugInfo(): Promise<void> {
    const text = this.debugInfo()
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.debugCopied.set(true);
      setTimeout(() => this.debugCopied.set(false), 2000);
    } catch {
      this.statusMessage.set('Could not copy to clipboard');
    }
  }

  newArchive(format: 'markdown' | 'mdz' = 'markdown'): void {
    this.confirmDiscardIfUnsaved(() => {
      this.newArchiveFormat.set(format);
      this.newArchiveName = this.defaultArchiveName(format);
      this.newDialogOpen.set(true);
    });
  }

  // Default name for the New dialog, by output format (and .mdz mode). A plain
  // .md is a single document; an .mdz is a bundle/archive — and, in future,
  // project mode would seed "My Project".
  private defaultArchiveName(format: 'markdown' | 'mdz', mode: 'document' | 'project' = this.newArchiveMode): string {
    if (format === 'mdz') return mode === 'project' ? 'My Project' : 'My Document';
    return 'Untitled';
  }

  // Whether the open document exists on disk (so it can be revealed / saved in place).
  readonly hasFileOnDisk = computed(() => !!this.currentArchive()?.path);

  // Whether Save has something to write: either unsaved edits, or (on desktop) a
  // document that only lives in memory and has never been written to disk —
  // e.g. a new document, a packed folder, or a .md just converted to .mdz. The
  // editor's dirty flag covers edits but not these "never saved" cases, so the
  // Save button keys off this instead of dirty alone. (In the browser shell
  // there is no on-disk path, so we fall back to dirty.)
  readonly needsSave = computed(() =>
    this.isDirty() || (this.isDesktopShell() && !!this.currentArchive() && !this.hasFileOnDisk())
  );

  async showInFileManager(): Promise<void> {
    this.closeMenu();
    const filePath = this.currentArchive()?.path;
    const reveal = window.mdzipStudio?.showInFolder;
    if (!filePath || !reveal) {
      this.statusMessage.set('Save the document first to show it in your file manager');
      return;
    }
    const result = await reveal(filePath);
    if (result?.error) {
      this.statusMessage.set(result.error === 'not-found'
        ? 'File not found on disk — save it again'
        : 'Could not open the file manager');
    }
  }

  closeDocument(): void {
    if (!this.currentArchive()) return;
    this.confirmDiscardIfUnsaved(() => this.discardAndCloseDocument());
  }

  private discardAndCloseDocument(): void {
    this.archiveService.closeArchive();
    this.selectedDocumentId.set(null);
    this.validationIssues.set([]);
    this.saveValidationState.set('unchecked');
    this.latestWorkspaceBytes.set(null);
    this.latestWorkspaceSnapshot.set(null);
    // The editor is torn down with the document, so it won't emit dirtyChanged;
    // clear the flag here.
    this.isDirty.set(false);
    this.sourceFormat.set('markdown');
    this.workspaceBytes.set(new TextEncoder().encode(''));
    this.currentMarkdownPath = null;
    this.clearMdAssetCaches();
    this.readOnly.set(false);
    this.statusMessage.set('Closed document');
  }

  // Unsaved-changes guard. Runs `proceed` immediately when there are no unsaved
  // edits; otherwise stashes it and opens the confirmation dialog, which runs it
  // after the user saves or explicitly discards.
  private confirmDiscardIfUnsaved(proceed: () => void): void {
    // needsSave (not just isDirty) so a converted/packed/new document that has
    // never been written to disk also prompts — those aren't "dirty" but would
    // be lost on close/new/open.
    if (!this.needsSave()) {
      proceed();
      return;
    }
    this.pendingDiscardAction = proceed;
    this.unsavedDialogOpen.set(true);
  }

  private runPendingDiscard(): void {
    const action = this.pendingDiscardAction;
    this.pendingDiscardAction = null;
    action?.();
  }

  async saveUnsavedThenContinue(): Promise<void> {
    this.unsavedDialogOpen.set(false);
    // Read-only files can't save in place, so Save here means Save As.
    await this.saveArchive(this.readOnly());
    // A successful save clears needsSave (path recorded + dirty cleared). If it
    // still needs saving, the save was canceled or blocked, so stay put and drop
    // the pending action rather than discarding the user's work.
    if (!this.needsSave()) {
      this.runPendingDiscard();
    } else {
      this.pendingDiscardAction = null;
    }
  }

  discardUnsavedThenContinue(): void {
    this.unsavedDialogOpen.set(false);
    this.runPendingDiscard();
  }

  cancelUnsavedDialog(): void {
    this.unsavedDialogOpen.set(false);
    this.pendingDiscardAction = null;
  }

  // Dismissing via the X or Esc is a cancel — never an implicit discard.
  onUnsavedDialogVisibleChange(visible: boolean): void {
    if (!visible) {
      this.cancelUnsavedDialog();
    }
  }

  openRecent(path: string): void {
    this.confirmDiscardIfUnsaved(() => {
      // In the desktop shell a recent entry is a real filesystem path we can open
      // directly. In the web shell it's only a file name, so fall back to the picker.
      if (window.mdzipStudio?.openDocumentByPath) {
        void this.openRecentElectron(path);
        return;
      }
      this.launchFilePicker();
    });
  }

  private async openRecentElectron(path: string): Promise<void> {
    let result: ElectronDocumentOpenResult;
    try {
      result = await window.mdzipStudio!.openDocumentByPath!(path);
    } catch (error) {
      this.statusMessage.set(error instanceof Error ? error.message : `Could not open ${this.recentFileName(path)}`);
      return;
    }
    if (result.error === 'not-found') {
      this.storageService.removeRecentFile(path);
      this.syncRecentFiles();
      this.statusMessage.set(`File no longer exists: ${this.recentFileName(path)}`);
      return;
    }
    if (result.canceled) {
      this.statusMessage.set(result.error ? `Could not open ${this.recentFileName(path)}` : 'Open canceled');
      return;
    }
    await this.openElectronDocumentResult(result);
  }

  removeRecent(path: string): void {
    this.storageService.removeRecentFile(path);
    this.syncRecentFiles();
  }

  clearRecentFiles(): void {
    this.storageService.clearRecentFiles();
    this.syncRecentFiles([]);
  }

  // Mirror the recents list into the renderer signal and, on the desktop shell,
  // the Windows taskbar Jump List so right-clicking the app icon reopens them.
  private syncRecentFiles(files = this.storageService.getRecentFiles()): void {
    this.recentFiles.set(files);
    this.recentTitles.set(this.storageService.getRecentTitles());
    window.mdzipStudio?.setRecentFiles?.(files);
  }

  // Add a just-saved file to the recents list (and cache an .mdz manifest title
  // that differs from the file name). `title` is the pre-save archive name, read
  // before updateArchivePath rewrites it to the saved file name.
  private recordSavedRecent(filePath: string | undefined, isMdz: boolean, title: string): void {
    if (!filePath) return;
    this.storageService.addRecentFile(filePath);
    if (isMdz) {
      const fallback = this.recentFileName(filePath).replace(/\.mdz$/i, '');
      if (title && title !== fallback) this.storageService.setRecentTitle(filePath, title);
    }
    this.syncRecentFiles();
  }

  openFilePicker(): void {
    this.confirmDiscardIfUnsaved(() => this.launchFilePicker());
  }

  // Un-guarded picker launch. Callers that have already cleared the
  // unsaved-changes guard (e.g. openRecent) call this directly to avoid a
  // second prompt.
  private launchFilePicker(): void {
    if (window.mdzipStudio?.openDocument) {
      void this.openFilePickerElectron();
      return;
    }
    if ('showOpenFilePicker' in window) {
      void this.openFilePickerModern();
      return;
    }
    this.ngZone.runOutsideAngular(() => this.fileInput?.nativeElement.click());
  }

  private async openFilePickerModern(): Promise<void> {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          { description: 'MDZip Documents', accept: { 'application/zip': ['.mdz'], 'text/markdown': ['.md'], 'application/json': ['.json'] } },
        ],
        multiple: false,
        excludeAcceptAllOption: false,
      });
      this.isLoading.set(true);
      await this.yieldForPaint();
      const file = await handle.getFile();
      await this.openDocumentBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (err: unknown) {
      this.isLoading.set(false);
      if ((err as DOMException)?.name !== 'AbortError') {
        this.statusMessage.set('Failed to open file');
      }
    }
  }

  private async openFilePickerElectron(): Promise<void> {
    const result = await window.mdzipStudio!.openDocument!();
    await this.openElectronDocumentResult(result);
  }

  private openPendingElectronDocument(): Promise<boolean> {
    const takePending = window.mdzipStudio?.takePendingOpenDocument;
    if (!takePending) return Promise.resolve(false);
    if (this.pendingElectronOpen) return this.pendingElectronOpen;

    this.pendingElectronOpen = takePending()
      .then((result) => this.openElectronDocumentResult(result))
      .catch((error) => {
        this.isLoading.set(false);
        this.statusMessage.set(error instanceof Error ? error.message : 'Failed to open document');
        return false;
      })
      .finally(() => {
        this.pendingElectronOpen = null;
        if (this.electronOpenRequestedWhilePending) {
          this.electronOpenRequestedWhilePending = false;
          void this.openPendingElectronDocument();
        }
      });
    return this.pendingElectronOpen;
  }

  private async openElectronDocumentResult(result: ElectronDocumentOpenResult): Promise<boolean> {
    if (result.canceled || !result.bytes || !result.name) return false;
    this.isLoading.set(true);
    await this.yieldForPaint();
    await this.openDocumentBytes(new Uint8Array(result.bytes), result.name, result.filePath, result.readOnly ?? false);
    return true;
  }

  // ── Pack a folder of Markdown into a single .mdz (issue #2) ───────────────
  // Mirrors mdzip.org/packager.html: a path-only scan shows the options
  // instantly, then only files matching the include-filters are read at build.
  async packFolder(): Promise<void> {
    this.closeMenu();
    if (window.mdzipStudio?.pickFolder) {
      let scan: ElectronPickFolderResult;
      try {
        scan = await window.mdzipStudio.pickFolder();
      } catch (error) {
        this.statusMessage.set(error instanceof Error ? error.message : 'Could not read folder');
        return;
      }
      if (scan.canceled) return;
      this.openPackOptions({ kind: 'electron' }, scan.folderName ?? 'folder', scan.paths ?? [], scan.manifestText ?? null);
      return;
    }
    // Browser: the <input webkitdirectory> change handler continues the flow.
    this.folderInput?.nativeElement.click();
  }

  async onFolderInputSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (!picked.length) return;

    const firstRel = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath || picked[0].name;
    const folderName = firstRel.includes('/') ? firstRel.split('/')[0] : 'folder';
    // Keep all File handles; contents are read lazily at build time.
    const entries = picked.map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const parts = rel.split('/');
      return { path: parts.length > 1 ? parts.slice(1).join('/') : parts[0], file };
    });
    const manifestEntry = entries.find((entry) => entry.path.toLowerCase() === 'manifest.json');
    const manifestText = manifestEntry ? await manifestEntry.file.text() : null;
    this.openPackOptions({ kind: 'browser', entries }, folderName, entries.map((entry) => entry.path), manifestText);
  }

  private openPackOptions(source: PackSource, folderName: string, paths: string[], manifestText: string | null): void {
    if (!paths.length) {
      this.statusMessage.set('That folder has no files to pack');
      return;
    }
    this.pendingPackSource = source;
    this.packAllPaths = paths;
    this.packFolderName.set(folderName);
    this.packFileCount.set(paths.length);
    this.packFilters.set(MdzPackagerCore.DEFAULT_FILTERS.join('\n'));
    this.packEntryOptions.set(paths.filter((p) => !p.includes('/') && /\.(md|markdown)$/i.test(p)).sort());
    this.packMode.set('document');
    this.packTitle.set('');
    this.packEntryPoint.set('');
    this.packAuthor.set('');
    this.packDescription.set('');
    this.prefillPackOptionsFromManifest(manifestText);
    this.packFolderDialogOpen.set(true);
  }

  // Pre-fill the option fields from a source manifest.json, like the packager.
  private prefillPackOptionsFromManifest(manifestText: string | null): void {
    if (!manifestText) return;
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestText) as Record<string, unknown>;
    } catch {
      return;
    }
    if (manifest['mode'] === 'project') this.packMode.set('project');
    if (typeof manifest['title'] === 'string') this.packTitle.set(manifest['title']);
    if (typeof manifest['entryPoint'] === 'string') this.packEntryPoint.set(manifest['entryPoint']);
    if (typeof manifest['description'] === 'string') this.packDescription.set(manifest['description']);
    const author = manifest['author'] ?? (Array.isArray(manifest['authors']) ? manifest['authors'][0] : null);
    if (author && typeof (author as { name?: unknown }).name === 'string') {
      this.packAuthor.set((author as { name: string }).name);
    }
  }

  async confirmPackFolder(): Promise<void> {
    this.packFolderDialogOpen.set(false);
    await this.runPack();
  }

  private packFiltersList(): string[] {
    const list = this.packFilters().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return list.length ? list : MdzPackagerCore.DEFAULT_FILTERS.slice();
  }

  private async runPack(): Promise<void> {
    const source = this.pendingPackSource;
    const folderName = this.packFolderName();
    this.pendingPackSource = null;
    if (!source) return;

    const filters = this.packFiltersList();
    const entryPoint = this.packEntryPoint().trim();
    // manifest.json is regenerated from the options, so never pack it as-is.
    const selected = this.packAllPaths.filter(
      (p) => p.toLowerCase() !== 'manifest.json' && MdzPackagerCore.matchesAnyFilter(p, filters)
    );

    try {
      if (!selected.length) {
        this.statusMessage.set('No files match the include filters');
        return;
      }
      const files = await this.readPackFiles(source, selected);
      // Packing is CPU-bound and buildArchive gives no real progress, but JSZip's
      // generateAsync yields, so we animate the bar from a byte-based time estimate.
      const bytesTotal = files.reduce((sum, file) => sum + file.bytes.length, 0);
      this.packStartMs = performance.now();
      this.packEstMs = Math.max(400, bytesTotal / PACK_BYTES_PER_MS);
      this.packProgress.set({ phase: 'packing', done: files.length, total: files.length, bytesDone: 0, bytesTotal });
      await this.yieldForPaint();
      const packTimer = setInterval(() => {
        const p = this.packProgress();
        if (!p || p.phase !== 'packing') return;
        const pct = Math.min(95, ((performance.now() - this.packStartMs) / this.packEstMs) * 100);
        this.packProgress.set({ ...p, bytesDone: Math.round((pct / 100) * p.bytesTotal) });
      }, 120);
      let bytes: Uint8Array;
      try {
        bytes = await this.buildArchiveFromFolder(files, folderName, {
          mode: this.packMode(),
          entryPoint: entryPoint || undefined,
          createIndex: !entryPoint,
          title: this.packTitle().trim() || undefined,
          author: this.packAuthor().trim() || undefined,
          description: this.packDescription().trim() || undefined,
        });
      } finally {
        clearInterval(packTimer);
      }
      this.packProgress.set(null);
      const defaultName = `${this.toSafeFilename(folderName)}.mdz`;

      if (this.packMode() === 'project') {
        // Projects may be large, so write to disk first, then open the result.
        if (window.mdzipStudio?.saveDocument) {
          const result = await window.mdzipStudio.saveDocument({ defaultName, bytes: Array.from(bytes), saveAs: true });
          if (result.canceled) { this.statusMessage.set('Pack canceled'); return; }
          this.isLoading.set(true);
          await this.yieldForPaint();
          await this.openDocumentBytes(bytes, result.name ?? defaultName, result.filePath, false, true, true);
          this.statusMessage.set(`Packed ${folderName} → ${result.name ?? defaultName}`);
          return;
        }
        // Browser: "save" is a download; then open the packed bytes in memory.
        this.downloadBlob(this.bytesToBlob(bytes, 'application/vnd.mdzip'), defaultName, 'application/vnd.mdzip');
        this.isLoading.set(true);
        await this.yieldForPaint();
        await this.openDocumentBytes(bytes, defaultName, undefined, false, false, true);
        this.statusMessage.set(`Packed ${folderName} (downloaded)`);
        return;
      }

      // Document: open in memory, unsaved (no path → Save prompts for a location).
      this.isLoading.set(true);
      await this.yieldForPaint();
      await this.openDocumentBytes(bytes, defaultName, undefined, false, false, true);
      this.statusMessage.set(`Packed ${folderName} (unsaved)`);
    } catch (error) {
      this.isLoading.set(false);
      this.statusMessage.set(error instanceof Error ? error.message : 'Could not pack folder');
    } finally {
      this.packProgress.set(null);
    }
  }

  // Reads only the selected (filter-matched) files, driving the reading progress
  // bar + ETA. Desktop streams progress over IPC; the browser reads File handles.
  private async readPackFiles(source: PackSource, selected: string[]): Promise<FolderFile[]> {
    this.packStartMs = performance.now();
    if (source.kind === 'electron') {
      const bridge = window.mdzipStudio!;
      this.packProgress.set({ phase: 'reading', done: 0, total: selected.length, bytesDone: 0, bytesTotal: 0 });
      const unsubscribe = bridge.onPackFolderProgress?.((data) => this.packProgress.set({ phase: 'reading', ...data }));
      try {
        const result = await bridge.readFolder!({ paths: selected });
        return (result.files ?? []).map((file) => ({ path: file.path, bytes: new Uint8Array(file.bytes) }));
      } finally {
        unsubscribe?.();
      }
    }

    const wanted = new Set(selected);
    const entries = source.entries.filter((entry) => wanted.has(entry.path));
    const total = entries.length;
    const bytesTotal = entries.reduce((sum, entry) => sum + entry.file.size, 0);
    this.packProgress.set({ phase: 'reading', done: 0, total, bytesDone: 0, bytesTotal });
    const files: FolderFile[] = [];
    let bytesDone = 0;
    for (let i = 0; i < entries.length; i += 1) {
      files.push({ path: entries[i].path, bytes: new Uint8Array(await entries[i].file.arrayBuffer()) });
      bytesDone += entries[i].file.size;
      if (i % 4 === 0 || i === entries.length - 1) {
        this.packProgress.set({ phase: 'reading', done: i + 1, total, bytesDone, bytesTotal });
      }
      if (i % 16 === 0) await this.yieldForPaint(); // let the bar repaint
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  private packEtaText(): string {
    const p = this.packProgress();
    if (!p) return '';
    // Packing has no real progress; estimate remaining from the time budget.
    if (p.phase === 'packing') {
      const remaining = (this.packEstMs - (performance.now() - this.packStartMs)) / 1000;
      if (remaining > 1) return `~${Math.ceil(remaining)}s left`;
      return 'almost done';
    }
    if (p.bytesDone === 0) return '';
    const elapsed = (performance.now() - this.packStartMs) / 1000;
    const rate = p.bytesDone / elapsed;
    if (!isFinite(rate) || rate <= 0) return '';
    const remaining = (p.bytesTotal - p.bytesDone) / rate;
    if (!isFinite(remaining) || remaining < 0) return '';
    return remaining < 1 ? 'almost done' : `~${Math.ceil(remaining)}s left`;
  }

  private async buildArchiveFromFolder(
    files: FolderFile[],
    name: string,
    options: { mode: PackMode; entryPoint?: string; createIndex: boolean; title?: string; author?: string; description?: string }
  ): Promise<Uint8Array> {
    // Files were already filtered when read; pack everything that was kept.
    const result = await MdzPackagerCore.buildArchive(
      files.map((file) => ({ path: file.path, data: file.bytes })),
      name,
      {
        createIndex: options.createIndex,
        mapFiles: true,
        filters: ['**/*'],
        title: options.title ?? name,
        mode: options.mode,
        entryPoint: options.entryPoint,
        author: options.author,
        description: options.description,
      }
    );
    return new Uint8Array(await result.blob.arrayBuffer());
  }

  async createArchiveFromDialog(): Promise<void> {
    const name = this.newArchiveName.trim() || 'Untitled';
    const format = this.newArchiveFormat();
    this.archiveService.createNewArchive(name, this.newArchiveMode);
    this.archiveService.addDocument({
      id: crypto.randomUUID(),
      name: 'index.md',
      content: '',
      modified: new Date(),
    });
    this.selectedDocumentId.set(this.archiveService.documents()[0]?.id ?? null);
    this.validationIssues.set([]);
    this.saveValidationState.set('unchecked');
    this.latestWorkspaceBytes.set(null);
    this.latestWorkspaceSnapshot.set(null);

    // A markdown document is plain text the editor accepts empty. An .mdz is a
    // zip container, so it needs valid archive bytes — feeding empty bytes makes
    // the workspace fail to parse ("Corrupted zip"). Build them before switching
    // sourceFormat so the workspace never sees mdz mode with zero-length bytes.
    let bytes: Uint8Array = new TextEncoder().encode('');
    if (format === 'mdz') {
      const archive = this.currentArchive();
      if (archive) bytes = await this.buildFreshArchiveBytes(archive);
    }
    this.sourceFormat.set(format);
    this.workspaceBytes.set(bytes);
    this.navigationActive.set(false);
    this.currentMarkdownPath = null;
    this.clearMdAssetCaches();
    this.readOnly.set(false);
    this.statusMessage.set(`Created ${name}`);
    this.newDialogOpen.set(false);
  }

  async openArchive(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.isLoading.set(true);
    await this.yieldForPaint();
    try {
      await this.openDocumentBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (error) {
      this.isLoading.set(false);
      this.statusMessage.set(error instanceof Error ? error.message : 'Failed to open document');
    }
  }

  private yieldForPaint(): Promise<void> {
    // Two rAF passes: first lets Angular's CD update the DOM, second lets the browser paint it.
    return new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }

  // Inline relative image references (e.g. `./img.png`) for a plain Markdown file
  // opened from disk. The preview renderer can't resolve such paths against its
  // own origin, so each sibling file is read via Electron and swapped for a data
  // URI. .mdz images already arrive as data URIs and are skipped; no-op in the
  // browser shell (no disk path / IPC). Runs as a preview `transformHtml` stage,
  // so the editor's Markdown source is left untouched.
  private async inlineRelativeMarkdownImages(html: string, context: MdzipMarkdownRenderContext): Promise<string> {
    if (context.sourceFormat !== 'markdown') return html;
    const documentPath = this.currentMarkdownPath;
    const read = window.mdzipStudio?.readMarkdownAsset;
    if (!documentPath || !read) return html;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    let changed = false;
    await Promise.all(Array.from(doc.querySelectorAll('img')).map(async (img) => {
      // Resolve relative sources only; absolute/scheme/escaping paths return null.
      const archivePath = this.toArchiveAssetPath(img.getAttribute('src') ?? '');
      if (!archivePath) return;
      // Reference a blob: object URL, not the data URI: it's short (cheap to
      // serialize every render) and the browser decodes it once and reuses it,
      // instead of re-decoding a multi-MB data URI on each keystroke.
      let previewUrl = this.mdPreviewUrlCache.get(archivePath);
      if (!previewUrl) {
        // readRelativeImageBytes also populates mdAssetCache (the data URI used
        // for embedding on conversion/save), so both caches stay warm.
        const bytes = await this.readRelativeImageBytes(documentPath, archivePath);
        if (!bytes) return;
        previewUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: this.imageMimeType(archivePath) }));
        this.mdPreviewUrlCache.set(archivePath, previewUrl);
      }
      img.setAttribute('src', previewUrl);
      changed = true;
    }));
    return changed ? doc.body.innerHTML : html;
  }

  private async openDocumentBytes(bytes: Uint8Array, name: string, filePath?: string, readOnly = false, recordRecent = true, showNavigation = false): Promise<void> {
    this.readOnly.set(readOnly);
    // Decide nav-pane visibility before the workspace (re)mounts, so the freshly
    // created view picks it up. Off for normal opens, on for packed folders.
    this.navigationActive.set(showNavigation);
    // isLoading is set (and a paint yielded) by the caller before reading bytes.
    this.latestWorkspaceBytes.set(null);
    this.latestWorkspaceSnapshot.set(null);
    // Clear any dirty state carried over from a previously open document; the
    // freshly loaded one is clean until the editor reports otherwise.
    this.isDirty.set(false);
    this.validationIssues.set([]);
    this.saveValidationState.set('unchecked');
    // Reset relative-image resolution; set below only for a plain .md from disk.
    this.currentMarkdownPath = null;
    this.clearMdAssetCaches();

    try {
      // Title pulled from an .mdz manifest, cached so the recents list can show
      // a friendly name instead of the bare file name.
      let recentTitle: string | undefined;
      const lowerName = name.toLowerCase();
      if (lowerName.endsWith('.mdz')) {
        const archive = await this.parseMdzBytes(bytes, name, filePath);
        this.archiveService.loadArchive(archive);
        this.sourceFormat.set('mdz');
        this.workspaceBytes.set(bytes);
        // parseMdzBytes falls back to the file name when the manifest has no
        // title; only cache a real manifest title (one that differs from it).
        const fallbackName = name.replace(/\.mdz$/i, '');
        if (archive.name && archive.name !== fallbackName) recentTitle = archive.name;
      } else if (lowerName.endsWith('.md')) {
        const content = new TextDecoder().decode(bytes);
        const archiveName = name.replace(/\.md$/i, '');
        // Remember the disk path so the preview can resolve relative images.
        this.currentMarkdownPath = filePath ?? null;
        this.archiveService.createNewArchive(archiveName, 'document');
        // Name the entry `index.md` to match the manifest's default entry point
        // (and how new docs are named), so a later .mdz pack doesn't fail with
        // ENTRYPOINT_MISSING. Relative image links stay relative to this root.
        this.archiveService.addDocument({
          id: crypto.randomUUID(),
          name: 'index.md',
          content,
          modified: new Date(),
        });
        // Record the on-disk path (createNewArchive doesn't) so an opened .md
        // counts as saved — no false unsaved dot — and Save writes back in place
        // instead of prompting Save As. New documents pass no filePath and stay
        // path-less (correctly unsaved).
        if (filePath) {
          this.archiveService.currentArchive.update((archive) =>
            archive ? { ...archive, path: filePath } : archive
          );
        }
        this.sourceFormat.set('markdown');
        this.workspaceBytes.set(bytes);
      } else {
        const archive = this.parseArchiveDraft(new TextDecoder().decode(bytes), name, filePath);
        this.archiveService.loadArchive(archive);
        this.sourceFormat.set('mdz');
        void this.rebuildWorkspaceBytes();
      }

      // In-memory packs (no real path on disk) shouldn't pollute the recent list.
      if (recordRecent) {
        const recentKey = filePath ?? name;
        this.storageService.addRecentFile(recentKey);
        if (recentTitle) this.storageService.setRecentTitle(recentKey, recentTitle);
        this.syncRecentFiles();
      }
      this.selectedDocumentId.set(this.archiveService.documents()[0]?.id ?? null);
      this.statusMessage.set(`Opened ${name}`);
      // Defer clearing isLoading until the workspace fires its first changed event,
      // since the workspace component does its own async zip parse after receiving bytes.
      this.armWorkspaceLoadTimeout();
    } finally {
      if (!this.workspaceLoadPending) this.isLoading.set(false);
    }
  }

  private armWorkspaceLoadTimeout(): void {
    this.workspaceLoadPending = true;
    if (this.workspaceLoadTimeoutId !== null) clearTimeout(this.workspaceLoadTimeoutId);
    // Safety valve: force-clear the overlay after 30 s if the workspace never responds.
    this.workspaceLoadTimeoutId = setTimeout(() => {
      this.workspaceLoadPending = false;
      this.workspaceLoadTimeoutId = null;
      this.isLoading.set(false);
    }, 30_000);
  }

  private clearWorkspaceLoad(): void {
    if (!this.workspaceLoadPending) return;
    this.workspaceLoadPending = false;
    if (this.workspaceLoadTimeoutId !== null) {
      clearTimeout(this.workspaceLoadTimeoutId);
      this.workspaceLoadTimeoutId = null;
    }
    this.isLoading.set(false);
  }

  private updateArchivePath(filePath: string | undefined, fileName: string | undefined): void {
    if (!filePath && !fileName) {
      return;
    }
    // Keep relative-image resolution pointed at the saved location (e.g. Save As).
    if (filePath && this.sourceFormat() === 'markdown') {
      this.currentMarkdownPath = filePath;
      this.clearMdAssetCaches();
    }
    this.archiveService.currentArchive.update((archive) =>
      archive
        ? {
            ...archive,
            path: filePath ?? archive.path,
            name: fileName ? fileName.replace(/\.(?:mdz|md)$/i, '') : archive.name,
          }
        : archive
    );
  }

  async saveArchive(saveAs = false): Promise<void> {
    const archive = this.currentArchive();
    if (!archive) return;

    // In-place Save is blocked for read-only files (covers the Ctrl+S shortcut
    // and the native File menu, which call this directly). Save As is allowed —
    // it writes the edits to a new, user-chosen file via the save dialog.
    if (this.readOnly() && !saveAs) {
      this.statusMessage.set(this.readOnlyHint);
      return;
    }

    // Saving rebuilds the archive bytes (and, for .mdz, re-embeds images), which
    // can take a noticeable moment on larger documents. Show progress right away
    // and yield so the message paints before the work starts. performSave
    // overwrites it with the final "Saved …" / "Save canceled" / failure result.
    this.statusMessage.set(`Saving ${archive.name || 'document'}…`);
    await this.yieldForPaint();

    // Surface any failure: callers invoke this as `void saveArchive(...)`, which
    // would otherwise swallow a thrown error and look like nothing happened.
    try {
      await this.performSave(archive, saveAs);
    } catch (error) {
      this.statusMessage.set(`Save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private async performSave(archive: MDZipArchive, saveAs: boolean): Promise<void> {
    // Pull the editor's latest text into fresh bytes before saving. The embedded
    // editor only emits `changed` (with rebuilt bytes) on structural edits, so
    // plain text edits live only inside the editor until flushed — without this
    // a native Save would write the stale cached bytes and silently drop edits.
    await this.flushWorkspaceEdits();

    if (this.sourceFormat() === 'markdown') {
      const bytes = this.latestWorkspaceBytes()
        ?? this.workspaceBytes()
        ?? new TextEncoder().encode(archive.documents[0]?.content ?? '');
      const defaultName = `${this.toSafeFilename(archive.name)}.md`;

      if (window.mdzipStudio?.saveDocument) {
        const markdownContent = new TextDecoder().decode(bytes);
        // The .mdz form is only needed when a Save As dialog could turn this
        // document into an archive (the user picking the .mdz filter). An
        // in-place .md save just writes the markdown text, so skip the image
        // collection + archive build — those are slow for docs with images and
        // were previously run on every save only to be discarded.
        let mdzBytes: Uint8Array | undefined;
        if (saveAs) {
          const convertedArchive: MDZipArchive = {
            ...archive,
            documents: archive.documents.map((document, index) =>
              index === 0 ? { ...document, content: markdownContent } : document
            ),
          };
          // Embed the document's relative images so a saved .mdz is self-contained.
          const embeddedImages = await this.collectMarkdownImages(markdownContent);
          mdzBytes = await this.buildFreshArchiveBytes(convertedArchive, embeddedImages);
        }
        let result: ElectronDocumentSaveResult;
        try {
          result = await window.mdzipStudio.saveDocument({
            filePath: archive.path,
            defaultName,
            bytes: Array.from(bytes),
            mdzBytes: mdzBytes ? Array.from(mdzBytes) : undefined,
            saveAs,
          });
        } catch (error) {
          this.statusMessage.set(`Save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
          return;
        }
        if (result.canceled) { this.statusMessage.set('Save canceled'); return; }

        this.recordSavedRecent(result.filePath, result.format === 'mdz', archive.name);
        this.updateArchivePath(result.filePath, result.name);
        this.workspaceEditor?.markPersisted();
        this.isDirty.set(false);
        this.readOnly.set(false);
        // A markdown source only becomes .mdz via Save As, so mdzBytes was built above.
        if (result.format === 'mdz' && mdzBytes) {
          const firstDocument = archive.documents[0];
          if (firstDocument) {
            this.archiveService.updateDocument(firstDocument.id, markdownContent);
          }
          this.sourceFormat.set('mdz');
          this.workspaceBytes.set(mdzBytes);
          this.latestWorkspaceBytes.set(null);
          this.latestWorkspaceSnapshot.set(null);
        }
        this.statusMessage.set(`Saved ${result.filePath ?? result.name ?? archive.name}`);
        return;
      }

      this.downloadBlob(this.bytesToBlob(bytes, 'text/markdown'), defaultName, 'text/markdown');
      this.workspaceEditor?.markPersisted();
      this.isDirty.set(false);
      this.statusMessage.set(`Saved ${archive.name}.md`);
      return;
    }

    const validation = this.runValidationCheck(archive);
    const bytes = await this.buildDocumentBytes(archive);
    const defaultName = `${this.toSafeFilename(archive.name)}.mdz`;

    if (window.mdzipStudio?.saveDocument) {
      let result: ElectronDocumentSaveResult;
      try {
        result = await window.mdzipStudio.saveDocument({
          filePath: archive.path,
          defaultName,
          bytes: Array.from(bytes),
          saveAs,
        });
      } catch (error) {
        this.statusMessage.set(`Save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        return;
      }
      if (result.canceled) {
        this.statusMessage.set('Save canceled');
        return;
      }
      this.recordSavedRecent(result.filePath, true, archive.name);
      this.updateArchivePath(result.filePath, result.name);
      this.workspaceEditor?.markPersisted();
      this.isDirty.set(false);
      this.readOnly.set(false);
      const savedTarget = result.filePath ?? result.name ?? archive.name;
      this.statusMessage.set(validation.valid ? `Saved ${savedTarget}` : `Saved ${savedTarget} with technical issues`);
      return;
    }

    this.downloadBlob(this.bytesToBlob(bytes, 'application/vnd.mdzip'), defaultName, 'application/vnd.mdzip');
    this.workspaceEditor?.markPersisted();
    this.isDirty.set(false);
    this.statusMessage.set(validation.valid ? `Saved ${archive.name}.mdz` : `Saved ${archive.name}.mdz with technical issues`);
  }

  private async flushWorkspaceEdits(): Promise<void> {
    // `flush()` materializes the editor's pending text into the archive bytes and
    // returns a snapshot whose bytes match the active source format (raw markdown
    // for `.md`, archive bytes for `.mdz`) — the same representation the save
    // paths expect from `latestWorkspaceBytes`.
    const snapshot = await this.workspaceEditor?.flush();
    if (snapshot) {
      this.latestWorkspaceBytes.set(new Uint8Array(await snapshot.bytes.arrayBuffer()));
    }
  }

  private async buildDocumentBytes(archive: MDZipArchive): Promise<Uint8Array> {
    // For lazy-loaded .mdz archives (no document content extracted), the original
    // Bytes are the safe fallback and avoid saving a package of empty documents.
    const base = this.latestWorkspaceBytes()
      ?? (archive.documents.every(d => !d.content) ? this.workspaceBytes() : null);
    // Patch the current manifest into the bytes so Internals-tab edits survive
    // even when the bytes came from the editor or straight from disk.
    if (base) return this.patchManifestIntoBytes(base, archive);
    return this.buildFreshArchiveBytes(archive);
  }

  private async patchManifestIntoBytes(bytes: Uint8Array, archive: MDZipArchive): Promise<Uint8Array> {
    const current = await (await MdzArchiveCore.open(bytes)).readManifest();
    const result = await MdzArchiveCore.updateFiles(bytes, [], [], {
      manifest: this.toMdzManifest(archive, current),
    });
    return new Uint8Array(await result.blob.arrayBuffer());
  }

  private async buildFreshArchiveBytes(
    archive: MDZipArchive,
    extraFiles: readonly { path: string; bytes: Uint8Array }[] = []
  ): Promise<Uint8Array> {
    // The packer rejects a manifest entry point that isn't one of the packed
    // files (ERR_PACK_ENTRYPOINT_MISSING). Fall back to the first document when
    // the manifest's entry point doesn't match any document name.
    const documentNames = archive.documents.map((document) => document.name);
    const entryPoint = documentNames.includes(archive.manifest.entryPoint)
      ? archive.manifest.entryPoint
      : documentNames[0] ?? archive.manifest.entryPoint;
    const manifest = this.toMdzManifest(archive);
    manifest.entryPoint = entryPoint;
    const result = await MdzPackagerCore.buildArchive(
      [
        ...archive.documents.map((document) => ({
          path: document.name,
          text: document.content,
        })),
        // Binary assets (e.g. images pulled in when converting a .md). DEFAULT_FILTERS
        // already includes common image extensions, so these survive packing.
        ...extraFiles.map((file) => ({ path: file.path, data: file.bytes })),
        {
          path: 'manifest.json',
          text: JSON.stringify(manifest, null, 2),
        },
      ],
      archive.name,
      {
        createIndex: archive.documents.length === 0,
        mapFiles: true,
        // Keep the defaults, plus the exact paths of any explicitly-provided
        // assets so they survive even if their extension isn't a default filter.
        filters: extraFiles.length
          ? [...MdzPackagerCore.DEFAULT_FILTERS, ...extraFiles.map((file) => file.path)]
          : MdzPackagerCore.DEFAULT_FILTERS,
        title: archive.name,
        mode: archive.mode,
        entryPoint,
      }
    );
    return new Uint8Array(await result.blob.arrayBuffer());
  }

  // ── Embedding loose images when converting Markdown → MDZip ────────────────
  // A plain .md keeps images as sibling files on disk. When converting to a
  // self-contained .mdz we read those siblings and pack them at archive paths
  // that match the existing relative links (so no link rewriting is needed).

  // Extract image references (Markdown `![](path)` and HTML `<img src>`) from text.
  private extractMarkdownImageRefs(markdown: string): string[] {
    const refs: string[] = [];
    const inline = /!\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)/g;
    const html = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let match: RegExpExecArray | null;
    while ((match = inline.exec(markdown))) {
      let ref = match[1];
      if (ref.startsWith('<') && ref.endsWith('>')) ref = ref.slice(1, -1);
      refs.push(ref);
    }
    while ((match = html.exec(markdown))) {
      refs.push(match[1] ?? match[2] ?? match[3] ?? '');
    }
    return refs;
  }

  // Normalize a relative reference to an archive-relative path, or null if it is
  // absolute, a URL/scheme, or escapes the archive root (`..`).
  private toArchiveAssetPath(ref: string): string | null {
    let path = ref.trim().split(/[?#]/)[0];
    if (!path) return null;
    if (path.startsWith('/') || path.startsWith('\\') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
    try { path = decodeURI(path); } catch { /* use as-is */ }
    path = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
    if (!path || path.split('/').some((segment) => segment === '..')) return null;
    return path;
  }

  private dataUriToBytes(dataUri: string): Uint8Array | null {
    const comma = dataUri.indexOf(',');
    if (comma < 0) return null;
    try {
      const binary = atob(dataUri.slice(comma + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      return null;
    }
  }

  // Drop both relative-image caches, revoking the preview's blob: object URLs so
  // they don't leak. Call whenever the document (or its on-disk path) changes.
  private clearMdAssetCaches(): void {
    for (const url of this.mdPreviewUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.mdPreviewUrlCache.clear();
    this.mdAssetCache.clear();
  }

  // Read a document-relative image's bytes via Electron, reusing the preview's
  // data-URI cache. Returns null outside the desktop shell or if unreadable.
  private async readRelativeImageBytes(documentPath: string, archivePath: string): Promise<Uint8Array | null> {
    const cached = this.mdAssetCache.get(archivePath);
    if (cached) return this.dataUriToBytes(cached);
    const read = window.mdzipStudio?.readMarkdownAsset;
    if (!read) return null;
    try {
      const result = await read({ documentPath, relativePath: archivePath });
      if (!result?.dataUri) return null;
      this.mdAssetCache.set(archivePath, result.dataUri);
      return this.dataUriToBytes(result.dataUri);
    } catch {
      return null;
    }
  }

  // Gather embeddable sibling images referenced by a Markdown document so a
  // conversion can pack them. Desktop-only; best-effort (skips anything it can't
  // read, leaving its link untouched). Keyed by archive path so duplicates and
  // already-embedded references collapse.
  private async collectMarkdownImages(markdown: string): Promise<{ path: string; bytes: Uint8Array }[]> {
    const documentPath = this.currentMarkdownPath;
    if (!documentPath || !window.mdzipStudio?.readMarkdownAsset) return [];
    const seen = new Set<string>();
    const collected: { path: string; bytes: Uint8Array }[] = [];
    for (const ref of this.extractMarkdownImageRefs(markdown)) {
      const archivePath = this.toArchiveAssetPath(ref);
      if (!archivePath || seen.has(archivePath)) continue;
      seen.add(archivePath);
      const bytes = await this.readRelativeImageBytes(documentPath, archivePath);
      if (bytes) collected.push({ path: archivePath, bytes });
    }
    return collected;
  }

  private async rebuildWorkspaceBytes(): Promise<void> {
    const archive = this.currentArchive();
    if (!archive) { this.workspaceBytes.set(null); return; }
    if (this.sourceFormat() === 'markdown') return; // editor manages its own state
    // Skip rebuild for lazy-loaded .mdz archives where no document content has been extracted.
    // The original bytes (already in workspaceBytes) remain the correct representation.
    if (archive.documents.every(d => !d.content)) return;
    this.workspaceBytes.set(await this.buildFreshArchiveBytes(archive));
  }

  exportDraft(): void {
    const archive = this.currentArchive();
    if (!archive) return;

    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
    this.downloadBlob(blob, `${this.toSafeFilename(archive.name)}.mdzip.json`, 'application/json');
    this.statusMessage.set(`Exported ${archive.name} draft`);
  }

  private downloadBlob(blob: Blob, filename: string, type: string): void {
    const typedBlob = blob.type === type ? blob : new Blob([blob], { type });
    const url = URL.createObjectURL(typedBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private bytesToBlob(bytes: Uint8Array, type: string): Blob {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new Blob([buffer], { type });
  }

  addDocument(): void {
    if (!this.currentArchive()) return;
    const nextNumber = this.documents().length + 1;
    const document: Document = {
      id: crypto.randomUUID(),
      name: `document-${nextNumber}.md`,
      content: `# Document ${nextNumber}\n\n`,
      modified: new Date(),
    };
    this.archiveService.addDocument(document);
    this.selectedDocumentId.set(document.id);
    this.latestWorkspaceBytes.set(null);
    this.saveValidationState.set('unchecked');
    this.bumpWorkspaceRevision();
    this.statusMessage.set(`Added ${document.name}`);
  }

  updateSelectedDocument(content: string): void {
    const document = this.selectedDocument();
    if (!document) return;
    this.archiveService.updateDocument(document.id, content);
    this.latestWorkspaceBytes.set(null);
    this.saveValidationState.set('unchecked');
    this.bumpWorkspaceRevision();
  }

  removeSelectedDocument(): void {
    const document = this.selectedDocument();
    if (!document) return;
    this.archiveService.removeDocument(document.id);
    this.selectedDocumentId.set(this.documents()[0]?.id ?? null);
    this.latestWorkspaceBytes.set(null);
    this.saveValidationState.set('unchecked');
    this.bumpWorkspaceRevision();
    this.statusMessage.set(`Deleted ${document.name}`);
  }

  selectDocument(id: string): void {
    this.selectedDocumentId.set(id);
  }

  addAsset(): void {
    if (!this.currentArchive()) return;
    if (this.sourceFormat() === 'markdown') {
      // Sync current markdown text into the archive document before upgrading to .mdz
      const currentBytes = this.latestWorkspaceBytes() ?? this.workspaceBytes();
      if (currentBytes) {
        const doc = this.archiveService.documents()[0];
        if (doc) {
          this.archiveService.updateDocument(doc.id, new TextDecoder().decode(currentBytes));
        }
      }
      this.sourceFormat.set('mdz');
      this.latestWorkspaceBytes.set(null);
    }
    this.assetInput?.nativeElement.click();
  }

  async onAssetFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || !this.currentArchive()) return;

    for (const file of files) {
      const previewUrl = file.type.startsWith('image/')
        ? URL.createObjectURL(file)
        : undefined;
      this.archiveService.addAsset({
        id: crypto.randomUUID(),
        name: `images/${file.name}`,
        type: file.type || 'application/octet-stream',
        size: file.size,
        previewUrl,
      });
    }
    this.latestWorkspaceBytes.set(null);
    this.saveValidationState.set('unchecked');
    this.bumpWorkspaceRevision();
    this.statusMessage.set(`Added ${files.length} file${files.length > 1 ? 's' : ''}`);
  }

  selectAsset(id: string): void {
    this.selectedAssetId.set(id);
  }

  removeAsset(id: string): void {
    this.archiveService.removeAsset(id);
    this.latestWorkspaceBytes.set(null);
    this.bumpWorkspaceRevision();
    this.statusMessage.set('Deleted media');
  }

  onDeleteAsset(event: MouseEvent, id: string): void {
    event.stopPropagation();
    this.removeAsset(id);
  }

  onImageDestinationDialogVisibleChange(visible: boolean): void {
    this.imageDestinationDialogOpen.set(visible);
    if (!visible && this.pendingMarkdownImageDestination === null) {
      this.clearPendingMarkdownImage();
    }
  }

  cancelImageDestination(): void {
    this.clearPendingMarkdownImage();
    this.imageDestinationDialogOpen.set(false);
  }

  confirmConvertToMdz(): void {
    // Start the conversion first — it captures the pending context synchronously,
    // before closing the dialog (whose visibleChange would otherwise clear it).
    void this.convertPendingMarkdownToMdz(true);
    this.convertDialogOpen.set(false);
  }

  cancelConvertToMdz(): void {
    this.convertDialogOpen.set(false);
    this.clearPendingMarkdownImage();
  }

  onConvertDialogVisibleChange(visible: boolean): void {
    this.convertDialogOpen.set(visible);
    // Dismissed (X / Esc) without confirming — drop the pending conversion.
    if (!visible) this.clearPendingMarkdownImage();
  }

  chooseMarkdownImageDestination(destination: 'same' | 'subfolder'): void {
    if (!this.canWriteLinkedMarkdownImage()) {
      this.statusMessage.set('Save the Markdown file before adding a linked image');
      return;
    }
    if (destination === 'subfolder' && !this.isValidImageSubfolder()) {
      this.statusMessage.set('Enter a valid subfolder name');
      return;
    }

    this.pendingMarkdownImageDestination = destination;
    this.imageDestinationDialogOpen.set(false);
    const action = this.pendingConversionAction;
    if (action?.kind === 'image-file') {
      void this.finishPendingMarkdownImage(action.file);
    } else {
      this.markdownImageInput?.nativeElement.click();
    }
  }

  convertMarkdownForImage(): void {
    this.pendingMarkdownImageDestination = 'mdz';
    this.imageDestinationDialogOpen.set(false);
    void this.convertPendingMarkdownToMdz();
  }

  async onMarkdownImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      this.clearPendingMarkdownImage();
      return;
    }
    await this.finishPendingMarkdownImage(file);
  }

  private async finishPendingMarkdownImage(file: File): Promise<void> {
    const destination = this.pendingMarkdownImageDestination;
    try {
      if (!file.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(file.name)) {
        throw new Error('Choose an image file.');
      }
      if (destination === 'same' || destination === 'subfolder') {
        await this.writeLinkedMarkdownImage(
          file,
          destination === 'subfolder' ? this.imageSubfolder().trim() : ''
        );
      }
    } catch (error) {
      this.statusMessage.set(error instanceof Error ? error.message : 'Could not add image');
    } finally {
      this.clearPendingMarkdownImage();
    }
  }

  private async writeLinkedMarkdownImage(file: File, relativeDirectory: string): Promise<void> {
    const documentPath = this.currentArchive()?.path;
    const writeImage = window.mdzipStudio?.writeMarkdownImage;
    if (!documentPath || !writeImage) {
      throw new Error('Save the Markdown file before adding a linked image.');
    }

    const result = await writeImage({
      documentPath,
      relativeDirectory,
      fileName: file.name || 'image',
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
    });
    if (!await this.insertPendingMarkdown(
      this.markdownImageReference(file.name, result.relativePath)
    )) {
      throw new Error('The image was saved, but its Markdown link could not be inserted.');
    }
    this.statusMessage.set(`Added ${result.relativePath}`);
  }

  private async insertPendingMarkdown(text: string): Promise<boolean> {
    return await this.pendingConversionContext?.insertMarkdown(text) ?? false;
  }

  private async convertPendingMarkdownToMdz(revealNav = false): Promise<void> {
    const context = this.pendingConversionContext;
    const editor = this.workspaceEditor;
    try {
      // Capture the current Markdown first so we can embed its loose relative
      // images as archive assets once it becomes an .mdz.
      const preSnapshot = await editor?.flush();
      const markdown = preSnapshot ? new TextDecoder().decode(await preSnapshot.bytes.arrayBuffer()) : '';
      const embeddedImages = markdown ? await this.collectMarkdownImages(markdown) : [];

      if (!context || !editor || !await context.convertToMdz()) {
        throw new Error('Could not convert this document to MDZip.');
      }

      // Pack the document's pre-existing relative images so their links resolve
      // inside the archive. Best-effort: a failed asset just keeps its old link.
      let embeddedCount = 0;
      for (const image of embeddedImages) {
        try {
          await editor.addAsset(image.path, image.bytes);
          embeddedCount++;
        } catch {
          /* leave this image's link as-is */
        }
      }

      const snapshot = await editor.flush();
      if (snapshot) {
        const bytes = new Uint8Array(await snapshot.bytes.arrayBuffer());
        this.archiveService.currentArchive.update((archive) =>
          archive ? { ...archive, path: undefined } : archive
        );
        this.sourceFormat.set('mdz');
        this.workspaceBytes.set(bytes);
        this.latestWorkspaceBytes.set(bytes);
        this.latestWorkspaceSnapshot.set(null);
        // Reveal the file tree when the conversion was triggered by the nav button.
        if (revealNav) this.navigationActive.set(true);
      }
      const imagesNote = embeddedCount > 0
        ? ` — embedded ${embeddedCount} image${embeddedCount === 1 ? '' : 's'}`
        : '';
      // A converted archive lives in memory only until the user saves it.
      const convertedMessage = `Converted to MDZip${imagesNote} · not saved yet — use Save to write it to disk`;
      this.statusMessage.set(convertedMessage);
      // The post-conversion re-render fires a `changed` event that would
      // immediately overwrite this with "Viewing/Editing …". Hold the message
      // through that one programmatic change so the user actually sees it.
      this.postConvertStatus = convertedMessage;
    } catch (error) {
      this.statusMessage.set(error instanceof Error ? error.message : 'Could not add image');
    } finally {
      this.clearPendingMarkdownImage();
    }
  }

  private markdownImageReference(fileName: string, relativePath: string): string {
    const alt = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/[[\]\\]/g, '\\$&');
    const encodedPath = relativePath
      .split('/')
      .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      ))
      .join('/');
    return `![${alt || 'image'}](${encodedPath})`;
  }

  private clearPendingMarkdownImage(): void {
    this.pendingConversionAction = null;
    this.pendingConversionContext = null;
    this.pendingMarkdownImageDestination = null;
  }

  setAssetViewMode(mode: AssetViewMode): void {
    this.assetViewMode.set(mode);
  }

  // Manifest edits no longer invalidate workspace bytes or reload the editor:
  // the current manifest is patched into the bytes at save time
  // (patchManifestIntoBytes), so unsaved editor document edits survive.
  updateManifestField<K extends keyof Manifest>(key: K, value: Manifest[K]): void {
    this.archiveService.updateManifest({ [key]: value });
    if (key === 'mode') {
      this.archiveService.currentArchive.update((archive) =>
        archive ? { ...archive, mode: value as MDZipArchive['mode'] } : archive
      );
    }
    this.saveValidationState.set('unchecked');
  }

  updateDocumentTitle(value: string): void {
    this.archiveService.currentArchive.update((archive) =>
      archive
        ? {
            ...archive,
            name: value || 'Untitled Document',
          }
        : archive
    );
    this.saveValidationState.set('unchecked');
  }

  metadataField(key: string): string {
    const value = this.currentArchive()?.manifest.metadata?.[key];
    if (typeof value === 'string') return value;
    // Spec-shaped author is an object ({ name, email?, url? }); show the name.
    if (value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string') {
      return (value as { name: string }).name;
    }
    return '';
  }

  updateMetadataField(key: string, value: string): void {
    const normalized = value.trim();
    const archive = this.currentArchive();
    const metadata = { ...(archive?.manifest.metadata ?? {}) };
    if (normalized) {
      metadata[key] = normalized;
    } else {
      delete metadata[key];
    }
    this.archiveService.updateManifest({ metadata });
    this.saveValidationState.set('unchecked');
  }

  onManifestEditorChange(change: ManifestEditorChange): void {
    switch (change.field) {
      case 'title':
        this.updateDocumentTitle(change.value);
        break;
      case 'author':
      case 'description':
        this.updateMetadataField(change.field, change.value);
        break;
      case 'mode':
      case 'entryPoint':
        this.updateManifestField(change.field, change.value);
        break;
    }
  }

  async onEmbeddedManifestChange(
    context: MdzipEntryRenderContext,
    change: ManifestEditorChange
  ): Promise<void> {
    if (!context.manifest || context.signal.aborted) return;

    const updates: Parameters<typeof MdzPackagerCore.updateManifest>[1] = {};
    switch (change.field) {
      case 'title':
        updates.title = change.value.trim() || 'Untitled Document';
        break;
      case 'author':
        updates.author = change.value.trim() || null;
        break;
      case 'description':
        updates.description = change.value.trim() || null;
        break;
      case 'mode':
        updates.mode = change.value;
        break;
      case 'entryPoint':
        updates.entryPoint = change.value;
        break;
    }

    const manifest = MdzPackagerCore.updateManifest(context.manifest, updates);
    await context.updateManifest(manifest);
  }

  entryManifestTitle(context: MdzipEntryRenderContext): string {
    return context.manifest?.title ?? this.currentArchive()?.name ?? '';
  }

  entryManifestText(
    context: MdzipEntryRenderContext,
    field: 'author' | 'description'
  ): string {
    const value = context.manifest?.[field];
    if (typeof value === 'string') return value;
    return field === 'author' && value?.name ? value.name : '';
  }

  entryManifestMode(context: MdzipEntryRenderContext): 'document' | 'project' {
    return context.manifest?.mode ?? this.currentArchive()?.mode ?? 'document';
  }

  entryManifestVersion(context: MdzipEntryRenderContext): string {
    return context.manifest?.spec?.version
      ?? context.manifest?.mdz
      ?? this.currentArchive()?.manifest.version
      ?? '1.0.0';
  }

  entryManifestEntryPoint(context: MdzipEntryRenderContext): string {
    return context.manifest?.entryPoint
      ?? this.currentArchive()?.manifest.entryPoint
      ?? this.documentPaths()[0]
      ?? 'index.md';
  }

  onWorkspaceChanged(event: MdzipWorkspaceChange): void {
    this.clearWorkspaceLoad();
    this.latestWorkspaceBytes.set(event.bytes);
    this.latestWorkspaceSnapshot.set(event.snapshot);
    // (changed) fires on load and on structural edits with an authoritative
    // snapshot, so keep isDirty in sync here too. (dirtyChanged only fires on
    // transitions, so on a clean load it wouldn't clear a stale value left over
    // from the previously open document — which showed a false unsaved dot.)
    this.isDirty.set(event.snapshot.dirty);
    this.saveValidationState.set('unchecked');
    // Preserve a just-set conversion message through the conversion's own
    // re-render (one-shot); normal "Viewing/Editing" resumes afterward.
    if (this.postConvertStatus !== null) {
      this.statusMessage.set(this.postConvertStatus);
      this.postConvertStatus = null;
      return;
    }
    const displayName = this.sourceFormat() === 'markdown'
      ? (this.currentArchive()?.name ?? 'Untitled')
      : event.snapshot.currentPath;
    this.statusMessage.set(event.snapshot.dirty ? `Editing ${displayName}` : `Viewing ${displayName}`);
  }

  // The editor's (changed) only fires on structural edits, so plain-text typing
  // is tracked via the dedicated (dirtyChanged) signal instead. This is the
  // single source of truth for the Save button emphasis and the discard guard.
  onWorkspaceDirtyChanged(snapshot: MdzipWorkspaceSnapshot): void {
    this.isDirty.set(snapshot.dirty);
  }

  // The Angular workspace wrapper doesn't expose setColorScheme, but the
  // underlying MdzipWorkspaceView (held privately) does. Reach it to retheme the
  // live editor without recreating the view — recreation would drop unsaved
  // edits, cursor, and scroll. No-ops safely if no document is open.
  private applyOsColorSchemeToEditor(scheme: MdzipColorScheme): void {
    const view = (this.workspaceEditor as unknown as {
      view?: { setColorScheme?: (scheme: MdzipColorScheme) => void } | null;
    } | undefined)?.view;
    view?.setColorScheme?.(scheme);
  }

  onWorkspaceManifestChanged(event: MdzipDocumentChangeEvent): void {
    // Manifest-only edits made inside the editor (e.g. title) no longer flow
    // through (changed) with rebuilt bytes; the editor delegates persistence
    // to the host. Sync the new manifest into app state; it is patched into
    // the archive bytes at save time.
    const manifest = (event.snapshot.workspace?.manifest ?? null) as Record<string, unknown> | null;
    if (!manifest) return;
    const title = typeof manifest['title'] === 'string' && manifest['title'] ? manifest['title'] : null;
    this.archiveService.currentArchive.update((archive) =>
      archive
        ? {
            ...archive,
            name: title ?? archive.name,
            mode: manifest['mode'] === 'project' ? 'project' : 'document',
            manifest: {
              ...archive.manifest,
              version: typeof manifest['mdz'] === 'string'
                ? manifest['mdz']
                : typeof (manifest['spec'] as { version?: unknown } | undefined)?.version === 'string'
                  ? (manifest['spec'] as { version: string }).version
                  : archive.manifest.version,
              mode: manifest['mode'] === 'project' ? 'project' : 'document',
              entryPoint: typeof manifest['entryPoint'] === 'string' ? manifest['entryPoint'] : archive.manifest.entryPoint,
              metadata: this.extractEditableManifestMetadata(manifest),
            },
          }
        : archive
    );
    this.saveValidationState.set('unchecked');
  }

  onWorkspaceSaved(event: MdzipWorkspaceSave): void {
    this.latestWorkspaceBytes.set(event.bytes);
    this.latestWorkspaceSnapshot.set(event.snapshot);
    this.validationIssues.set([
      ...event.snapshot.validation.errors.map((message) => ({ type: 'error' as const, message })),
      ...event.snapshot.validation.warnings.map((message) => ({ type: 'warning' as const, message })),
    ]);
    this.saveValidationState.set(event.snapshot.validation.errors.length === 0 ? 'valid' : 'invalid');
    this.statusMessage.set(`Saved ${event.snapshot.displayTitle}`);
  }

  onWorkspaceFailed(error: unknown): void {
    this.clearWorkspaceLoad();
    this.statusMessage.set(error instanceof Error ? error.message : 'MDZip editor failed');
  }

  validate(): void {
    const archive = this.currentArchive();
    if (!archive) return;
    const result = this.runValidationCheck(archive);
    this.statusMessage.set(result.valid ? 'Document checks passed' : 'Document has technical issues');
  }

  private runValidationCheck(archive: MDZipArchive): { valid: boolean; errors: ValidationError[] } {
    const snapshot = this.latestWorkspaceSnapshot();
    const latestBytes = this.latestWorkspaceBytes();
    if (snapshot && latestBytes) {
      const errors = [
        ...snapshot.validation.errors.map((message) => ({ type: 'error' as const, message })),
        ...snapshot.validation.warnings.map((message) => ({ type: 'warning' as const, message })),
      ];
      const valid = snapshot.validation.errors.length === 0;
      this.validationIssues.set(errors);
      this.saveValidationState.set(valid ? 'valid' : 'invalid');
      return { valid, errors };
    }

    const result = this.validationService.validateArchive(archive);
    this.validationIssues.set(result.errors);
    this.saveValidationState.set(result.valid ? 'valid' : 'invalid');
    return result;
  }

  treeNodeIcon(node: TreeNode<ArchiveTreeData>): string {
    if (node.data?.kind === 'folder') {
      return node.expanded ? 'lucideFolderOpen' : 'lucideFolder';
    }
    if (node.data?.kind === 'asset') {
      return node.data.asset && this.isImageAsset(node.data.asset) ? 'lucideImage' : 'lucideFile';
    }
    return 'lucideFilePen';
  }

  recentFileName(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop() ?? path;
  }

  // Prefer a cached .mdz manifest title; fall back to the bare file name.
  recentDisplayName(path: string): string {
    return this.recentTitles()[path] ?? this.recentFileName(path);
  }

  recentFilePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  formatSize(bytes: number): string {
    if (bytes === 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
  }

  isImageAsset(asset: Asset): boolean {
    return asset.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?)$/i.test(asset.name);
  }

  assetDisplayName(asset: Asset): string {
    const parts = this.archivePathParts(asset.name);
    return parts.at(-1) ?? asset.name;
  }

  assetFolder(asset: Asset): string {
    const parts = this.archivePathParts(asset.name);
    return parts.length > 1 ? parts.slice(0, -1).join('/') : 'Document root';
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }

  selectArchiveTreeNode(node: TreeNode<ArchiveTreeData>): void {
    if (node.data?.document) {
      this.selectDocument(node.data.document.id);
    } else if (node.data?.asset) {
      this.selectAsset(node.data.asset.id);
    }
  }

  private parseArchiveDraft(text: string, fallbackName: string, filePath?: string): MDZipArchive {
    const parsed = JSON.parse(text) as Partial<MDZipArchive>;
    if (!parsed.documents || !parsed.manifest) {
      throw new Error('This file is not an MDZip Studio JSON draft.');
    }

    return {
      name: parsed.name ?? fallbackName,
      path: filePath ?? parsed.path,
      mode: parsed.mode === 'project' ? 'project' : 'document',
      documents: parsed.documents.map((document) => ({
        ...document,
        modified: new Date(document.modified),
      })),
      assets: parsed.assets ?? [],
      manifest: parsed.manifest,
    };
  }

  private async parseMdzBytes(bytes: Uint8Array, name: string, filePath?: string): Promise<MDZipArchive> {
    const mdz = await MdzArchiveCore.open(bytes);
    const manifest = await mdz.readManifest();
    const entries = mdz.listEntries().filter((entry) => !entry.isDirectory);
    const documents: Document[] = [];
    const assets: Asset[] = [];

    for (const entry of entries) {
      if (entry.path === 'manifest.json') continue;
      if (entry.isMarkdown) {
        documents.push({
          id: crypto.randomUUID(),
          name: entry.path,
          content: '', // workspace reads content directly from bytes; no need to extract upfront
          modified: new Date(),
        });
      } else {
        // Size and preview are loaded lazily; reading bytes at parse time is too slow for large archives.
        assets.push({
          id: crypto.randomUUID(),
          name: entry.path,
          type: entry.isImage ? this.imageMimeType(entry.path) : 'application/octet-stream',
          size: 0,
          previewUrl: undefined,
        });
      }
    }

    const entryPoint = manifest?.entryPoint ?? documents[0]?.name ?? 'index.md';
    return {
      name: manifest?.title ?? name.replace(/\.mdz$/i, ''),
      path: filePath,
      mode: manifest?.mode ?? 'document',
      documents,
      assets,
      manifest: {
        version: manifest?.version ?? manifest?.spec?.version ?? '1.0.0',
        mode: manifest?.mode ?? 'document',
        entryPoint,
        metadata: this.extractEditableManifestMetadata(manifest as Record<string, unknown> | null),
      },
    };
  }

  private static readonly EDITABLE_MANIFEST_KEYS: readonly string[] = [
    'author',
    'description',
    'keywords',
    'language',
    'license',
    'cover',
  ];

  private toMdzManifest(archive: MDZipArchive, current: MdzManifest | null = null): MdzManifest {
    const metadata = this.editableManifestMetadata(archive.manifest.metadata);
    const updates: Record<string, unknown> = {
      title: archive.name,
      mode: archive.mode,
      entryPoint: archive.manifest.entryPoint,
    };
    // Absent editable fields are passed as null so updateManifest clears them
    // (fields the user emptied in the Internals tab must not survive a merge).
    for (const key of AppComponent.EDITABLE_MANIFEST_KEYS) {
      updates[key] = key in metadata ? metadata[key] : null;
    }
    const manifest = MdzPackagerCore.updateManifest(
      current,
      updates as Parameters<typeof MdzPackagerCore.updateManifest>[1]
    );
    // Carry custom metadata keys the spec helpers don't model. 'authors' is
    // derived from 'author' by updateManifest, so a stale copy must not win.
    for (const [key, value] of Object.entries(metadata)) {
      if (!AppComponent.EDITABLE_MANIFEST_KEYS.includes(key) && key !== 'authors') {
        (manifest as unknown as Record<string, unknown>)[key] = value;
      }
    }
    manifest.producer = {
      ...manifest.producer,
      application: { name: 'MDZip Studio', version: APP_VERSION },
    };
    return manifest;
  }

  private extractEditableManifestMetadata(manifest: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!manifest) {
      return {};
    }
    return this.editableManifestMetadata(manifest);
  }

  private editableManifestMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!metadata) {
      return {};
    }
    const {
      mdz: _mdz,
      spec: _spec,
      producer: _producer,
      title: _title,
      mode: _mode,
      entryPoint: _entryPoint,
      version: _version,
      modified: _modified,
      files: _files,
      ...editable
    } = metadata;
    return editable;
  }

  private toSafeFilename(name: string): string {
    return name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'archive';
  }

  private bumpWorkspaceRevision(): void {
    void this.rebuildWorkspaceBytes();
  }

  private buildTree(items: Document[], kind: 'document'): TreeNode<ArchiveTreeData>[];
  private buildTree(items: Asset[], kind: 'asset'): TreeNode<ArchiveTreeData>[];
  private buildTree(items: Array<Document | Asset>, kind: 'document' | 'asset'): TreeNode<ArchiveTreeData>[] {
    const root: TreeNode<ArchiveTreeData>[] = [];

    for (const item of items) {
      const parts = this.archivePathParts(item.name);
      let siblings = root;
      let currentPath = '';

      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLeaf = index === parts.length - 1;

        if (isLeaf) {
          siblings.push({
            key: `${kind}:${currentPath}`,
            label: part,
            leaf: true,
            data: {
              kind,
              path: currentPath,
              document: kind === 'document' ? (item as Document) : undefined,
              asset: kind === 'asset' ? (item as Asset) : undefined,
            },
          });
          return;
        }

        let folder = siblings.find(
          (node) => node.data?.kind === 'folder' && node.label?.toLocaleLowerCase() === part.toLocaleLowerCase()
        );
        if (!folder) {
          folder = {
            key: `folder:${currentPath}`,
            label: part,
            expanded: true,
            children: [],
            selectable: false,
            data: {
              kind: 'folder',
              path: currentPath,
            },
          };
          siblings.push(folder);
        }
        siblings = folder.children ?? [];
      });
    }

    return this.sortTree(root);
  }

  private findTreeNode(
    nodes: TreeNode<ArchiveTreeData>[],
    predicate: (node: TreeNode<ArchiveTreeData>) => boolean
  ): TreeNode<ArchiveTreeData> | null {
    for (const node of nodes) {
      if (predicate(node)) {
        return node;
      }
      const match = this.findTreeNode(node.children ?? [], predicate);
      if (match) {
        return match;
      }
    }
    return null;
  }

  private archivePathParts(path: string): string[] {
    return path
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private imageMimeType(path: string): string {
    const extension = path.split('.').pop()?.toLocaleLowerCase();
    switch (extension) {
      case 'apng': return 'image/apng';
      case 'avif': return 'image/avif';
      case 'bmp': return 'image/bmp';
      case 'gif': return 'image/gif';
      case 'ico': return 'image/x-icon';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'svg': return 'image/svg+xml';
      case 'tif':
      case 'tiff': return 'image/tiff';
      case 'webp': return 'image/webp';
      default: return 'image/*';
    }
  }

  private sortTree(nodes: TreeNode<ArchiveTreeData>[]): TreeNode<ArchiveTreeData>[] {
    return nodes
      .map((node) => ({
        ...node,
        children: this.sortTree(node.children ?? []),
      }))
      .sort((a, b) => {
        if (a.data?.kind === 'folder' && b.data?.kind !== 'folder') return -1;
        if (a.data?.kind !== 'folder' && b.data?.kind === 'folder') return 1;
        return (a.label ?? '').localeCompare(b.label ?? '', undefined, { sensitivity: 'base' });
      });
  }
}
