import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ArchiveService, Document } from '../../core/services/archive.service';
import { ValidationService } from '../../core/services/validation.service';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="editor-container">
      <div class="editor-tabs">
        <button
          *ngFor="let doc of documents"
          [class.active]="selectedDocId === doc.id"
          (click)="selectDocument(doc.id)"
          class="tab-button"
        >
          {{ doc.name }}
          <span class="close-btn" (click)="closeDocument($event, doc.id)"
            >×</span
          >
        </button>
      </div>

      <div class="editor-area" *ngIf="selectedDocument">
        <textarea
          [(ngModel)]="selectedDocument.content"
          (change)="onDocumentChange()"
          class="markdown-editor"
          placeholder="Enter Markdown content..."
        ></textarea>

        <div class="editor-info">
          <span>{{ selectedDocument.name }}</span>
          <span>{{ selectedDocument.modified | date : 'short' }}</span>
        </div>
      </div>

      <div class="empty-state" *ngIf="!selectedDocument">
        <p>No document selected</p>
      </div>
    </div>
  `,
  styles: [`
    .editor-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .editor-tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid #ddd;
      background: #f5f5f5;
      padding: 4px;
      overflow-x: auto;
    }

    .tab-button {
      padding: 8px 12px;
      background: #e8e8e8;
      border: 1px solid #ccc;
      border-radius: 4px 4px 0 0;
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }

    .tab-button:hover {
      background: #d8d8d8;
    }

    .tab-button.active {
      background: white;
      border-bottom-color: white;
    }

    .close-btn {
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      opacity: 0.6;
      transition: opacity 0.2s;
    }

    .close-btn:hover {
      opacity: 1;
    }

    .editor-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .markdown-editor {
      flex: 1;
      padding: 16px;
      border: none;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      resize: none;
      outline: none;
      background: white;
    }

    .editor-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      background: #f5f5f5;
      border-top: 1px solid #ddd;
      font-size: 12px;
      color: #666;
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: #999;
    }
  `],
})
export class EditorComponent implements OnInit {
  documents: Document[] = [];
  selectedDocId: string | null = null;

  get selectedDocument(): Document | undefined {
    return this.documents.find((d) => d.id === this.selectedDocId);
  }

  constructor(
    private archiveService: ArchiveService,
    private validationService: ValidationService
  ) {}

  ngOnInit() {
    this.archiveService.currentArchive.subscribe((archive) => {
      if (archive) {
        this.documents = archive.documents;
        if (this.documents.length > 0 && !this.selectedDocId) {
          this.selectDocument(this.documents[0].id);
        }
      } else {
        this.documents = [];
        this.selectedDocId = null;
      }
    });
  }

  selectDocument(id: string) {
    this.selectedDocId = id;
  }

  closeDocument(event: Event, id: string) {
    event.stopPropagation();
    this.archiveService.removeDocument(id);
    if (this.selectedDocId === id) {
      this.selectedDocId = this.documents[0]?.id ?? null;
    }
  }

  onDocumentChange() {
    if (this.selectedDocId && this.selectedDocument) {
      this.archiveService.updateDocument(
        this.selectedDocId,
        this.selectedDocument.content
      );

      const errors = this.validationService.validateMarkdown(
        this.selectedDocument.content
      );
      if (errors.length > 0) {
        console.log('Validation issues:', errors);
      }
    }
  }
}
