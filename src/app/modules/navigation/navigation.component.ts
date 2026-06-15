import { Component, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArchiveService, Document, Asset } from '../../core/services/archive.service';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="navigation-container">
      <div class="nav-section">
        <h3>Document</h3>
        <button (click)="onNewArchive()" class="nav-button">
          <span class="icon">+</span> New
        </button>
        <button (click)="onOpenArchive()" class="nav-button">
          <span class="icon">📂</span> Open
        </button>
      </div>

      <div class="nav-section" *ngIf="archiveOpen">
        <h3>Documents</h3>
        <div class="nav-items">
          <div
            *ngFor="let doc of documents"
            [class.active]="selectedDocId === doc.id"
            (click)="selectDocument(doc.id)"
            class="nav-item"
            title="{{ doc.name }}"
          >
            <span class="icon">📄</span> {{ doc.name }}
          </div>
        </div>
        <button (click)="onAddDocument()" class="nav-button small">
          <span class="icon">+</span> Add Document
        </button>
      </div>

      <div class="nav-section" *ngIf="archiveOpen">
        <h3>Media</h3>
        <div class="nav-items">
          <div
            *ngFor="let asset of assets"
            class="nav-item"
            title="{{ asset.name }}"
          >
            <span class="icon">🖼️</span> {{ asset.name }}
          </div>
        </div>
        <button (click)="onAddAsset()" class="nav-button small">
          <span class="icon">+</span> Add Asset
        </button>
      </div>

      <div class="nav-section" *ngIf="archiveOpen">
        <h3>Manifest</h3>
        <button (click)="onEditManifest()" class="nav-button small">
          <span class="icon">⚙️</span> Edit
        </button>
      </div>

      <div class="nav-section" *ngIf="archiveOpen">
        <h3>Tools</h3>
        <button (click)="onValidate()" class="nav-button small">
          <span class="icon">✓</span> Validate
        </button>
      </div>
    </div>
  `,
  styles: [`
    .navigation-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 8px;
      gap: 16px;
    }

    .nav-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .nav-section h3 {
      margin: 0;
      font-size: 11px;
      text-transform: uppercase;
      color: #666;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .nav-button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .nav-button:hover {
      background: #005a9e;
      transform: translateX(2px);
    }

    .nav-button.small {
      background: #e0e0e0;
      color: #333;
    }

    .nav-button.small:hover {
      background: #d0d0d0;
    }

    .nav-items {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 200px;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: #f5f5f5;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .nav-item:hover {
      background: #e8e8e8;
    }

    .nav-item.active {
      background: #e3f2fd;
      color: #007acc;
      border-color: #007acc;
      font-weight: 500;
    }

    .icon {
      flex-shrink: 0;
      display: inline-block;
      width: 16px;
      text-align: center;
    }
  `],
})
export class NavigationComponent implements OnInit {
  @Output() newArchive = new EventEmitter<void>();
  @Output() openArchive = new EventEmitter<void>();
  @Output() addDocument = new EventEmitter<void>();
  @Output() addAsset = new EventEmitter<void>();
  @Output() editManifest = new EventEmitter<void>();
  @Output() validate = new EventEmitter<void>();
  @Output() documentSelected = new EventEmitter<string>();

  archiveOpen = false;
  documents: Document[] = [];
  assets: Asset[] = [];
  selectedDocId: string | null = null;

  constructor(private archiveService: ArchiveService) {}

  ngOnInit() {
    this.archiveService.currentArchive.subscribe((archive) => {
      this.archiveOpen = !!archive;
      if (archive) {
        this.documents = archive.documents;
        this.assets = archive.assets;
      } else {
        this.documents = [];
        this.assets = [];
        this.selectedDocId = null;
      }
    });
  }

  onNewArchive() {
    this.newArchive.emit();
  }

  onOpenArchive() {
    this.openArchive.emit();
  }

  selectDocument(id: string) {
    this.selectedDocId = id;
    this.documentSelected.emit(id);
  }

  onAddDocument() {
    this.addDocument.emit();
  }

  onAddAsset() {
    this.addAsset.emit();
  }

  onEditManifest() {
    this.editManifest.emit();
  }

  onValidate() {
    this.validate.emit();
  }
}
