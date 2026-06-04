import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ValidationError } from '../../core/services/validation.service';

@Component({
  selector: 'app-validation-result',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="validation-container">
      <div class="validation-header">
        <h3>Validation Results</h3>
        <button (click)="close()" class="close-btn">✕</button>
      </div>

      <div [ngClass]="'result-' + (valid ? 'valid' : 'invalid')">
        <div class="result-icon">{{ valid ? '✓' : '✕' }}</div>
        <div class="result-text">
          {{ valid ? 'Archive is valid' : 'Archive has errors' }}
        </div>
      </div>

      <div class="errors-list" *ngIf="errors.length > 0">
        <h4>Issues</h4>
        <div
          *ngFor="let error of errors"
          [class]="'error-item error-' + error.type"
        >
          <span class="error-type">{{ error.type }}</span>
          <span class="error-message">{{ error.message }}</span>
          <span class="error-path" *ngIf="error.path">{{ error.path }}</span>
        </div>
      </div>

      <div class="validation-actions">
        <button (click)="close()" class="primary-btn">OK</button>
      </div>
    </div>
  `,
  styles: [`
    .validation-container {
      display: flex;
      flex-direction: column;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      max-width: 500px;
      max-height: 600px;
      overflow-y: auto;
    }

    .validation-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      border-bottom: 1px solid #ddd;
      background: #f5f5f5;
    }

    .validation-header h3 {
      margin: 0;
      font-size: 16px;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #666;
    }

    .result-valid,
    .result-invalid {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      margin: 16px;
      border-radius: 6px;
    }

    .result-valid {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .result-invalid {
      background: #ffebee;
      color: #c62828;
    }

    .result-icon {
      font-size: 24px;
      font-weight: bold;
      min-width: 24px;
      text-align: center;
    }

    .result-text {
      font-weight: 500;
      font-size: 16px;
    }

    .errors-list {
      padding: 0 16px 16px 16px;
    }

    .errors-list h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      text-transform: uppercase;
      color: #666;
      font-weight: 600;
    }

    .error-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      margin-bottom: 8px;
      border-radius: 4px;
      font-size: 13px;
    }

    .error-error {
      background: #ffebee;
      border-left: 4px solid #f44336;
    }

    .error-warning {
      background: #fff3e0;
      border-left: 4px solid #ff9800;
    }

    .error-type {
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
    }

    .error-message {
      color: #333;
    }

    .error-path {
      font-family: monospace;
      font-size: 11px;
      color: #666;
      opacity: 0.7;
    }

    .validation-actions {
      display: flex;
      gap: 12px;
      padding: 16px;
      border-top: 1px solid #ddd;
      background: #f5f5f5;
    }

    .primary-btn {
      flex: 1;
      padding: 10px;
      background: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }

    .primary-btn:hover {
      background: #005a9e;
    }
  `],
})
export class ValidationResultComponent {
  @Input() valid = true;
  @Input() errors: ValidationError[] = [];
  @Output() closed = new EventEmitter<void>();

  close() {
    this.closed.emit();
  }
}
