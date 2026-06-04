import { Component, Output, EventEmitter, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="welcome-container">
      <div class="welcome-content">
        <div class="logo">📦</div>
        <h1>MDZip Studio</h1>
        <p class="subtitle">
          Create, view, and edit MDZip archives
        </p>

        <div class="action-buttons">
          <button (click)="onNewArchive()" class="primary-button">
            <span class="icon">+</span> Create New Archive
          </button>
          <button (click)="onOpenArchive()" class="secondary-button">
            <span class="icon">📂</span> Open Archive
          </button>
        </div>

        <div class="recent-section" *ngIf="recentFiles.length > 0">
          <h3>Recent Files</h3>
          <ul>
            <li *ngFor="let file of recentFiles" (click)="onOpenRecent(file)">
              <span class="icon">📄</span>
              <span class="filename">{{ getFileName(file) }}</span>
              <span class="path">{{ file }}</span>
            </li>
          </ul>
        </div>

        <div class="info-section">
          <h3>Getting Started</h3>
          <ul>
            <li>
              <strong>Create</strong> a new MDZip archive to get started
            </li>
            <li>
              <strong>Add Documents</strong> as Markdown files
            </li>
            <li>
              <strong>Manage Assets</strong> like images and attachments
            </li>
            <li>
              <strong>Edit Manifest</strong> to configure the archive
            </li>
            <li>
              <strong>Validate</strong> before saving
            </li>
          </ul>
        </div>

        <div class="links">
          <a href="https://mdzip.org" target="_blank">MDZip Specification</a>
          <span class="separator">•</span>
          <a href="https://github.com/mdzip-project" target="_blank"
            >GitHub</a
          >
        </div>
      </div>
    </div>
  `,
  styles: [`
    .welcome-container {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px;
    }

    .welcome-content {
      background: white;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      max-width: 600px;
      text-align: center;
    }

    .logo {
      font-size: 64px;
      margin-bottom: 20px;
    }

    h1 {
      margin: 0 0 8px 0;
      font-size: 36px;
      color: #333;
    }

    .subtitle {
      margin: 0 0 32px 0;
      color: #666;
      font-size: 16px;
    }

    .action-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-bottom: 40px;
      flex-wrap: wrap;
    }

    .primary-button,
    .secondary-button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      font-size: 15px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    }

    .primary-button {
      background: #667eea;
      color: white;
    }

    .primary-button:hover {
      background: #5568d3;
      transform: translateY(-2px);
      box-shadow: 0 8px 16px rgba(102, 126, 234, 0.4);
    }

    .secondary-button {
      background: #f0f0f0;
      color: #333;
    }

    .secondary-button:hover {
      background: #e0e0e0;
      transform: translateY(-2px);
    }

    .recent-section {
      text-align: left;
      margin-bottom: 32px;
      padding-bottom: 32px;
      border-bottom: 1px solid #eee;
    }

    .recent-section h3 {
      margin: 0 0 16px 0;
      font-size: 14px;
      text-transform: uppercase;
      color: #666;
      font-weight: 600;
    }

    .recent-section ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .recent-section li {
      padding: 10px;
      margin-bottom: 8px;
      background: #f9f9f9;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .recent-section li:hover {
      background: #f0f0f0;
    }

    .icon {
      font-size: 18px;
      flex-shrink: 0;
    }

    .filename {
      font-weight: 500;
      color: #333;
    }

    .path {
      font-size: 12px;
      color: #999;
      flex-shrink: 0;
    }

    .info-section {
      text-align: left;
      margin-bottom: 32px;
    }

    .info-section h3 {
      margin: 0 0 12px 0;
      font-size: 14px;
      text-transform: uppercase;
      color: #666;
      font-weight: 600;
    }

    .info-section ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .info-section li {
      padding: 6px 0;
      color: #666;
      font-size: 14px;
    }

    .links {
      display: flex;
      justify-content: center;
      gap: 12px;
      font-size: 13px;
      color: #667eea;
    }

    a {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }

    a:hover {
      text-decoration: underline;
    }

    .separator {
      color: #ddd;
    }
  `],
})
export class WelcomeComponent implements OnInit {
  @Input() recentFiles: string[] = [];
  @Output() newArchive = new EventEmitter<void>();
  @Output() openArchive = new EventEmitter<void>();
  @Output() openRecent = new EventEmitter<string>();

  ngOnInit() {
    // Component initialized
  }

  onNewArchive() {
    this.newArchive.emit();
  }

  onOpenArchive() {
    this.openArchive.emit();
  }

  onOpenRecent(file: string) {
    this.openRecent.emit(file);
  }

  getFileName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }
}
