// File > Import... (studio#33): pick a Word, PowerPoint, PDF or other file,
// choose the program that converts it (the best one that's installed is
// chosen for you), see the command it runs, and get a new, unsaved .mdz.
import { Component, ElementRef, ViewChild, computed, inject, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideCircleHelp } from '@ng-icons/lucide';
import { CommandBoxComponent } from './command-box.component';
import { StorageService } from '../../core/services/storage.service';
import {
  ConvertFailure, ConvertTool, DEFAULT_IMPORT_LOOK, ImportChoice, ImportLook, ImportPick, ImportResult, ImportWordOptions,
  importLookSwitches,
} from './convert-types';
import { ImportedOriginal, isWordFileName } from './imported-word';

type Picked = Extract<ImportPick, { formatName: string }>;

const LOOK_KEY = 'importLook';

export interface ImportedDocument {
  bytes: Uint8Array;
  fileName: string;
  warnings: string[];
  // A Word document's options: the file it came from, to add to the .mdz.
  original?: ImportedOriginal;
}

interface ImportBridge {
  importPick?: () => Promise<ImportPick>;
  importRun?: (tool: ConvertTool, options?: ImportWordOptions) => Promise<ImportResult>;
  cancelConversion?: () => Promise<{ ok: boolean }>;
}

