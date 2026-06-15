import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export type ManifestEditorChange =
  | { field: 'title' | 'author' | 'description' | 'entryPoint'; value: string }
  | { field: 'mode'; value: 'document' | 'project' };

@Component({
  selector: 'app-manifest-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="manifest-editor">
      <div class="manifest-header">
        <div>
          <h3>Manifest</h3>
          <p>These fields are written into the MDZip manifest.</p>
        </div>
      </div>

      <div class="form-grid">
        <label>
          Title
          <input
            type="text"
            [ngModel]="title"
            (ngModelChange)="emitTextChange('title', $event)"
          />
        </label>
        <label>
          Author
          <input
            type="text"
            [ngModel]="author"
            (ngModelChange)="emitTextChange('author', $event)"
          />
        </label>
        <label class="full-width">
          Description
          <textarea
            rows="5"
            [ngModel]="description"
            (ngModelChange)="emitTextChange('description', $event)"
          ></textarea>
        </label>
        <label>
          Mode
          <select [ngModel]="mode" (ngModelChange)="emitModeChange($event)">
            <option value="document">Document</option>
            <option value="project">Project</option>
          </select>
        </label>
        <label>
          Format
          <input type="text" [ngModel]="'MDZip ' + version" readonly />
        </label>
        <label class="full-width">
          Entry point
          <select
            [ngModel]="entryPoint"
            (ngModelChange)="emitTextChange('entryPoint', $event)"
          >
            @for (document of documents; track document) {
              <option [value]="document">{{ document }}</option>
            }
          </select>
        </label>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .manifest-editor {
      min-width: 0;
    }

    .manifest-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    h3,
    p {
      margin: 0;
    }

    h3 {
      font-size: 16px;
    }

    p {
      margin-top: 4px;
      color: #68717d;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 16px;
    }

    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      color: #4c5663;
      font-weight: 700;
    }

    input,
    select,
    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid #cfd6df;
      border-radius: 7px;
      background: #ffffff;
      color: #20242a;
      font: inherit;
    }

    textarea {
      min-height: 120px;
      resize: vertical;
    }

    input[readonly] {
      background: #f4f6f8;
      color: #68717d;
    }

    .full-width {
      grid-column: 1 / -1;
    }

    @media (max-width: 760px) {
      .form-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class ManifestEditorComponent {
  @Input() title = '';
  @Input() author = '';
  @Input() description = '';
  @Input() mode: 'document' | 'project' = 'document';
  @Input() version = '1.0.0';
  @Input() entryPoint = 'index.md';
  @Input() documents: readonly string[] = [];

  @Output() readonly fieldChange = new EventEmitter<ManifestEditorChange>();

  emitTextChange(
    field: 'title' | 'author' | 'description' | 'entryPoint',
    value: string
  ): void {
    this.fieldChange.emit({ field, value });
  }

  emitModeChange(value: 'document' | 'project'): void {
    this.fieldChange.emit({ field: 'mode', value });
  }
}
