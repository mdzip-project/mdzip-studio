// The command Import or Export runs, as you'd type it in a terminal, with a
// Copy button: so you can see what the dialog does and learn to do it
// yourself (as SQL Server Management Studio shows the script behind a dialog).
import { Component, input, signal } from '@angular/core';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCopy } from '@ng-icons/lucide';

@Component({
  selector: 'app-command-box',
  standalone: true,
  imports: [NgIconComponent],
  providers: [provideIcons({ lucideCheck, lucideCopy })],
  template: `
    <div class="cmd">
      <div class="cmd-head">
        <span class="cmd-label">{{ label() }}</span>
        <button type="button" class="cmd-copy" (click)="copy()" [attr.aria-label]="'Copy ' + label().toLowerCase()">
          <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideCopy'" size="13" aria-hidden="true" />
          {{ copied() ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <code class="cmd-text">{{ command() }}</code>
      @if (note()) {
        <p class="cmd-note">{{ note() }}</p>
      }
    </div>
  `,
  styles: [`
    .cmd { display: grid; gap: 4px; }
    .cmd-head { display: flex; align-items: center; justify-content: space-between; }
    .cmd-label { font-size: 12px; font-weight: 600; color: #4c5663; }
    .cmd-copy {
      display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid #d0d5db;
      border-radius: 4px; background: #ffffff; color: #20242a; font: inherit; font-size: 12px; cursor: pointer;
    }
    .cmd-copy:hover { background: #f0f2f4; }
    .cmd-text {
      display: block; padding: 6px 8px; border-radius: 6px; border: 1px solid #e3e6ea; background: #f6f7f9;
      font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; line-height: 1.5;
      white-space: pre-wrap; overflow-wrap: anywhere; user-select: all;
    }
    .cmd-note { margin: 0; font-size: 12px; line-height: 1.45; color: #68717d; }
    @media (prefers-color-scheme: dark) {
      .cmd-label { color: #c4cad2; }
      .cmd-copy { background: #262628; border-color: #3c3c3c; color: #e6e8ec; }
      .cmd-copy:hover { background: #303033; }
      .cmd-text { background: #1e1e1e; border-color: #3c3c3c; }
      .cmd-note { color: #9aa0a6; }
    }
  `],
})
export class CommandBoxComponent {
  readonly command = input.required<string>();
  readonly label = input('Command');
  readonly note = input<string | null>(null);
  readonly copied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.command());
      this.copied.set(true);
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // The command is selectable; copying by hand still works.
    }
  }
}