@Component({
  selector: 'app-import-dialog',
  standalone: true,
  imports: [ButtonModule, DialogModule, CommandBoxComponent, NgIconComponent],
  providers: [provideIcons({ lucideCircleHelp })],
  template: `
    <p-dialog
      header="Import"
      [visible]="visible()"
      (visibleChange)="!$event && close()"
      [modal]="true"
      [closable]="!busy()"
      [style]="{ width: 'min(94vw, 600px)' }"
      styleClass="cv-dialog"
    >
      <div class="cv">
        @if (picked(); as p) {
          <p class="cv-file">
            <strong>{{ p.fileName }}</strong> <span class="cv-kind">· {{ p.formatName }}</span>
            <button type="button" class="cv-help" title="Help: Import" aria-label="Help: Import" (click)="help.emit('import')">
              <ng-icon name="lucideCircleHelp" size="15" aria-hidden="true" />
            </button>
          </p>

          @if (p.choices.length > 1) {
            <fieldset class="cv-options">
              <legend class="cv-heading">Convert with</legend>
              @for (choice of p.choices; track choice.tool) {
                <label class="cv-option" [class.selected]="tool() === choice.tool" [class.disabled]="!choice.usable">
                  <input type="radio" name="import-tool" [value]="choice.tool" [checked]="tool() === choice.tool"
                         [disabled]="!choice.usable || busy()" (change)="selectTool(choice.tool)" />
                  <span class="cv-option-name">{{ choice.name }}@if (choice.recommended) { (recommended)}</span>
                  <span class="cv-option-meta">{{ choiceStatus(choice) }}</span>
                </label>
              }
            </fieldset>
          } @else if (p.choices[0]; as only) {
            <p class="cv-note">Converts with {{ only.name }}@if (!only.usable) { — {{ choiceStatus(only).toLowerCase() }}}.</p>
          }

          @if (!anyUsable()) {
            <p class="cv-warn">
              To import {{ p.formatName.toLowerCase() }} files, install {{ toolList(p.choices) }}.
              <button type="button" class="cv-link" (click)="openSystemIntegration()">Set it up in System Integration</button>
            </p>
          }

          @if (choice(); as c) {
            <app-command-box [command]="commandLine()" [note]="commandNote(c)" />
          }

          @if (tool() === 'pandoc') {
            <fieldset class="cv-options">
              <legend class="cv-heading">
                Keep the look
                <button type="button" class="cv-help" title="Help: Keeping the look" aria-label="Help: Keeping the look" (click)="help.emit('keeping-the-look')">
                  <ng-icon name="lucideCircleHelp" size="15" aria-hidden="true" />
                </button>
              </legend>
              <p class="cv-note">Markdown has no way to write these, so they're kept as HTML in it: the document looks like the original, but that part is harder to edit by hand. Turn them off for plain Markdown.</p>
              <label class="cv-check">
                <input type="checkbox" [checked]="look().imageSizes" [disabled]="busy()" (change)="setLook('imageSizes', $any($event.target).checked)" />
                <span>
                  <span class="cv-option-name">Picture sizes</span>
                  <span class="cv-option-meta">Each picture at the size the document shows it. Off: plain Markdown pictures, shown at their own size, so a small logo can come out large.</span>
                </span>
              </label>
              <label class="cv-check">
                <input type="checkbox" [checked]="look().htmlTables" [disabled]="busy()" (change)="setLook('htmlTables', $any($event.target).checked)" />
                <span>
                  <span class="cv-option-name">Complex tables</span>
                  <span class="cv-option-meta">Merged cells, and headings, lists or several paragraphs in a cell. Off: simple Markdown tables, each cell on one line and merged cells split.</span>
                </span>
              </label>
              @if (isWord()) {
                <label class="cv-check">
                  <input type="checkbox" [checked]="look().tableLook" [disabled]="busy()" (change)="setLook('tableLook', $any($event.target).checked)" />
                  <span>
                    <span class="cv-option-name">Table shading and lines</span>
                    <span class="cv-option-meta">Shaded cells, and tables lined differently from the rest; Export… as Word puts them back. Off: every table gets the document's usual look.</span>
                  </span>
                </label>
              }
              <label class="cv-check">
                <input type="checkbox" [checked]="look().htmlFormatting" [disabled]="busy()" (change)="setLook('htmlFormatting', $any($event.target).checked)" />
                <span>
                  <span class="cv-option-name">Underline, superscript and highlight</span>
                  <span class="cv-option-meta">Subscript and small caps too. Off: plain text, so x² becomes x2.</span>
                </span>
              </label>
            </fieldset>
          }

          @if (isWord()) {
            <fieldset class="cv-options">
              <legend class="cv-heading">Also add to the document</legend>
              <label class="cv-check">
                <input type="checkbox" [checked]="keepStyles()" [disabled]="busy()" (change)="keepStyles.set($any($event.target).checked)" />
                <span>
                  <span class="cv-option-name">Use its styles when exporting to Word</span>
                  <span class="cv-option-meta">A copy with only its look (styles, page setup, headers and footers), as styles/reference.docx. Export… as Word uses it.</span>
                </span>
              </label>
              <label class="cv-check">
                <input type="checkbox" [checked]="documentStyle()" [disabled]="busy()" (change)="documentStyle.set($any($event.target).checked)" />
                <span>
                  <span class="cv-option-name">Show it with its fonts and colours</span>
                  <span class="cv-option-meta">Its fonts, colours, spacing and table lines as a stylesheet, styles/style.css, with a dark version for the dark theme. The preview, Print and PDF use it; View › Document Style turns it off.</span>
                </span>
              </label>
              <label class="cv-check">
                <input type="checkbox" [checked]="keepOriginal()" [disabled]="busy()" (change)="keepOriginal.set($any($event.target).checked)" />
                <span>
                  <span class="cv-option-name">Keep a copy of the original file</span>
                  <span class="cv-option-meta">Unchanged, in sources/. It may include comments, tracked changes and authors' names.</span>
                </span>
              </label>
            </fieldset>
          }
        }

        <div #feedback class="cv-feedback">
          @if (failure(); as f) {
            <p class="cv-error" role="alert">{{ f.message }}</p>
            @if (f.fix) {
              <app-command-box label="To fix it, run" [command]="f.fix" note="Run it in a terminal, then try again." />
            }
          }
        </div>
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="busy() ? cancelRun() : close()" />
        <p-button [label]="busy() ? 'Converting…' : 'Import'" [loading]="busy()" [disabled]="!choice()?.usable || busy()" (onClick)="run()" />
      </ng-template>
    </p-dialog>
  `,
  styleUrls: ['./convert-dialog.scss'],
})
export class ImportDialogComponent {
  // The converted .mdz, to open in this window.
  readonly imported = output<ImportedDocument>();
  // The main process opened it in a new window (this one has a document open).
  readonly importedElsewhere = output<string>();
  readonly showSystemIntegration = output<void>();
  // The (?): a section of the Import and Export help page, by its heading id.
  readonly help = output<string>();

  readonly visible = signal(false);
  readonly picked = signal<Picked | null>(null);
  readonly tool = signal<ConvertTool | null>(null);
  readonly busy = signal(false);
  readonly failure = signal<Omit<ConvertFailure, 'error'> | null>(null);
  // A Word document's options (see imported-word.ts).
  readonly keepStyles = signal(true);
  readonly keepOriginal = signal(false);
  readonly documentStyle = signal(true);
  readonly isWord = computed(() => isWordFileName(this.picked()?.fileName ?? ''));
  // Keep the look (Pandoc): remembered for the next import.
  private readonly storage = inject(StorageService);
  readonly look = signal<ImportLook>({ ...DEFAULT_IMPORT_LOOK, ...(this.storage.getItem<Partial<ImportLook>>(LOOK_KEY) ?? {}) });
  // The command as it will run: mdz.lua with the switches the choices add.
  readonly commandLine = computed(() => {
    const choice = this.choice();
    if (!choice) return '';
    if (choice.tool !== 'pandoc') return choice.commandLine;
    const switches = importLookSwitches(this.effectiveLook());
    return choice.commandLine.replace(/(-t \S*mdz\.lua)(?=\s|$)/, `$1${switches}`);
  });

