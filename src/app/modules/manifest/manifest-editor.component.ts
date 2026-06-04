import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Manifest } from '../../core/services/archive.service';

@Component({
  selector: 'app-manifest-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="manifest-container">
      <div class="manifest-header">
        <h2>Archive Manifest</h2>
        <button (click)="close()" class="close-btn">✕</button>
      </div>

      <form (ngSubmit)="save()" class="manifest-form">
        <div class="form-group">
          <label>Mode</label>
          <select [(ngModel)]="editingManifest.mode" name="mode">
            <option value="document">Document</option>
            <option value="project">Project</option>
          </select>
        </div>

        <div class="form-group">
          <label>Version</label>
          <input
            type="text"
            [(ngModel)]="editingManifest.version"
            name="version"
            placeholder="1.0.0"
          />
        </div>

        <div class="form-group">
          <label>Entry Point</label>
          <input
            type="text"
            [(ngModel)]="editingManifest.entryPoint"
            name="entryPoint"
            placeholder="index.md"
          />
        </div>

        <div class="form-group">
          <label>Metadata (JSON)</label>
          <textarea
            [(ngModel)]="metadataJson"
            name="metadata"
            placeholder="{}"
            rows="6"
          ></textarea>
        </div>

        <div class="form-actions">
          <button type="submit" class="primary-btn">Save</button>
          <button type="button" (click)="close()" class="secondary-btn">
            Cancel
          </button>
        </div>
      </form>

      <div class="manifest-preview" *ngIf="manifest">
        <h3>Preview</h3>
        <pre>{{ manifest | json }}</pre>
      </div>
    </div>
  `,
  styles: [`
    .manifest-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }

    .manifest-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid #ddd;
      background: #f5f5f5;
    }

    .manifest-header h2 {
      margin: 0;
      font-size: 18px;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #666;
    }

    .manifest-form {
      padding: 20px;
      flex: 1;
    }

    .form-group {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
    }

    .form-group label {
      font-weight: 600;
      margin-bottom: 8px;
      color: #333;
      font-size: 14px;
    }

    .form-group input,
    .form-group select,
    .form-group textarea {
      padding: 8px 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-family: inherit;
      font-size: 14px;
    }

    .form-group input:focus,
    .form-group select:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #007acc;
      box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.1);
    }

    .form-group textarea {
      resize: vertical;
      min-height: 120px;
      font-family: 'Courier New', monospace;
    }

    .form-actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }

    .primary-btn,
    .secondary-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    }

    .primary-btn {
      background: #007acc;
      color: white;
    }

    .primary-btn:hover {
      background: #005a9e;
    }

    .secondary-btn {
      background: #e0e0e0;
      color: #333;
    }

    .secondary-btn:hover {
      background: #d0d0d0;
    }

    .manifest-preview {
      padding: 20px;
      border-top: 1px solid #ddd;
      background: #f9f9f9;
    }

    .manifest-preview h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
    }

    .manifest-preview pre {
      margin: 0;
      padding: 12px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
    }
  `],
})
export class ManifestEditorComponent implements OnInit {
  @Input() manifest!: Manifest;
  @Output() saved = new EventEmitter<Manifest>();
  @Output() closed = new EventEmitter<void>();

  editingManifest: Manifest = {
    version: '1.0.0',
    mode: 'document',
    entryPoint: 'index.md',
  };
  metadataJson = '{}';

  ngOnInit() {
    if (this.manifest) {
      this.editingManifest = { ...this.manifest };
      this.metadataJson = JSON.stringify(this.manifest.metadata || {}, null, 2);
    }
  }

  save() {
    try {
      const metadata = JSON.parse(this.metadataJson);
      const updatedManifest: Manifest = {
        ...this.editingManifest,
        metadata,
      };
      this.saved.emit(updatedManifest);
      this.close();
    } catch (e) {
      alert('Invalid JSON in metadata');
    }
  }

  close() {
    this.closed.emit();
  }
}
