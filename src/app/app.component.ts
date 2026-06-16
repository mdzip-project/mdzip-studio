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
    }),
  ],
  template: `
    <main class="app-shell">
      @if (isLoading()) {
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
                  <li class="menu-sep" role="separator"></li>
                  @if (isDesktopShell()) {
                    <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!currentArchive()" (click)="saveArchive(); closeMenu()"><ng-icon name="lucideSave" size="13" /><span>Save</span><kbd>Ctrl+S</kbd></button></li>
                    <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!currentArchive()" (click)="saveArchive(true); closeMenu()"><ng-icon name="lucideSaveAll" size="13" /><span>Save As...</span><kbd>Ctrl+Shift+S</kbd></button></li>
                  } @else {
                    <li role="none"><button class="menu-item" type="button" role="menuitem" [disabled]="!currentArchive()" (click)="saveArchive(); closeMenu()"><ng-icon name="lucideDownload" size="13" /><span>Download</span><kbd>Ctrl+S</kbd></button></li>
                  }
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
            <button class="tb-btn" type="button" [title]="readOnly() ? readOnlyHint : 'Save (Ctrl+S)'" [disabled]="!currentArchive() || readOnly()" (click)="saveArchive()"><ng-icon name="lucideSave" size="15" /></button>
            <button class="tb-btn" type="button" [title]="readOnly() ? 'Save As — save your changes to a new file (Ctrl+Shift+S)' : 'Save As (Ctrl+Shift+S)'" [disabled]="!currentArchive()" (click)="saveArchive(true)"><ng-icon name="lucideSaveAll" size="15" /></button>
          } @else {
            <button class="tb-btn" type="button" title="Download (Ctrl+S)" [disabled]="!currentArchive()" (click)="saveArchive()"><ng-icon name="lucideDownload" size="15" /></button>
          }
        </div>
        <input #fileInput class="file-input" type="file" accept=".md,.mdz,.json,text/markdown,application/json" (change)="openArchive($event)" />
        <input #assetInput class="file-input" type="file" multiple accept="image/*,video/*,audio/*,application/pdf,.svg" (change)="onAssetFileSelected($event)" />
        <input #markdownImageInput class="file-input" type="file" accept="image/*,.svg" (change)="onMarkdownImageSelected($event)" />
      </header>

      <section class="workspace">
        <section class="content">
          @if (!currentArchive()) {
            <div class="empty-state">
              <picture>
                <source srcset="assets/mdzip-mark/mdzip-mark-open-square-dark.svg" media="(prefers-color-scheme: dark)" />
                <img class="empty-mark" src="assets/mdzip-mark/mdzip-mark-open-square.svg" alt="" />
              </picture>
              <h2>Create or open a document</h2>
              <p>Write, add images, and save everything together in one portable file.</p>
              <div class="empty-actions">
                <p-button label="Create Document" (onClick)="newArchive()">
                  <ng-template #icon><ng-icon name="lucidePlus" size="14" /></ng-template>
                </p-button>
                <p-button label="Open Document" severity="secondary" (onClick)="openFilePicker()">
                  <ng-template #icon><ng-icon name="lucideFolderOpen" size="14" /></ng-template>
                </p-button>
              </div>
              @if (recentFiles().length > 0) {
                <div class="recent-files">
                  <h3>Recent</h3>
                  <div class="recent-list">
                    @for (path of recentFiles(); track path) {
                      <button class="recent-item" type="button" (click)="openFilePicker()" [title]="path">
                        <ng-icon name="lucideClock" size="14" />
                        <div class="recent-meta">
                          <span class="recent-name">{{ recentFileName(path) }}</span>
                          <span class="recent-path">{{ recentFileDir(path) }}</span>
                        </div>
                      </button>
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
                [navigationButtonActive]="false"
                (changed)="onWorkspaceChanged($event)"
                (manifestChanged)="onWorkspaceManifestChanged($event)"
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

    <p-dialog header="Create Document" [visible]="newDialogOpen()" (visibleChange)="newDialogOpen.set($event)" [modal]="true" [style]="{ width: 'min(92vw, 440px)' }">
      <div class="dialog-form">
        <label>
          Name
          <input type="text" [(ngModel)]="newArchiveName" autofocus />
        </label>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="newDialogOpen.set(false)" />
        <p-button label="Create" (onClick)="createArchiveFromDialog()">
          <ng-template #icon><ng-icon name="lucidePlus" size="14" /></ng-template>
        </p-button>
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
  readonly workspaceBytes = signal<Uint8Array | null>(null);
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
  readonly markdownExtensions: readonly MdzipMarkdownRenderExtension[] = [mdzipMermaidExtension()];

  readonly appVersion = APP_VERSION;
  readonly newDialogOpen = signal(false);
  newArchiveName = 'My Archive';
  newArchiveMode: 'document' | 'project' = 'document';
  readonly aboutOpen = signal(false);
  readonly aboutTab = signal<'about' | 'libraries' | 'license' | 'debug'>('about');
  readonly debugCopied = signal(false);
  readonly mdDefaultPromptOpen = signal(false);
  readonly mdDefaultBusy = signal(false);
  private static readonly MD_DEFAULT_PROMPT_KEY = 'mdDefaultPromptSeen';
  readonly imageDestinationDialogOpen = signal(false);
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
  private pendingMarkdownImageDestination: 'same' | 'subfolder' | 'mdz' | null = null;
  private removeOpenDocumentRequestedListener: (() => void) | null = null;
  private pendingElectronOpen: Promise<boolean> | null = null;
  private electronOpenRequestedWhilePending = false;

  readonly handleConversionRequested = (
    action: MdzipConversionAction,
    context: MdzipConversionContext
  ): boolean => {
    if (action.kind === 'navigation') {
      return false;
    }
    this.pendingConversionAction = action;
    this.pendingConversionContext = context;
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
  private readonly handleExportDraftCommand = () => this.exportDraft();
  private readonly handleShowAboutCommand = () => this.showAbout();
  private readonly handleSetMdDefaultCommand = () => void this.promptMarkdownDefaultManually();

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

    window.addEventListener('mdzip-studio:new-archive', this.handleNewArchiveCommand);
    window.addEventListener('mdzip-studio:open-archive', this.handleOpenArchiveCommand);
    window.addEventListener('mdzip-studio:save-archive', this.handleSaveArchiveCommand);
    window.addEventListener('mdzip-studio:save-archive-as', this.handleSaveArchiveAsCommand);
    window.addEventListener('mdzip-studio:export-draft', this.handleExportDraftCommand);
    window.addEventListener('mdzip-studio:show-about', this.handleShowAboutCommand);
    window.addEventListener('mdzip-studio:set-md-default', this.handleSetMdDefaultCommand);
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
      // Open it first and only fall back to a blank untitled doc if nothing was
      // pending. Creating the untitled archive up-front would feed the workspace
      // an empty `index.md` and then race its async parse against the incoming
      // document, leaving the editor stuck on the empty untitled archive.
      this.isLoading.set(true);
      void this.openPendingElectronDocument().then((opened) => {
        if (!opened) {
          this.isLoading.set(false);
          this.createUntitledArchive();
        }
      });
    } else {
      this.createUntitledArchive();
    }

    void this.maybePromptMarkdownDefault();
  }

  ngOnDestroy(): void {
    window.removeEventListener('mdzip-studio:new-archive', this.handleNewArchiveCommand);
    window.removeEventListener('mdzip-studio:open-archive', this.handleOpenArchiveCommand);
    window.removeEventListener('mdzip-studio:save-archive', this.handleSaveArchiveCommand);
    window.removeEventListener('mdzip-studio:save-archive-as', this.handleSaveArchiveAsCommand);
    window.removeEventListener('mdzip-studio:export-draft', this.handleExportDraftCommand);
    window.removeEventListener('mdzip-studio:show-about', this.handleShowAboutCommand);
    window.removeEventListener('mdzip-studio:set-md-default', this.handleSetMdDefaultCommand);
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

  newArchive(): void {
    this.newDialogOpen.set(true);
  }

  openFilePicker(): void {
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

  private createUntitledArchive(): void {
    this.archiveService.createNewArchive('Untitled', 'document');
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
    this.sourceFormat.set('markdown');
    this.workspaceBytes.set(new TextEncoder().encode(''));
    this.readOnly.set(false);
    this.statusMessage.set('New document');
  }

  createArchiveFromDialog(): void {
    const name = this.newArchiveName.trim() || 'Untitled';
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
    this.sourceFormat.set('markdown');
    this.workspaceBytes.set(new TextEncoder().encode(''));
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

  private async openDocumentBytes(bytes: Uint8Array, name: string, filePath?: string, readOnly = false): Promise<void> {
    this.readOnly.set(readOnly);
    // isLoading is set (and a paint yielded) by the caller before reading bytes.
    this.latestWorkspaceBytes.set(null);
    this.latestWorkspaceSnapshot.set(null);
    this.validationIssues.set([]);
    this.saveValidationState.set('unchecked');

    try {
      const lowerName = name.toLowerCase();
      if (lowerName.endsWith('.mdz')) {
        const archive = await this.parseMdzBytes(bytes, name, filePath);
        this.archiveService.loadArchive(archive);
        this.sourceFormat.set('mdz');
        this.workspaceBytes.set(bytes);
      } else if (lowerName.endsWith('.md')) {
        const content = new TextDecoder().decode(bytes);
        const archiveName = name.replace(/\.md$/i, '');
        this.archiveService.createNewArchive(archiveName, 'document');
        this.archiveService.addDocument({
          id: crypto.randomUUID(),
          name,
          content,
          modified: new Date(),
        });
        this.sourceFormat.set('markdown');
        this.workspaceBytes.set(bytes);
      } else {
        const archive = this.parseArchiveDraft(new TextDecoder().decode(bytes), name, filePath);
        this.archiveService.loadArchive(archive);
        this.sourceFormat.set('mdz');
        void this.rebuildWorkspaceBytes();
      }

      this.storageService.addRecentFile(filePath ?? name);
      this.recentFiles.set(this.storageService.getRecentFiles());
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
        const convertedArchive: MDZipArchive = {
          ...archive,
          documents: archive.documents.map((document, index) =>
            index === 0 ? { ...document, content: markdownContent } : document
          ),
        };
        const mdzBytes = await this.buildFreshArchiveBytes(convertedArchive);
        let result: ElectronDocumentSaveResult;
        try {
          result = await window.mdzipStudio.saveDocument({
            filePath: archive.path,
            defaultName,
            bytes: Array.from(bytes),
            mdzBytes: Array.from(mdzBytes),
            saveAs,
          });
        } catch (error) {
          this.statusMessage.set(`Save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
          return;
        }
        if (result.canceled) { this.statusMessage.set('Save canceled'); return; }

        this.updateArchivePath(result.filePath, result.name);
        this.workspaceEditor?.markPersisted();
        this.readOnly.set(false);
        if (result.format === 'mdz') {
          const firstDocument = archive.documents[0];
          if (firstDocument) {
            this.archiveService.updateDocument(firstDocument.id, markdownContent);
          }
          this.sourceFormat.set('mdz');
          this.workspaceBytes.set(mdzBytes);
          this.latestWorkspaceBytes.set(null);
          this.latestWorkspaceSnapshot.set(null);
        }
        this.statusMessage.set(`Saved ${result.name ?? archive.name}`);
        return;
      }

      this.downloadBlob(this.bytesToBlob(bytes, 'text/markdown'), defaultName, 'text/markdown');
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
      this.updateArchivePath(result.filePath, result.name);
      this.workspaceEditor?.markPersisted();
      this.readOnly.set(false);
      this.statusMessage.set(validation.valid ? `Saved ${result.name ?? archive.name}` : `Saved ${result.name ?? archive.name} with technical issues`);
      return;
    }

    this.downloadBlob(this.bytesToBlob(bytes, 'application/vnd.mdzip'), defaultName, 'application/vnd.mdzip');
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

  private async buildFreshArchiveBytes(archive: MDZipArchive): Promise<Uint8Array> {
    const result = await MdzPackagerCore.buildArchive(
      [
        ...archive.documents.map((document) => ({
          path: document.name,
          text: document.content,
        })),
        {
          path: 'manifest.json',
          text: JSON.stringify(this.toMdzManifest(archive), null, 2),
        },
      ],
      archive.name,
      {
        createIndex: archive.documents.length === 0,
        mapFiles: true,
        filters: MdzPackagerCore.DEFAULT_FILTERS,
        title: archive.name,
        mode: archive.mode,
        entryPoint: archive.manifest.entryPoint,
      }
    );
    return new Uint8Array(await result.blob.arrayBuffer());
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

  private async convertPendingMarkdownToMdz(): Promise<void> {
    const context = this.pendingConversionContext;
    const editor = this.workspaceEditor;
    try {
      if (!context || !editor || !await context.convertToMdz()) {
        throw new Error('Could not convert this document to MDZip.');
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
      }
      this.statusMessage.set('Converted to MDZip and added image');
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
    this.saveValidationState.set('unchecked');
    const displayName = this.sourceFormat() === 'markdown'
      ? (this.currentArchive()?.name ?? 'Untitled')
      : event.snapshot.currentPath;
    this.statusMessage.set(event.snapshot.dirty ? `Editing ${displayName}` : `Viewing ${displayName}`);
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

  recentFileDir(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.slice(0, idx) : '';
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