  readonly choice = computed(() => this.picked()?.choices.find((choice) => choice.tool === this.tool()) ?? null);
  readonly anyUsable = computed(() => !!this.picked()?.choices.some((choice) => choice.usable));

  @ViewChild('feedback') private feedbackRef?: ElementRef<HTMLElement>;

  private get bridge(): ImportBridge | undefined {
    return window.mdzipStudio as ImportBridge | undefined;
  }

  // File > Import...: the file picker, then this dialog (nothing when canceled).
  async start(): Promise<void> {
    const pick = this.bridge?.importPick;
    if (!pick || this.visible()) return;
    const picked = await pick();
    if (picked.canceled) return;
    this.failure.set(null);
    this.busy.set(false);
    if (picked.error) {
      this.picked.set(null);
      this.tool.set(null);
      this.failure.set({ message: picked.message, fix: picked.fix ?? null });
    } else {
      this.picked.set(picked);
      // The best program that's installed; else the best one, to show its command.
      this.tool.set(picked.defaultTool ?? picked.choices[0]?.tool ?? null);
    }
    this.visible.set(true);
  }

  setLook(key: keyof ImportLook, value: boolean): void {
    this.look.update((look) => ({ ...look, [key]: value }));
    this.storage.setItem(LOOK_KEY, this.look());
  }

  // Table shading and lines come only from a Word document; for another file
  // the switch would change nothing, so the command leaves it out.
  private effectiveLook(): ImportLook {
    return this.isWord() ? this.look() : { ...this.look(), tableLook: false };
  }

  selectTool(tool: ConvertTool): void {
    this.tool.set(tool);
    this.failure.set(null);
  }

  async run(): Promise<void> {
    const tool = this.tool();
    const importRun = this.bridge?.importRun;
    if (!tool || !importRun || this.busy()) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const options: ImportWordOptions = {
        ...(this.isWord() ? { keepStyles: this.keepStyles(), keepOriginal: this.keepOriginal(), documentStyle: this.documentStyle() } : {}),
        ...(tool === 'pandoc' ? { look: this.effectiveLook() } : {}),
      };
      const result = await importRun(tool, Object.keys(options).length ? options : undefined);
      if (result.error) {
        this.failure.set({ message: result.message, fix: result.fix ?? null });
        // Below the command: scroll it into view once drawn.
        setTimeout(() => this.feedbackRef?.nativeElement.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
        return;
      }
      if (result.canceled) return;
      const fileName = result.fileName ?? 'Imported.mdz';
      this.visible.set(false);
      if (result.openedInNewWindow) {
        this.importedElsewhere.emit(fileName);
      } else if (result.bytes) {
        this.imported.emit({
          bytes: new Uint8Array(result.bytes),
          fileName,
          warnings: result.warnings ?? [],
          original: result.original ? { ...result.original, bytes: new Uint8Array(result.original.bytes) } : undefined,
        });
      }
    } catch (error) {
      this.failure.set({ message: error instanceof Error ? error.message : 'Could not import the file.' });
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    if (this.busy()) return;
    this.visible.set(false);
  }

  // Cancel while converting: stop the program; the dialog stays open.
  cancelRun(): void {
    void this.bridge?.cancelConversion?.();
  }

  openSystemIntegration(): void {
    this.visible.set(false);
    this.showSystemIntegration.emit();
  }

  choiceStatus(choice: ImportChoice): string {
    if (choice.usable) return choice.version ? `Version ${choice.version}` : 'Installed';
    if (choice.installed && choice.tool === 'pandoc') return `Needs Pandoc 3 (this is ${choice.version})`;
    return 'Not installed';
  }

  toolList(choices: ImportChoice[]): string {
    return choices.map((choice) => choice.name).join(' or ');
  }

  commandNote(choice: ImportChoice): string {
    const folder = `Run it in the file's folder (${this.picked()?.folder ?? ''}).`;
    return choice.tool === 'pandoc'
      ? `${folder} mdz.lua comes with mdzip-pandoc; Studio has its own copy.`
      : folder;
  }
}
