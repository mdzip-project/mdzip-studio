import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArchiveService, Document } from '../../core/services/archive.service';

@Component({
  selector: 'app-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="preview-container">
      <div class="preview-header">
        <h3>Preview</h3>
        <button (click)="refresh()" class="refresh-btn">↻</button>
      </div>

      <div class="preview-content" [innerHTML]="htmlContent"></div>
    </div>
  `,
  styles: [`
    .preview-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: white;
    }

    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #ddd;
      background: #f5f5f5;
    }

    .preview-header h3 {
      margin: 0;
      font-size: 13px;
      text-transform: uppercase;
      color: #666;
      font-weight: 600;
    }

    .refresh-btn {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 16px;
      padding: 4px 8px;
      border-radius: 4px;
      transition: all 0.2s;
    }

    .refresh-btn:hover {
      background: #e0e0e0;
    }

    .preview-content {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      line-height: 1.6;
    }

    .preview-content :deep(h1),
    .preview-content :deep(h2),
    .preview-content :deep(h3),
    .preview-content :deep(h4),
    .preview-content :deep(h5),
    .preview-content :deep(h6) {
      margin: 16px 0 8px 0;
      font-weight: 600;
    }

    .preview-content :deep(h1) {
      font-size: 32px;
      border-bottom: 2px solid #ddd;
      padding-bottom: 8px;
    }

    .preview-content :deep(h2) {
      font-size: 24px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 4px;
    }

    .preview-content :deep(p) {
      margin: 12px 0;
    }

    .preview-content :deep(code) {
      background: #f5f5f5;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
    }

    .preview-content :deep(pre) {
      background: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 12px 0;
    }

    .preview-content :deep(pre code) {
      background: none;
      padding: 0;
    }

    .preview-content :deep(ul),
    .preview-content :deep(ol) {
      margin: 12px 0;
      padding-left: 24px;
    }

    .preview-content :deep(li) {
      margin: 4px 0;
    }

    .preview-content :deep(blockquote) {
      border-left: 4px solid #ddd;
      padding-left: 12px;
      margin: 12px 0;
      color: #666;
      font-style: italic;
    }

    .preview-content :deep(a) {
      color: #007acc;
      text-decoration: none;
    }

    .preview-content :deep(a:hover) {
      text-decoration: underline;
    }

    .preview-content :deep(table) {
      border-collapse: collapse;
      margin: 12px 0;
      width: 100%;
    }

    .preview-content :deep(th),
    .preview-content :deep(td) {
      border: 1px solid #ddd;
      padding: 8px 12px;
      text-align: left;
    }

    .preview-content :deep(th) {
      background: #f5f5f5;
      font-weight: 600;
    }
  `],
})
export class PreviewComponent implements OnInit {
  htmlContent = '';
  private selectedDocId: string | null = null;

  constructor(private archiveService: ArchiveService) {}

  ngOnInit() {
    this.archiveService.currentArchive.subscribe((archive) => {
      if (archive && archive.documents.length > 0) {
        // TODO: Use a markdown parser library (e.g., marked or markdown-it)
        const firstDoc = archive.documents[0];
        this.renderMarkdown(firstDoc.content);
      }
    });
  }

  refresh() {
    const archive = (this.archiveService as any).currentArchive$.value;
    if (archive && archive.documents.length > 0) {
      const doc = archive.documents[0];
      this.renderMarkdown(doc.content);
    }
  }

  private renderMarkdown(content: string) {
    // Simple markdown rendering - would use a proper parser in production
    let html = content;

    // Headers
    html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Links
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');

    // Line breaks
    html = html.replace(/\n/g, '<br>');

    // Wrap in paragraphs (simple approach)
    html = html
      .split(/<br>(<h[1-6]>)/g)
      .map((part) => (part.startsWith('<') ? part : `<p>${part}</p>`))
      .join('');

    this.htmlContent = html;
  }
}
