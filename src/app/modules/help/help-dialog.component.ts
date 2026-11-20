// The help dialog: a help document over the current window, read-only, for
// Studio outside the desktop app, which can't open windows. (In the desktop
// app every help document gets a help window of its own.)
import { Component, ViewChild, input, signal } from '@angular/core';
import type { MdzipMarkdownRenderExtension } from '@mdzip/editor';
import { MdzipWorkspaceComponent } from '@mdzip/editor-ng';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { HELP_DOCUMENTS, HelpDocumentKind, loadHelpDocument } from './help-documents';
import { helpPageOnlineUrl } from './help-pages';

@Component({
  selector: 'app-help-dialog',
  standalone: true,
  imports: [ButtonModule, DialogModule, MdzipWorkspaceComponent],
  templateUrl: './help-dialog.component.html',
  styleUrl: './help-dialog.component.scss',
})
export class HelpDialogComponent {
  readonly markdownExtensions = input<readonly MdzipMarkdownRenderExtension[]>([]);

  @ViewChild('helpWorkspace') private helpWorkspace?: MdzipWorkspaceComponent;

  readonly visible = signal(false);
  readonly title = signal('Help');
  readonly fileName = signal('help.md');
  readonly bytes = signal<Uint8Array | null>(null);
  readonly status = signal('');
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly onlineUrl = signal<string | null>(null);

  // Opens `kind`, at `page` of Studio's help and `anchor` (a heading id) when given.
  async open(kind: HelpDocumentKind, anchor: string | null = null, page: string | null = null): Promise<void> {
    const doc = HELP_DOCUMENTS[kind];
    this.title.set(doc.title);
    this.fileName.set(doc.fileName);
    this.onlineUrl.set(doc.pages ? helpPageOnlineUrl(page ?? 'index.md', anchor) : null);
    this.bytes.set(null);
    this.status.set('');
    this.error.set(false);
    this.loading.set(true);
    this.visible.set(true);

    const loaded = await loadHelpDocument(kind);
    this.bytes.set(loaded.bytes);
    this.status.set(loaded.status);
    this.error.set(loaded.error);
    this.loading.set(false);
    // The workspace mounts on the next render; openPath and scrollToAnchor wait for it.
    if (page) {
      setTimeout(() => void this.helpWorkspace?.openPath(page, anchor ? { anchor } : undefined), 0);
    } else if (anchor) {
      setTimeout(() => void this.helpWorkspace?.scrollToAnchor(anchor), 0);
    }
  }
}
