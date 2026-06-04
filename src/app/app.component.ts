import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="app-container">
      <div class="menu-bar">
        <div class="menu-item">MDZip Studio</div>
      </div>
      <div class="main-content">
        <div class="navigation-pane">
          <nav>
            <div class="nav-section">
              <h3>Archive</h3>
              <button (click)="newArchive()" class="nav-button">New</button>
              <button (click)="openArchive()" class="nav-button">Open</button>
            </div>
            <div class="nav-section" *ngIf="archiveOpen">
              <h3>Contents</h3>
              <div class="nav-item">Documents</div>
              <div class="nav-item">Assets</div>
              <div class="nav-item">Manifest</div>
            </div>
          </nav>
        </div>
        <div class="workspace-area">
          <div class="welcome-screen" *ngIf="!archiveOpen">
            <h1>Welcome to MDZip Studio</h1>
            <p>Create, view, and edit MDZip archives</p>
            <div class="action-buttons">
              <button (click)="newArchive()" class="primary-button">
                Create New Archive
              </button>
              <button (click)="openArchive()" class="secondary-button">
                Open Archive
              </button>
            </div>
            <div class="recent-files" *ngIf="recentFiles.length > 0">
              <h3>Recent Files</h3>
              <ul>
                <li *ngFor="let file of recentFiles">{{ file }}</li>
              </ul>
            </div>
          </div>
          <div class="editor-area" *ngIf="archiveOpen">
            <div class="editor-tabs">
              <div class="tab" [class.active]="activeTab === 'editor'">
                Editor
              </div>
              <div class="tab" [class.active]="activeTab === 'preview'">
                Preview
              </div>
              <div class="tab" [class.active]="activeTab === 'manifest'">
                Manifest
              </div>
            </div>
            <div class="editor-content">
              <p>Archive: {{ currentArchive }}</p>
            </div>
          </div>
        </div>
      </div>
      <div class="status-bar">
        <span>Ready</span>
      </div>
    </div>
  `,
  styles: [`
    .app-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
        Ubuntu, Cantarell, sans-serif;
      background: #ffffff;
      color: #333;
    }

    .menu-bar {
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      padding: 8px 16px;
      font-weight: 600;
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
      padding: 16px;
      background: #fafafa;
    }

    nav {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .nav-section h3 {
      margin: 0 0 8px 0;
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      font-weight: 600;
    }

    .nav-button,
    .nav-item {
      display: block;
      padding: 8px 12px;
      background: none;
      border: none;
      text-align: left;
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.2s;
      font-size: 14px;
    }

    .nav-button:hover {
      background: #e0e0e0;
    }

    .nav-item {
      color: #666;
    }

    .workspace-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .welcome-screen {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: 40px;
      text-align: center;
    }

    .welcome-screen h1 {
      margin: 0 0 16px 0;
      font-size: 32px;
    }

    .welcome-screen p {
      margin: 0 0 32px 0;
      color: #666;
      font-size: 16px;
    }

    .action-buttons {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-bottom: 40px;
    }

    .primary-button,
    .secondary-button {
      padding: 10px 20px;
      font-size: 14px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .primary-button {
      background: #007acc;
      color: white;
    }

    .primary-button:hover {
      background: #005a9e;
    }

    .secondary-button {
      background: #e0e0e0;
      color: #333;
    }

    .secondary-button:hover {
      background: #d0d0d0;
    }

    .recent-files {
      text-align: left;
      margin-top: 40px;
      border-top: 1px solid #ddd;
      padding-top: 20px;
    }

    .recent-files h3 {
      margin: 0 0 12px 0;
    }

    .recent-files ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .recent-files li {
      padding: 6px 0;
      color: #666;
    }

    .editor-area {
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .editor-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid #ddd;
      background: #f5f5f5;
    }

    .tab {
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 14px;
      transition: all 0.2s;
    }

    .tab:hover {
      background: #e0e0e0;
    }

    .tab.active {
      border-bottom-color: #007acc;
      background: #ffffff;
    }

    .editor-content {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
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
export class AppComponent implements OnInit {
  archiveOpen = false;
  currentArchive: string = '';
  activeTab: 'editor' | 'preview' | 'manifest' = 'editor';
  recentFiles: string[] = [];

  ngOnInit() {
    // Load recent files on init
    this.loadRecentFiles();
  }

  newArchive() {
    console.log('Creating new archive...');
    // TODO: Implement archive creation
    this.archiveOpen = true;
    this.currentArchive = 'Untitled Archive';
  }

  openArchive() {
    console.log('Opening archive...');
    // TODO: Implement file open dialog
  }

  private loadRecentFiles() {
    // TODO: Load from local storage or electron IPC
  }
}
