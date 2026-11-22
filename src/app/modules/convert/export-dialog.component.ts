// File > Export... (studio#41): the open document as Word, PDF, a web page,
// EPUB and others, with the command each one runs shown as you choose. Pandoc
// makes every format but PDF, which Studio makes from its own preview (as
// Print does), so it matches what you see.
import { Component, ElementRef, Input, ViewChild, computed, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideCircleHelp } from '@ng-icons/lucide';
import { CommandBoxComponent } from './command-box.component';
import { ConvertFailure, ExportChoice, ExportFormatInfo, ExportOptions, ExportResult } from './convert-types';

interface ExportBridge {
  exportOptions?: (payload: { fileName: string; sourceFormat: 'mdz' | 'markdown'; document: string | null }) => Promise<ExportOptions>;
  openExport?: () => Promise<{ ok?: boolean; error?: string }>;
  cancelConversion?: () => Promise<{ ok: boolean }>;
  showInFolder?: (filePath: string) => Promise<{ ok?: boolean; error?: string }>;
}

const FORMAT_KEY = 'mdzip-studio.exportFormat';

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [ButtonModule, DialogModule, CommandBoxComponent, NgIconComponent],
  providers: [provideIcons({ lucideCircleHelp })],
  template: `
    <p-dialog
      header="Export"
      [visible]="visible()"
      (visibleChange)="!$event && close()"
      [modal]="true"
      [closable]="!busy()"
      [style]="{ width: 'min(94vw, 600px)' }"
      styleClass="cv-dialog"
    >
      <div class="cv">
        <p class="cv-file"><strong>{{ fileName() }}</strong></p>
        @if (!options()) {
          <p class="cv-loading">Checking for Pandoc…</p>
        } @else {
          <fieldset class="cv-options cv-grid">
            <legend class="cv-heading">
              Export as
              <button type="button" class="cv-help" title="Help: Export" aria-label="Help: Export" (click)="help.emit('export')">
              <ng-icon name="lucideCircleHelp" size="15" aria-hidden="true" />
            </button>
            </legend>
            @for (format of options()!.formats; track format.id) {
              <label class="cv-option" [class.selected]="formatId() === format.id" [class.disabled]="!available(format)">
                <input type="radio" name="export-format" [value]="format.id" [checked]="formatId() === format.id"
                       [disabled]="!available(format) || busy()" (change)="selectFormat(format.id)" />
                <span class="cv-option-name">{{ format.name }}</span>
                <span class="cv-option-meta">.{{ format.extension }}</span>
              </label>
            }
          </fieldset>

          @if (!pandocUsable()) {
            <p class="cv-warn">
              {{ pandocMissingText() }}
              <button type="button" class="cv-link" (click)="openSystemIntegration()">Set it up in System Integration</button>
            </p>
          }

          @if (canCombine()) {
            <label class="cv-check">
              <input type="checkbox" [checked]="combine()" [disabled]="busy()" (change)="setCombine($any($event.target).checked)" />
              {{ projectMode() ? 'Include all its documents, as one file' : 'Include the pages it links to, as one document' }}
            </label>
          }
          @if (document() && !(canCombine() && combine())) {
            <p class="cv-note">Exports the page you're viewing, {{ document() }}.</p>
          }

          @if (format(); as f) {
            @if (f.tool === 'studio') {
              <app-command-box
                label="The same with Pandoc"
                [command]="command()"
                note="Studio makes the PDF of the page you're viewing from its own preview, as Print does, so nothing else is needed. From a terminal, Pandoc needs a PDF engine such as Typst." />
            } @else {
              <app-command-box [command]="command()" [note]="commandNote()" />
            }
            @if (f.id === 'docx' && sourceFormat() === 'mdz') {
              <p class="cv-note">
                Word uses the styles the document carries, if any.
                <button type="button" class="cv-link" (click)="help.emit('word-styles')">How to give it your own Word styles</button>
              </p>
            }
          }
        }

        <!-- What went wrong, or what Pandoc warned about: scrolled into view. -->
        <div #feedback class="cv-feedback">
          @if (failure(); as f) {
            <p class="cv-error" role="alert">{{ f.message }}</p>
            @if (f.fix) {
              <app-command-box label="To fix it, run" [command]="f.fix" />
            }
          }
          @if (done()?.warnings?.length) {
            <p class="cv-note">Pandoc said:</p>
            <ul class="cv-warnings">
              @for (warning of done()!.warnings; track $index) {
                <li>{{ warning }}</li>
              }
            </ul>
          }
        </div>
      </div>
      <ng-template pTemplate="footer">
        <!-- The outcome next to the buttons, where it's always in view. -->
        <div class="cv-footer">
          @if (done(); as d) {
            <span class="cv-ok cv-footer-status" role="status" [attr.title]="d.filePath">Exported {{ d.name }}</span>
            <button type="button" class="cv-link" (click)="openResult()">Open</button>
            <button type="button" class="cv-link" (click)="showResult()">Show in Folder</button>
          } @else if (failure()) {
            <span class="cv-error cv-footer-status">Not exported (see above)</span>
          }
          <span class="cv-footer-spacer"></span>
          <p-button [label]="done() ? 'Close' : 'Cancel'" severity="secondary" [text]="true"
                    [disabled]="busy() && format()?.tool !== 'pandoc'" (onClick)="busy() ? cancelRun() : close()" />
          <p-button [label]="busy() ? 'Exporting…' : 'Export…'" [loading]="busy()" [disabled]="!canExport()" (onClick)="run()" />
        </div>
      </ng-template>
    </p-dialog>
  `,
  styleUrls: ['./convert-dialog.scss'],
})
export class ExportDialogComponent {
  // Exports the document as it is now: the app flushes unsaved edits, then
  // asks Pandoc (or makes the PDF). Set by the app.
  @Input() set runExport(run: ((choice: ExportChoice) => Promise<ExportResult>) | null) {
    this.exporter.set(run);
  }
  private readonly exporter = signal<((choice: ExportChoice) => Promise<ExportResult>) | null>(null);
  readonly showSystemIntegration = output<void>();
  // A (?) or help link: a section of the Import and Export help page, by its heading id.
  readonly help = output<string>();

