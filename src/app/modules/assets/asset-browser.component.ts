import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArchiveService, Asset } from '../../core/services/archive.service';

@Component({
  selector: 'app-asset-browser',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="asset-container">
      <div class="asset-header">
        <h3>Assets</h3>
        <div class="asset-actions">
          <button (click)="addAsset()" class="action-btn" title="Add asset">
            +
          </button>
          <button (click)="refresh()" class="action-btn" title="Refresh">
            ↻
          </button>
        </div>
      </div>

      <div class="asset-list" *ngIf="assets.length > 0">
        <div
          *ngFor="let asset of assets"
          [class]="'asset-item asset-' + getAssetType(asset.type)"
          (click)="selectAsset(asset.id)"
        >
          <div class="asset-icon">{{ getAssetIcon(asset.type) }}</div>
          <div class="asset-info">
            <div class="asset-name">{{ asset.name }}</div>
            <div class="asset-details">
              {{ asset.type }} • {{ formatSize(asset.size) }}
            </div>
          </div>
          <button
            (click)="deleteAsset($event, asset.id)"
            class="delete-btn"
            title="Delete"
          >
            ×
          </button>
        </div>
      </div>

      <div class="empty-state" *ngIf="assets.length === 0">
        <p>No assets yet</p>
        <button (click)="addAsset()" class="add-btn">Add Asset</button>
      </div>
    </div>
  `,
  styles: [`
    .asset-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: white;
    }

    .asset-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #ddd;
      background: #f5f5f5;
    }

    .asset-header h3 {
      margin: 0;
      font-size: 13px;
      text-transform: uppercase;
      color: #666;
      font-weight: 600;
    }

    .asset-actions {
      display: flex;
      gap: 4px;
    }

    .action-btn {
      background: none;
      border: 1px solid #ddd;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: all 0.2s;
      font-size: 14px;
    }

    .action-btn:hover {
      background: #e0e0e0;
    }

    .asset-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .asset-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px;
      margin-bottom: 4px;
      background: #f9f9f9;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .asset-item:hover {
      background: #f0f0f0;
      border-color: #ddd;
    }

    .asset-icon {
      flex-shrink: 0;
      font-size: 20px;
      width: 24px;
      text-align: center;
    }

    .asset-info {
      flex: 1;
      min-width: 0;
    }

    .asset-name {
      font-weight: 500;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .asset-details {
      font-size: 11px;
      color: #999;
    }

    .delete-btn {
      flex-shrink: 0;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      color: #999;
      padding: 2px 4px;
      border-radius: 2px;
      transition: all 0.2s;
    }

    .delete-btn:hover {
      color: #f44336;
      background: #ffebee;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: #999;
    }

    .empty-state p {
      margin: 0 0 12px 0;
    }

    .add-btn {
      padding: 8px 16px;
      background: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }

    .add-btn:hover {
      background: #005a9e;
    }
  `],
})
export class AssetBrowserComponent implements OnInit {
  assets: Asset[] = [];

  constructor(private archiveService: ArchiveService) {}

  ngOnInit() {
    this.archiveService.currentArchive.subscribe((archive) => {
      if (archive) {
        this.assets = archive.assets;
      } else {
        this.assets = [];
      }
    });
  }

  getAssetIcon(type: string): string {
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎬';
    if (type.startsWith('audio/')) return '🔊';
    if (type === 'application/pdf') return '📄';
    return '📎';
  }

  getAssetType(type: string): string {
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    return 'file';
  }

  formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIdx = 0;

    while (size >= 1024 && unitIdx < units.length - 1) {
      size /= 1024;
      unitIdx++;
    }

    return `${size.toFixed(1)}${units[unitIdx]}`;
  }

  selectAsset(id: string) {
    console.log('Selected asset:', id);
  }

  addAsset() {
    const name = prompt('Asset name:', 'asset');
    if (!name) return;

    this.archiveService.addAsset({
      id: Date.now().toString(),
      name,
      type: 'application/octet-stream',
      size: 0,
    });
  }

  deleteAsset(event: Event, id: string) {
    event.stopPropagation();
    if (confirm('Delete this asset?')) {
      this.archiveService.removeAsset(id);
    }
  }

  refresh() {
    // Trigger refresh
  }
}
