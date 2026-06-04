import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationComponent } from './modules/navigation/navigation.component';
import { EditorComponent } from './modules/editor/editor.component';
import { WelcomeComponent } from './modules/welcome/welcome.component';
import { DialogContainerComponent } from './modules/dialogs/dialog-container.component';
import { ArchiveService, MDZipArchive } from './core/services/archive.service';
import { StorageService } from './core/services/storage.service';
import { ValidationService } from './core/services/validation.service';
import { DialogService } from './core/services/dialog.service';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    NavigationComponent,
    EditorComponent,
    WelcomeComponent,
    DialogContainerComponent,
  ],
  template: `
    <div class="app-container">
      <div class="menu-bar">
        <div class="app-title">MDZip Studio</div>
        <div class="archive-info" *ngIf="currentArchive">
          {{ currentArchive.name }}
          <span class="badge">{{ currentArchive.mode }}</span>
        </div>
      </div>

      <div class="main-content">
        <div class="navigation-pane">
          <app-navigation
            (newArchive)="onNewArchive()"
            (openArchive)="onOpenArchive()"
            (addDocument)="onAddDocument()"
            (addAsset)="onAddAsset()"
            (editManifest)="onEditManifest()"
            (validate)="onValidate()"
            (documentSelected)="onDocumentSelected($event)"
          ></app-navigation>
        </div>

        <div class="workspace-area">
          <app-welcome
            *ngIf="!currentArchive"
            [recentFiles]="recentFiles"
            (newArchive)="onNewArchive()"
            (openArchive)="onOpenArchive()"
            (openRecent)="onOpenRecent($event)"
          ></app-welcome>

          <app-editor *ngIf="currentArchive"></app-editor>
        </div>
      </div>

      <div class="status-bar">
        <span>{{ statusMessage }}</span>
      </div>

      <app-dialog-container></app-dialog-container>
    </div>
  `,
  styles: [`
    .app-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #ffffff;
      color: #333;
    }

    .menu-bar {
      background: #2d2d2d;
      color: white;
      padding: 8px 16px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 16px;
      border-bottom: 1px solid #1e1e1e;
    }

    .app-title {
      font-size: 14px;
    }

    .archive-info {
      font-size: 12px;
      opacity: 0.8;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .badge {
      background: #007acc;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      text-transform: uppercase;
    }

    .main-content {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .navigation-pane {
      width: 250px;
      border-right: 1px solid #ddd;
      overflow-y: auto;
      background: #fafafa;
    }

    .workspace-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .status-bar {
      background: #f5f5f5;
      border-top: 1px solid #ddd;
      padding: 6px 16px;
      font-size: 12px;
      color: #666;
      height: 22px;
      display: flex;
      align-items: center;
    }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  currentArchive: MDZipArchive | null = null;
  recentFiles: string[] = [];
  statusMessage = 'Ready';
  private destroy$ = new Subject<void>();

  constructor(
    private archiveService: ArchiveService,
    private storageService: StorageService,
    private validationService: ValidationService,
    private dialogService: DialogService
  ) {}

  ngOnInit() {
    this.archiveService.currentArchive
      .pipe(takeUntil(this.destroy$))
      .subscribe((archive) => {
        this.currentArchive = archive;
      });

    this.recentFiles = this.storageService.getRecentFiles();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onNewArchive() {
    const name = prompt('Archive name:', 'My Archive');
    if (!name) return;

    const mode = confirm('Create as Project mode? (OK=Project, Cancel=Document)')
      ? 'project'
      : 'document';

    const archive = this.archiveService.createNewArchive(name, mode);
    this.statusMessage = `Created new ${mode} archive: ${name}`;

    // Add an initial document
    this.archiveService.addDocument({
      id: '1',
      name: 'index.md',
      content: '# Welcome\n\nStart editing your MDZip archive here.',
      modified: new Date(),
    });
  }

  onOpenArchive() {
    this.statusMessage = 'Opening archive... (Not yet implemented)';
    // TODO: Implement file dialog
  }

  onAddDocument() {
    const name = prompt('Document name:', 'new-document.md');
    if (!name) return;

    this.archiveService.addDocument({
      id: Date.now().toString(),
      name,
      content: '',
      modified: new Date(),
    });

    this.statusMessage = `Added document: ${name}`;
  }

  onAddAsset() {
    const name = prompt('Asset name:', 'image.png');
    if (!name) return;

    this.archiveService.addAsset({
      id: Date.now().toString(),
      name,
      type: 'image/png',
      size: 0,
    });

    this.statusMessage = `Added asset: ${name}`;
  }

  onEditManifest() {
    if (!this.currentArchive) return;

    this.dialogService.openManifestDialog(this.currentArchive.manifest);
    this.statusMessage = 'Editing manifest...';
  }

  onValidate() {
    if (!this.currentArchive) return;

    const result = this.validationService.validateArchive(this.currentArchive);
    this.dialogService.openValidationDialog(result);

    if (result.valid) {
      this.statusMessage = 'Archive is valid ✓';
    } else {
      const errorCount = result.errors.filter((e) => e.type === 'error').length;
      this.statusMessage = `Validation failed: ${errorCount} error(s)`;
    }
  }

  onDocumentSelected(id: string) {
    this.statusMessage = `Selected document`;
  }

  onOpenRecent(path: string) {
    this.statusMessage = `Opening ${path}... (Not yet implemented)`;
    // TODO: Implement opening recent files
  }
}
