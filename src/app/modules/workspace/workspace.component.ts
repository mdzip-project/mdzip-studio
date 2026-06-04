import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorComponent } from '../editor/editor.component';
import { PreviewComponent } from '../preview/preview.component';
import { AssetBrowserComponent } from '../assets/asset-browser.component';
import { ArchiveService } from '../../core/services/archive.service';

type WorkspaceTab = 'editor' | 'preview' | 'assets';

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [
    CommonModule,
    EditorComponent,
    PreviewComponent,
    AssetBrowserComponent,
  ],
  template: `
    <div class="workspace-container">
      <div class="workspace-tabs">
        <button
          *ngFor="let tab of tabs"
          [class.active]="activeTab === tab.id"
          (click)="selectTab(tab.id)"
          class="tab-button"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="workspace-content">
        <app-editor *ngIf="activeTab === 'editor'"></app-editor>
        <app-preview *ngIf="activeTab === 'preview'"></app-preview>
        <app-asset-browser *ngIf="activeTab === 'assets'"></app-asset-browser>
      </div>
    </div>
  `,
  styles: [`
    .workspace-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }

    .workspace-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid #ddd;
      background: #f5f5f5;
    }

    .tab-button {
      padding: 12px 20px;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 14px;
      color: #666;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
      font-weight: 500;
    }

    .tab-button:hover {
      color: #333;
      background: #e8e8e8;
    }

    .tab-button.active {
      color: #007acc;
      border-bottom-color: #007acc;
      background: white;
    }

    .workspace-content {
      flex: 1;
      overflow: hidden;
    }
  `],
})
export class WorkspaceComponent implements OnInit {
  activeTab: WorkspaceTab = 'editor';
  tabs = [
    { id: 'editor' as const, label: 'Editor' },
    { id: 'preview' as const, label: 'Preview' },
    { id: 'assets' as const, label: 'Assets' },
  ];

  constructor(private archiveService: ArchiveService) {}

  ngOnInit() {
    // Component initialized
  }

  selectTab(tabId: WorkspaceTab) {
    this.activeTab = tabId;
  }
}