  readonly visible = signal(false);
  readonly fileName = signal('');
  readonly sourceFormat = signal<'mdz' | 'markdown'>('mdz');
  // An .mdz's mode: a project's documents are separate; combined, they're a
  // collection, each a part of its own (MDZip spec 5.7.3).
  readonly archiveMode = signal<'document' | 'project'>('document');
  // The page being viewed, when it isn't the entry point: exported instead
  // of it when not combining (as PDF and Print do).
  readonly document = signal<string | null>(null);
  readonly projectMode = computed(() => this.sourceFormat() === 'mdz' && this.archiveMode() === 'project');
  readonly options = signal<ExportOptions | null>(null);
  readonly formatId = signal('docx');
  readonly combine = signal(true);
  readonly busy = signal(false);
  readonly failure = signal<Omit<ConvertFailure, 'error'> | null>(null);
  readonly done = signal<{ name: string; filePath: string; warnings: string[] } | null>(null);

  readonly pandocUsable = computed(() => !!this.options()?.pandoc.usable);
  readonly format = computed(() => this.options()?.formats.find((format) => format.id === this.formatId()) ?? null);
  // An .mdz's documents as one file: Pandoc formats only (PDF, like Print,
  // is the page you're viewing).
  readonly canCombine = computed(() => this.sourceFormat() === 'mdz' && this.format()?.tool === 'pandoc');
  readonly command = computed(() => {
    const commands = this.options()?.commands ?? {};
    const combined = this.canCombine() && this.combine();
    return commands[`${this.formatId()}${combined ? '+combine' : ''}`] ?? '';
  });
  readonly canExport = computed(() => {
    const format = this.format();
    return !!format && this.available(format) && !this.busy() && !!this.exporter();
  });

  @ViewChild('feedback') private feedbackRef?: ElementRef<HTMLElement>;

  private get bridge(): ExportBridge | undefined {
    return window.mdzipStudio as ExportBridge | undefined;
  }

