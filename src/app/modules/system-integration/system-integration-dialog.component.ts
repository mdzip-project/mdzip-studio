import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, computed, signal } from '@angular/core';
import { HELP_SECTIONS } from './help-sections';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideCircleArrowUp, lucideCircleCheck, lucideCircleHelp, lucideCircleX } from '@ng-icons/lucide';

// What the main process reports for Help > System Integration… (studio#11);
// see electron/lib/system-integration.js.
export interface SystemIntegrationHelperCard {
  id: string;
  name: string;
  purpose: string;
  url: string;
  installCommand: string | null;
  // The command that removes it, and what it leaves behind, if anything.
  uninstallCommand?: string | null;
  uninstallNote?: string | null;
  // What installing it costs ("About 45 MB to download."), if known.
  size?: string | null;
  // What its install command needs first ('Python', 'Node.js', 'winget'...),
  // and whether the card names it even when it's there.
  requires?: string | null;
  requiresAlways?: boolean;
}

export interface SystemIntegrationHelper extends SystemIntegrationHelperCard {
  installed: boolean;
  version: string | null;
  // Kinds of file it can't read for want of a package ('docx', 'pptx', ...):
  // markitdown-mdz without MarkItDown's readers. Absent or [] when it has them.
  missingReaders?: string[];
  // Not installed, and neither is what installs it (`requires`).
  requirementMissing?: boolean;
}