  // File > Export...: for the document `fileName` ('Guide.mdz', 'notes.md'),
  // an .mdz in `mode`, viewing `document` (null: its entry point).
  async open(
    fileName: string,
    sourceFormat: 'mdz' | 'markdown',
    mode: 'document' | 'project' = 'document',
    document: string | null = null,
  ): Promise<void> {
    const exportOptions = this.bridge?.exportOptions;
    if (!exportOptions || this.visible()) return;
    this.fileName.set(fileName);
    this.sourceFormat.set(sourceFormat);
    this.archiveMode.set(mode);
    this.document.set(sourceFormat === 'mdz' ? document : null);
    // A document's pages together by default; a project's documents are
    // separate, so the page you're viewing.
    this.combine.set(mode !== 'project');
    this.options.set(null);
    this.failure.set(null);
    this.done.set(null);
    this.busy.set(false);
    this.visible.set(true);
    try {
      const options = await exportOptions({ fileName, sourceFormat, document: this.document() });
      this.options.set(options);
      // The format used last time, when it can be made here; else Word, else PDF.
      const remembered = readRemembered();
      const pick = [remembered, 'docx', 'pdf']
        .map((id) => options.formats.find((format) => format.id === id))
        .find((format) => format && this.available(format));
      this.formatId.set(pick?.id ?? 'pdf');
    } catch (error) {
      this.failure.set({ message: error instanceof Error ? error.message : 'Could not check for Pandoc.' });
    }
  }

  available(format: ExportFormatInfo): boolean {
    return format.tool === 'studio' || this.pandocUsable();
  }

  selectFormat(id: string): void {
    this.formatId.set(id);
    this.failure.set(null);
    this.done.set(null);
  }

  setCombine(value: boolean): void {
    this.combine.set(value);
    this.done.set(null);
  }

  pandocMissingText(): string {
    const pandoc = this.options()?.pandoc;
    return pandoc?.installed
      ? `Formats other than PDF need Pandoc 3 or newer; this computer has Pandoc ${pandoc.version}.`
      : 'Formats other than PDF need Pandoc.';
  }

  commandNote(): string {
    return this.sourceFormat() === 'mdz'
      ? 'mdz.lua and docx.lua come with mdzip-pandoc; Studio has its own copy.'
      : "Run it in the document's folder, so its pictures are found.";
  }

  async run(): Promise<void> {
    const runExport = this.exporter();
    const format = this.format();
    if (!runExport || !format || !this.canExport()) return;
    this.busy.set(true);
    this.failure.set(null);
    this.done.set(null);
    try {
      const combine = this.canCombine() && this.combine();
      const result = await runExport({ format: format.id, combine, document: combine ? null : this.document() });
      if (result.error) {
        this.failure.set({ message: result.message, fix: result.fix ?? null });
      } else if (!result.canceled) {
        remember(format.id);
        const name = result.filePath.split(/[\\/]/).pop() ?? result.filePath;
        this.done.set({ name, filePath: result.filePath, warnings: result.warnings ?? [] });
      }
    } catch (error) {
      this.failure.set({ message: error instanceof Error ? error.message : 'Could not export the document.' });
    } finally {
      this.busy.set(false);
      if (this.failure() || this.done()?.warnings.length) this.showFeedback();
    }
  }

  // An error or Pandoc's warnings, below the command: scroll them into view
  // once drawn.
  private showFeedback(): void {
    setTimeout(() => this.feedbackRef?.nativeElement.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
  }

  async openResult(): Promise<void> {
    const result = await this.bridge?.openExport?.();
    if (result?.error) this.failure.set({ message: `Could not open it: ${result.error}` });
  }

  async showResult(): Promise<void> {
    const filePath = this.done()?.filePath;
    if (filePath) await this.bridge?.showInFolder?.(filePath);
  }

  close(): void {
    if (this.busy()) return;
    this.visible.set(false);
  }

  // Cancel while Pandoc runs: stop it (PDF, made by Studio, can't be stopped).
  cancelRun(): void {
    void this.bridge?.cancelConversion?.();
  }

  openSystemIntegration(): void {
    this.visible.set(false);
    this.showSystemIntegration.emit();
  }
}

function readRemembered(): string | null {
  try {
    return localStorage.getItem(FORMAT_KEY);
  } catch {
    return null;
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(FORMAT_KEY, id);
  } catch {
    // Not remembered; Word is chosen next time.
  }
}