// The missing readers in words: ['docx', 'pptx', 'xlsx', 'xls'] -> "Word,
// PowerPoint and Excel". Unknown kinds by their extension.
const READER_NAMES: Record<string, string> = { docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', xls: 'Excel', pdf: 'PDF' };
// The line under a helper's purpose: what it needs (Python, Node.js; winget
// or Homebrew only when missing) and what installing it costs.
export function helperFacts(helper: SystemIntegrationHelper): string {
  const parts: string[] = [];
  if (helper.requires && (helper.requiresAlways || (!helper.installed && helper.requirementMissing))) {
    parts.push(`Needs ${helper.requires}.`);
  }
  if (helper.size && !helper.installed) parts.push(helper.size);
  return parts.join(' ');
}

export function readerNames(kinds: readonly string[]): string {
  const names = [...new Set(kinds.map((kind) => READER_NAMES[kind] ?? `.${kind}`))];
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// studio: the portable version only (installing Studio itself).
export type WindowsCardId = 'studio' | 'markdown' | 'preview' | 'outlook';

// The cards, at once; each one's state is checked on its own
// (checkSystemIntegration), so a slow check doesn't hold up the others.
export interface SystemIntegrationCards {
  platform: string;
  portable: boolean;
  windows: WindowsCardId[];
  helpers: SystemIntegrationHelperCard[];
}

export interface SystemIntegrationStatus {
  platform: string;
  portable: boolean;
  // via: how the choice is made: Windows 11's Settings page, or Windows 10's dialog.
  // unregistered: not an all-users install with Explorer integration, so
  // Windows doesn't offer Studio for .md files.
  markdownDefault: { state: 'default' | 'not-default' | 'unregistered' | 'unsupported'; via?: 'settings' | 'dialog' } | null;
  previewHandler:
    | { state: 'not-installed' | 'portable' }
    // off-for-user: hidden for this Windows account only. other: another
    // program's .mdz preview, which Explorer shows while Studio's is off.
    | { state: 'installed' | 'off-for-user'; other?: { clsid: string; name: string | null } | null }
    | { state: 'other'; handler: string }
    | { state: 'broken'; reason: 'files' | 'runtime' }
    | null;
  outlook:
    | { state: 'not-found' }
    | { state: 'allowed' | 'blocked' | 'managed'; version: string; managed: boolean }
    | null;
  // The portable version only: whether Studio is also installed ('machine'
  // for all users, 'user' for one), and if not, the package manager that can
  // install it (winget, else Chocolatey) and its command.
  studio?: { installed: 'machine' | 'user' | null; via: 'winget' | 'choco' | null; command: string | null } | null;
  helpers: SystemIntegrationHelper[];
}

export type SystemIntegrationAction =
  | 'markdown-default'
  | 'outlook-allow'
  | 'outlook-undo'
  | 'preview-off'
  | 'preview-on'
  | 'install-helper'
  | 'upgrade-helper'
  | 'uninstall-helper'
  | 'install-studio'
  | 'open-studio'
  | 'open-page';

// Each helper program's newest published version (null when it couldn't be
// found out) and the command that updates it here.
export type HelperLatestVersions = Record<string, { latest: string | null; upgradeCommand: string | null }>;

export interface SystemIntegrationActionResult {
  ok: boolean;
  error?: string;
  command?: string;
}

// good: a check; warn: a red X; off: a grey X; update: an arrow (a newer
// version of a helper program is out); checking: a spinner, until its check
// answers. Each has its own shape.
type Tone = 'good' | 'warn' | 'off' | 'update' | 'checking';

const TONE_ICONS: Record<Tone, string> = {
  good: 'lucideCircleCheck',
  warn: 'lucideCircleX',
  off: 'lucideCircleX',
  update: 'lucideCircleArrowUp',
  checking: '',
};

const WINDOWS_TITLES: Record<WindowsCardId, string> = {
  studio: 'Install MDZip Studio',
  markdown: 'Open .md files with MDZip Studio',
  preview: 'Previews in File Explorer',
  outlook: '.mdz attachments in Outlook',
};

interface HelperRow {
  helper: SystemIntegrationHelper;
  tone: Tone;
  status: string;
  // The command the row's button runs, shown so you can see what it does.
  command: string | null;
  action: 'install' | 'update' | 'readers' | 'requires' | null;
  // What it needs and costs, under its purpose: "Needs Python. About 115 MB to download."
  facts: string;
}

interface Row {
  id: string;
  title: string;
  tone: Tone;
  status: string;
  detail: string;
  action?: { label: string; run: () => void; secondary?: boolean };
  // A second, lesser button, after the first.
  more?: { label: string; run: () => void };
  // The command the button runs, shown so you can see what it does.
  command?: string | null;
}

@Component({
  selector: 'app-system-integration-dialog',
  standalone: true,
  imports: [ButtonModule, DialogModule, NgIconComponent],
  providers: [provideIcons({ lucideCircleArrowUp, lucideCircleCheck, lucideCircleHelp, lucideCircleX })],
  template: `
    <p-dialog
      header="System Integration"
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      [modal]="true"
      [style]="{ width: 'min(94vw, 680px)' }"
      styleClass="si-dialog"
    >
      <div class="si">
        @if (loading() && !status()) {
          <p class="si-loading">Checking this computer…</p>
        }
        @if (error()) {
          <p class="si-error">{{ error() }}</p>
        }
        @if (status(); as s) {
          @if (windowsRows().length) {
            <h3>On this computer</h3>
            <ul class="si-rows">
              @for (row of windowsRows(); track row.id) {
                <li class="si-row">
                  <div class="si-main">
                    <div class="si-title">
                      {{ row.title }}
                      <button type="button" class="si-help" [attr.title]="'Help: ' + row.title" [attr.aria-label]="'Help: ' + row.title" (click)="showHelp(row.id)">
                        <ng-icon name="lucideCircleHelp" size="15" aria-hidden="true" />
                      </button>
                    </div>
                    <div [class]="'si-status si-' + row.tone">
                      @if (row.tone === 'checking') {
                      <span class="si-spinner" aria-hidden="true"></span>
                    } @else {
                      <ng-icon [name]="toneIcon(row.tone)" size="15" aria-hidden="true" />
                    }
                      {{ row.status }}
                    </div>
                    @if (row.detail) {
                      <p class="si-detail">{{ row.detail }}</p>
                    }
                    @if (row.id === 'outlook' && outlookChanged()) {
                      <p class="si-note">Restart Outlook for this to take effect.</p>
                    }
                    @if (row.id === 'preview' && previewChanged()) {
                      <p class="si-note">Open a new File Explorer window for this to take effect.</p>
                    }
                    @if (row.command) {
                      <code class="si-command">{{ row.command }}</code>
                    }
                  </div>
                  @if (row.action; as action) {
                    <div class="si-actions">
                      <p-button
                        [label]="action.label"
                        size="small"
                        [severity]="action.secondary ? 'secondary' : undefined"
                        [outlined]="!!action.secondary"
                        [disabled]="busy()"
                        (onClick)="action.run()"
                      />
                      @if (row.more; as more) {
                        <p-button [label]="more.label" size="small" severity="secondary" [outlined]="true" [disabled]="busy()" (onClick)="more.run()" />
                      }
                    </div>
                  }
                </li>
              }
            </ul>
          }

          <h3>
            Helper programs
            <button type="button" class="si-help" title="Help: Helper programs" aria-label="Help: Helper programs" (click)="showHelp('helpers')">
              <ng-icon name="lucideCircleHelp" size="15" aria-hidden="true" />
            </button>
          </h3>
          <p class="si-intro">
            Studio works without these. File &gt; Import… and File &gt; Export… use them when they're installed.
          </p>
          <ul class="si-rows">
            @for (row of helperRows(); track row.helper.id) {
              @let helper = row.helper;
              <li class="si-row">
                <div class="si-main">
                  <div class="si-title">
                    {{ helper.name }}
                    <button type="button" class="si-help" [attr.title]="'Help: ' + helper.name" [attr.aria-label]="'Help: ' + helper.name" (click)="showHelp(helper.id)">
                      <ng-icon name="lucideCircleHelp" size="15" aria-hidden="true" />
                    </button>
                  </div>
                  <div [class]="'si-status si-' + row.tone">
                    @if (row.tone === 'checking') {
                      <span class="si-spinner" aria-hidden="true"></span>
                    } @else {
                      <ng-icon [name]="toneIcon(row.tone)" size="15" aria-hidden="true" />
                    }
                    {{ row.status }}
                  </div>
                  <p class="si-detail">{{ helper.purpose }}</p>
                  @if (row.facts) {
                    <p class="si-detail si-facts">{{ row.facts }}</p>
                  }
                  @if (row.command) {
                    <code class="si-command">{{ row.command }}</code>
                  }
                  @if (confirmUninstall() === helper.id) {
                    <div class="si-confirm" role="group" [attr.aria-label]="'Uninstall ' + helper.name">
                      <p class="si-confirm-title">Uninstall {{ helper.name }}?</p>
                      <p class="si-detail">Studio's Import and Export can't use it afterwards, and neither can other programs that do.@if (helper.uninstallNote) { {{ helper.uninstallNote }}}</p>
                      <code class="si-command">{{ helper.uninstallCommand }}</code>
                      <div class="si-confirm-actions">
                        <p-button label="Uninstall" size="small" severity="danger" [disabled]="busy()" (onClick)="uninstall(helper)" />
                        <p-button label="Cancel" size="small" severity="secondary" [text]="true" [disabled]="busy()" (onClick)="confirmUninstall.set(null)" />
                      </div>
                    </div>
                  }
                  @if (copyHint() === helper.id) {
                    <p class="si-note">Run this command in a terminal, then click Check Again.</p>
                  }
                </div>
                <div class="si-actions">
                  @if (row.action === 'install') {
                    <p-button label="Install" size="small" [disabled]="busy()" (onClick)="install(helper)" />
                  } @else if (row.action === 'update') {
                    <p-button label="Update" size="small" [disabled]="busy()" (onClick)="update(helper)" />
                  } @else if (row.action === 'requires') {
                    <p-button [label]="'Get ' + helper.requires" size="small" [disabled]="busy()" (onClick)="openPage('requires:' + helper.id)" />
                  } @else if (row.action === 'readers') {
                    <p-button label="Add Readers" size="small" [disabled]="busy()" (onClick)="install(helper)" />
                  }
                  <p-button
                    [label]="helper.installed || helper.installCommand ? 'Website' : 'Download Page'"
                    size="small"
                    severity="secondary"
                    [outlined]="true"
                    [disabled]="busy()"
                    (onClick)="openPage(helper.id)"
                  />
                  @if (helper.installed && helper.uninstallCommand && confirmUninstall() !== helper.id) {
                    <p-button label="Uninstall…" size="small" severity="secondary" [text]="true" [disabled]="busy()" (onClick)="confirmUninstall.set(helper.id)" />
                  }
                </div>
              </li>
            }
          </ul>
          @if (installStarted()) {
            <p class="si-note">It runs in its own window. This page checks again when it's done.</p>
          }
          @if (finished(); as done) {
            <p [class]="done.ok ? 'si-note si-done' : 'si-note'" role="status">{{ done.text }}</p>
          }
        }
      </div>
      <ng-template pTemplate="footer">
        <p-button label="Check Again" severity="secondary" [text]="true" [loading]="loading()" (onClick)="refresh()" />
        <p-button label="Close" (onClick)="visibleChange.emit(false)" />
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .si { display: grid; gap: 4px; }
    /* Context help: a small blue (?) after a card's title, opening its section of the help page. */
    .si-help {
      display: inline-flex; vertical-align: -2px; margin-left: 4px; padding: 1px; border: 0; border-radius: 50%;
      background: none; color: #2563c9; cursor: pointer; opacity: 0.85;
    }
    .si-help:hover { opacity: 1; background: rgba(37, 99, 201, 0.1); }
    .si-help:focus-visible { outline: 2px solid #2563c9; outline-offset: 1px; }
    /* Room under the last card, so a row cut off by scrolling reads as scrolled. */
    .si { padding-bottom: 8px; }
    .si h3 {
      margin: 18px 0 6px; font-size: 12.5px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #20242a;
    }
    .si h3:first-of-type { margin-top: 0; }
    .si-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    /* Tinted cards, so they stand apart from the white dialog and its headings. */
    .si-row {
      display: flex; gap: 12px; align-items: flex-start; justify-content: space-between;
      padding: 10px 12px; border: 1px solid #e3e6ea; border-radius: 8px; background: #f6f7f9;
    }
    /* A line between the scrolling list and the dialog's buttons. */
    ::ng-deep .si-dialog .p-dialog-footer {
      border-top: 1px solid #e3e6ea;
      padding-top: 12px;
    }
    .si-main { min-width: 0; flex: 1; }
    .si-title { font-weight: 600; }
    .si-status {
      display: flex; align-items: center; gap: 6px;
      margin-top: 3px; font-size: 13px; font-weight: 600;
    }
    /* A check or an X before the status, so it reads by shape, not only color. */
    .si-status ng-icon { flex: none; }
    .si-good { color: #1a7f37; }
    .si-warn { color: #b42318; }
    .si-off { color: #68717d; }
    .si-update { color: #9a6700; }
    .si-detail, .si-intro, .si-note { margin: 4px 0 0; font-size: 12.5px; line-height: 1.45; color: #4c5663; }
    .si-detail.si-facts { margin-top: 2px; }
    .si-note.si-done { color: #1a7f37; }
    /* Uninstall's question, inside its card. */
    .si-confirm { margin-top: 8px; padding: 8px 10px; border: 1px solid #d1242f; border-radius: 6px; background: rgba(209, 36, 47, 0.06); }
    .si-confirm-title { margin: 0; font-size: 13px; font-weight: 600; }
    .si-confirm-actions { display: flex; gap: 6px; margin-top: 8px; }
    .si-intro { margin: 0 0 4px; }
    .si-note { color: #9a6700; }
    .si-command {
      display: inline-block; margin-top: 6px; padding: 2px 6px; border-radius: 4px;
      background: #ffffff; border: 1px solid #e3e6ea; font-size: 12px; user-select: all; overflow-wrap: anywhere;
    }
    .si-actions { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
    .si-loading, .si-checking { color: #68717d; }
    /* A card still being checked: a small ring turning where its icon goes. */
    .si-spinner {
      flex: none; width: 11px; height: 11px; margin: 0 2px; border-radius: 50%;
      border: 2px solid currentColor; border-right-color: transparent;
      animation: si-spin 0.8s linear infinite;
    }
    @keyframes si-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .si-spinner { animation-duration: 2.4s; } }
    .si-error { color: #b42318; }
    @media (prefers-color-scheme: dark) {
      .si h3 { color: #e6e8ec; }
      .si-help { color: #6ea8fe; }
      .si-help:hover { background: rgba(110, 168, 254, 0.15); }
      .si-off, .si-loading, .si-checking { color: #9aa0a6; }
      .si-row { border-color: #3c3c3c; background: #262628; }
      ::ng-deep .si-dialog .p-dialog-footer { border-top-color: #3c3c3c; }
      .si-detail, .si-intro { color: #c4cad2; }
      .si-good { color: #4ac26b; }
      .si-warn { color: #f97066; }
      .si-note, .si-update { color: #d29922; }
      .si-note.si-done { color: #4ac26b; }
      .si-confirm { background: rgba(249, 112, 102, 0.08); border-color: #f97066; }
      .si-command { background: #1e1e1e; border-color: #3c3c3c; }
      .si-error { color: #f97066; }
    }
  `],
})
export class SystemIntegrationDialogComponent implements OnChanges, OnDestroy {
  @Input() visible = false;
  @Output() readonly visibleChange = new EventEmitter<boolean>();
  // A card's "Learn more": the heading id of its section on the help page.
  @Output() readonly learnMore = new EventEmitter<string | null>();

  readonly cards = signal<SystemIntegrationCards | null>(null);
  // Each card's last answer, by id ('markdown', 'pandoc'...). Kept while it's
  // checked again, so Check Again doesn't blank the cards.
  readonly results = signal<Readonly<Record<string, unknown>>>({});
  // Everything known so far, as one status; a card not checked yet is null
  // (Windows) or not installed (helpers), and shows a spinner instead.
  readonly status = computed<SystemIntegrationStatus | null>(() => {
    const cards = this.cards();
    if (!cards) return null;
    const results = this.results();
    const field = <T>(id: WindowsCardId) => (cards.windows.includes(id) ? (results[id] as T | undefined) ?? null : null);
    return {
      platform: cards.platform,
      portable: cards.portable,
      markdownDefault: field<SystemIntegrationStatus['markdownDefault']>('markdown'),
      previewHandler: field<SystemIntegrationStatus['previewHandler']>('preview'),
      outlook: field<SystemIntegrationStatus['outlook']>('outlook'),
      studio: field<SystemIntegrationStatus['studio']>('studio'),
      helpers: cards.helpers.map((helper) => ({
        ...helper,
        ...((results[helper.id] as { installed: boolean; version: string | null; missingReaders?: string[]; requirementMissing?: boolean } | undefined) ?? { installed: false, version: null }),
      })),
    };
  });
  private round = 0;
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly outlookChanged = signal(false);
  readonly previewChanged = signal(false);
  readonly installStarted = signal(false);
  readonly copyHint = signal<string | null>(null);
  // The helper whose card is asking "Uninstall …?", if any.
  readonly confirmUninstall = signal<string | null>(null);
  readonly latestVersions = signal<HelperLatestVersions>({});

  readonly helperRows = computed<HelperRow[]>(() => {
    const results = this.results();
    return (this.status()?.helpers ?? []).map((helper) => results[helper.id] === undefined
      // Still checking: just what it always needs; the size waits until it's known not to be installed.
      ? { helper, tone: 'checking', status: 'Checking…', command: null, action: null, facts: helper.requiresAlways && helper.requires ? `Needs ${helper.requires}.` : '' }
      : this.helperRow(helper, this.latestVersions()[helper.id]));
  });

  readonly windowsRows = computed<Row[]>(() => {
    const s = this.status();
    const cards = this.cards();
    if (!s || !cards) return [];
    const results = this.results();
    const rowFor: Record<WindowsCardId, (status: SystemIntegrationStatus) => Row | null> = {
      studio: (status) => this.studioRow(status),
      markdown: (status) => this.markdownRow(status),
      preview: (status) => this.previewRow(status),
      outlook: (status) => this.outlookRow(status),
    };
    return cards.windows
      .map((id) => (results[id] === undefined
        ? { id, title: WINDOWS_TITLES[id], tone: 'checking' as const, status: 'Checking…', detail: '' }
        : rowFor[id](s)))
      .filter((row): row is Row => row !== null);
  });

  // Choices made outside Studio (Windows Settings, an installer's terminal
  // window) show up when Studio's window gets the focus back.
  private readonly handleWindowFocus = () => {
    if (this.visible && !this.loading()) void this.refresh();
  };

  // What the last Install, Update or Uninstall's terminal window did, once
  // its command finished.
  readonly finished = signal<{ ok: boolean; text: string } | null>(null);
  private readonly stopFinished: (() => void) | undefined;

  constructor() {
    window.addEventListener('focus', this.handleWindowFocus);
    this.stopFinished = window.mdzipStudio?.onSystemIntegrationFinished?.((data) => this.onFinished(data));
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.handleWindowFocus);
    this.stopFinished?.();
  }

  // A terminal command finished: say so, and check every card again (even
  // when Studio never lost the focus, or got it back before the command was done).
  onFinished(data: { action: SystemIntegrationAction; id: string; code: number | null }): void {
    const name = data.id === 'studio' ? 'MDZip Studio' : this.cards()?.helpers.find((helper) => helper.id === data.id)?.name ?? data.id;
    const verb = data.action === 'uninstall-helper' ? 'uninstall' : data.action === 'upgrade-helper' ? 'update' : 'install';
    const done = data.action === 'uninstall-helper' ? 'uninstalled' : data.action === 'upgrade-helper' ? 'updated' : 'installed';
    this.installStarted.set(false);
    this.finished.set(data.code === 0
      ? { ok: true, text: `${name} was ${done}.` }
      : { ok: false, text: `The ${name} ${verb} didn't finish: its window says why.` });
    if (this.visible) void this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.outlookChanged.set(false);
      this.installStarted.set(false);
      this.copyHint.set(null);
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    const bridge = window.mdzipStudio;
    const getCards = bridge?.getSystemIntegrationCards;
    const check = bridge?.checkSystemIntegration;
    if (!getCards || !check) {
      this.error.set('System integration is available in the desktop app.');
      return;
    }
    // A newer round (Check Again, the window's focus) wins over a slower old one.
    const round = ++this.round;
    this.loading.set(true);
    this.error.set(null);
    try {
      const cards = await getCards();
      if (round !== this.round) return;
      this.cards.set(cards);
      // Newest versions come from the internet, alongside the local checks;
      // a slow or missing network holds up nothing.
      void this.loadLatestVersions();
      // Every card at once; each fills in when its own check answers.
      const answer = (id: string, value: unknown) => {
        if (round === this.round) this.results.update((results) => ({ ...results, [id]: value }));
      };
      await Promise.all([
        ...cards.windows.map((id) => check(id).then((value) => answer(id, value ?? null), () => answer(id, null))),
        ...cards.helpers.map((helper) => check(helper.id).then(
          (value) => answer(helper.id, value),
          () => answer(helper.id, { installed: false, version: null }),
        )),
      ]);
    } catch (error) {
      if (round === this.round) this.error.set(error instanceof Error ? error.message : 'Could not check this computer.');
    } finally {
      if (round === this.round) this.loading.set(false);
    }
  }

  private async loadLatestVersions(): Promise<void> {
    try {
      const latest = await window.mdzipStudio?.getHelperLatestVersions?.();
      if (latest) this.latestVersions.set(latest);
    } catch {
      // Unknown newest versions just leave the rows without "latest".
    }
  }

  showHelp(id: string): void {
    this.learnMore.emit(HELP_SECTIONS[id] ?? null);
  }

  toneIcon(tone: Tone): string {
    return TONE_ICONS[tone];
  }

  // After the card's "Uninstall …?": runs in a terminal window, as Install does.
  async uninstall(helper: SystemIntegrationHelper): Promise<void> {
    this.finished.set(null);
    const result = await this.run('uninstall-helper', helper.id);
    if (result?.ok) {
      this.confirmUninstall.set(null);
      this.installStarted.set(true);
    } else if (result?.error === 'no-terminal') {
      // The question stays open: it shows the command to run.
      this.copyHint.set(helper.id);
    }
  }

  async update(helper: SystemIntegrationHelper): Promise<void> {
    this.finished.set(null);
    const result = await this.run('upgrade-helper', helper.id);
    if (result?.ok) {
      this.installStarted.set(true);
    } else if (result?.error === 'no-terminal') {
      this.copyHint.set(helper.id);
    }
  }

  private helperRow(helper: SystemIntegrationHelper, newest?: { latest: string | null; upgradeCommand: string | null }): HelperRow {
    return { ...this.helperState(helper, newest), facts: helperFacts(helper) };
  }

  private helperState(helper: SystemIntegrationHelper, newest?: { latest: string | null; upgradeCommand: string | null }): Omit<HelperRow, 'facts'> {
    if (!helper.installed) {
      // Its install command would fail without what runs it: get that first.
      if (helper.requirementMissing && helper.requires) {
        return { helper, tone: 'off', status: `Not installed. Needs ${helper.requires} first`, command: helper.installCommand, action: 'requires' };
      }
      return { helper, tone: 'off', status: 'Not installed', command: helper.installCommand, action: helper.installCommand ? 'install' : null };
    }
    // Installed, but MarkItDown can't read some kinds of file: say which, and
    // offer the install command, which adds them ([all]).
    const missing = helper.missingReaders ?? [];
    if (missing.length) {
      const version = helper.version ? `, version ${helper.version}` : '';
      return {
        helper,
        tone: 'warn',
        status: `Installed${version}, but can't read ${readerNames(missing)} files`,
        command: helper.installCommand,
        action: helper.installCommand ? 'readers' : null,
      };
    }
    if (!helper.version) {
      return { helper, tone: 'good', status: 'Installed', command: null, action: null };
    }
    const latest = newest?.latest ?? null;
    if (latest && compareVersions(latest, helper.version) > 0) {
      const upgrade = newest?.upgradeCommand ?? null;
      return {
        helper,
        tone: 'update',
        status: `Version ${helper.version} installed; ${latest} is available`,
        command: upgrade,
        action: upgrade ? 'update' : null,
      };
    }
    return {
      helper,
      tone: 'good',
      status: latest ? `Installed, version ${helper.version} (the latest)` : `Installed, version ${helper.version}`,
      command: null,
      action: null,
    };
  }

  async install(helper: SystemIntegrationHelper): Promise<void> {
    this.finished.set(null);
    const result = await this.run('install-helper', helper.id);
    if (result?.ok) {
      this.installStarted.set(true);
    } else if (result?.error === 'no-terminal') {
      this.copyHint.set(helper.id);
    }
  }

  async openPage(id: string): Promise<void> {
    await this.run('open-page', id);
  }

  private async run(action: SystemIntegrationAction, id?: string): Promise<SystemIntegrationActionResult | null> {
    const bridge = window.mdzipStudio;
    if (!bridge?.runSystemIntegrationAction) return null;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await bridge.runSystemIntegrationAction({ action, id });
      if (!result.ok && result.error && result.error !== 'no-terminal') this.error.set(result.error);
      return result;
    } finally {
      this.busy.set(false);
    }
  }

  private async runAndRefresh(action: SystemIntegrationAction): Promise<void> {
    const result = await this.run(action);
    if (result?.ok && (action === 'outlook-allow' || action === 'outlook-undo')) this.outlookChanged.set(true);
    if (result?.ok && (action === 'preview-off' || action === 'preview-on')) this.previewChanged.set(true);
    await this.refresh();
  }

  // The portable version only: what installing Studio adds, and where to get it.
  private studioRow(s: SystemIntegrationStatus): Row | null {
    const studio = s.studio;
    if (!studio) return null;
    const title = WINDOWS_TITLES.studio;
    const getInstaller = { label: 'Get the Installer', run: () => void this.openPage('studio') };
    const keep = 'Your documents aren’t affected; settings made in the portable version stay with it.';
    if (studio.installed) {
      // Not "Open MDZip Studio": this is Studio, already open.
      return {
        id: 'studio', title: 'Installed version', tone: 'good',
        status: studio.installed === 'machine' ? 'Installed for all users' : 'Installed for you',
        detail: `You’re running the portable version. MDZip Studio is also installed on this computer, as a separate copy with its own settings. Your documents aren’t affected.`,
        action: { label: 'Open Installed Version', run: () => void this.runAndRefresh('open-studio') },
      };
    }
    const adds = 'The installed version opens .mdz files from File Explorer, can open .md files, shows previews in File Explorer, and can download and install a new version when you choose to (the portable version only tells you about it).';
    if (studio.via) {
      const manager = studio.via === 'winget' ? 'winget' : 'Chocolatey';
      return {
        id: 'studio', title, tone: 'off', status: 'This is the portable version',
        detail: `${adds} Install installs it for all users with ${manager}, with Windows Explorer integration; Windows asks for administrator rights. ${keep}`,
        action: { label: 'Install', run: () => void this.installStudio() },
        more: { label: 'Get the Installer', run: getInstaller.run },
        command: studio.command,
      };
    }
    return {
      id: 'studio', title, tone: 'off', status: 'This is the portable version',
      detail: `${adds} For all of these, install it for all users with the Windows Explorer integration option. ${keep}`,
      action: getInstaller,
    };
  }

  // Installs Studio in a terminal window (winget or Chocolatey); the card
  // checks again when it's done.
  async installStudio(): Promise<void> {
    this.finished.set(null);
    const result = await this.run('install-studio');
    if (result?.ok) this.installStarted.set(true);
  }

  private markdownRow(s: SystemIntegrationStatus): Row | null {
    const state = s.markdownDefault?.state;
    if (!state) return null;
    if (state === 'unsupported') {
      return {
        id: 'markdown',
        title: 'Open .md files with MDZip Studio',
        tone: 'off',
        status: 'Not available in the portable version',
        detail: 'The portable version doesn’t register with Windows, so it can’t be the default app.',
      };
    }
    if (state === 'unregistered') {
      return {
        id: 'markdown',
        title: 'Open .md files with MDZip Studio',
        tone: 'off',
        status: 'Needs an all-users install',
        detail: 'Windows offers MDZip Studio for .md files when it’s installed for all users with the installer’s Windows Explorer integration option. .mdz files already open in MDZip Studio.',
        action: { label: 'Get the Installer', secondary: true, run: () => void this.openPage('studio') },
      };
    }
    const isDefault = state === 'default';
    const viaSettings = s.markdownDefault?.via === 'settings';
    return {
      id: 'markdown',
      title: 'Open .md files with MDZip Studio',
      tone: isDefault ? 'good' : 'off',
      status: isDefault ? 'MDZip Studio opens .md files' : 'Another app opens .md files',
      detail: viaSettings
        ? 'Opens MDZip Studio’s page in Windows Settings: click .md, then choose MDZip Studio. .mdz files already open in MDZip Studio.'
        : 'Windows asks you to confirm the choice. .mdz files already open in MDZip Studio.',
      action: {
        label: viaSettings ? 'Open Settings…' : isDefault ? 'Change…' : 'Choose…',
        secondary: isDefault,
        run: () => void this.runAndRefresh('markdown-default'),
      },
    };
  }

  private previewRow(s: SystemIntegrationStatus): Row | null {
    const preview = s.previewHandler;
    if (!preview) return null;
    const title = 'Previews in File Explorer';
    const getInstaller = { label: 'Get the Installer', secondary: true, run: () => void this.openPage('studio') };
    switch (preview.state) {
      case 'installed':
        return {
          id: 'preview', title, tone: 'good', status: 'On',
          detail: 'Select an .mdz file in File Explorer to see it in the preview pane. If the pane is hidden, press Alt+P (or View → Show → Preview pane).',
          action: { label: 'Turn Off for Me', secondary: true, run: () => void this.runAndRefresh('preview-off') },
        };
      case 'off-for-user': {
        const other = preview.other;
        return {
          id: 'preview', title, tone: 'off', status: 'Off for you',
          detail: (other
            ? `File Explorer shows ${other.name ? `“${other.name}”` : 'another program’s preview'} for .mdz files instead. `
            : 'File Explorer doesn’t preview .mdz files for you. ')
            + 'Other people who use this computer aren’t affected.',
          action: { label: 'Turn On', run: () => void this.runAndRefresh('preview-on') },
        };
      }
      case 'portable':
        return {
          id: 'preview', title, tone: 'off', status: 'Not available in the portable version',
          detail: 'Explorer previews come with the MDZip Studio installer, installed for all users.',
          action: getInstaller,
        };
      case 'not-installed':
        return {
          id: 'preview', title, tone: 'off', status: 'Off',
          detail: 'Explorer previews come with an all-users install of MDZip Studio, with the installer’s Windows Explorer integration option.',
          action: getInstaller,
        };
      case 'other':
        return {
          id: 'preview', title, tone: 'warn', status: 'Another program previews .mdz files',
          detail: 'Reinstalling MDZip Studio for all users makes its preview the one Explorer uses.',
          action: getInstaller,
        };
      case 'broken':
        return {
          id: 'preview', title, tone: 'warn', status: 'Not working',
          detail: preview.reason === 'runtime'
            ? 'The preview needs the Microsoft .NET 10 Desktop Runtime. Reinstalling MDZip Studio for all users installs it.'
            : 'The preview’s files are missing. Reinstall MDZip Studio for all users.',
          action: getInstaller,
        };
    }
  }

  private outlookRow(s: SystemIntegrationStatus): Row | null {
    const outlook = s.outlook;
    if (!outlook) return null;
    const title = '.mdz attachments in Outlook';
    switch (outlook.state) {
      case 'not-found':
        return {
          id: 'outlook', title, tone: 'off', status: 'Classic Outlook not found',
          detail: 'Classic Outlook for Windows blocks .mdz attachments until it’s told they’re safe. It isn’t set up for you on this computer.',
        };
      case 'blocked':
        return {
          id: 'outlook', title, tone: 'warn', status: 'Blocked',
          detail: 'Classic Outlook blocks .mdz attachments you receive. Allowing them makes them normal attachments you can save and open; nothing else changes.',
          action: { label: 'Allow .mdz', run: () => void this.runAndRefresh('outlook-allow') },
        };
      case 'allowed':
        return {
          id: 'outlook', title, tone: 'good', status: 'Allowed',
          detail: outlook.managed
            ? 'Your organization allows .mdz attachments in classic Outlook.'
            : 'Classic Outlook delivers .mdz attachments as normal attachments.',
          action: outlook.managed ? undefined : { label: 'Block Again', secondary: true, run: () => void this.runAndRefresh('outlook-undo') },
        };
      case 'managed':
        return {
          id: 'outlook', title, tone: 'warn', status: 'Blocked by your organization',
          detail: 'Your organization manages which attachments classic Outlook blocks. Ask your IT department to allow .mdz.',
        };
    }
  }
}

// Compares dotted version numbers ("3.6.4" vs "3.14"): negative, 0 or
// positive; missing parts count as 0. (The same rule as compareVersions in
// electron/lib/system-integration.js.)
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
