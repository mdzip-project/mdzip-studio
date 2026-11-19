import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, computed, signal } from '@angular/core';
import { HELP_SECTIONS } from './help-sections';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideCircleArrowUp, lucideCircleCheck, lucideCircleHelp, lucideCircleX } from '@ng-icons/lucide';

// What the main process reports for Help > System Integration… (studio#11);
// see electron/lib/system-integration.js.
export interface SystemIntegrationHelper {
  id: string;
  name: string;
  purpose: string;
  url: string;
  installCommand: string | null;
  installed: boolean;
  version: string | null;
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
// version of a helper program is out). Each has its own icon shape.
type Tone = 'good' | 'warn' | 'off' | 'update';

const TONE_ICONS: Record<Tone, string> = {
  good: 'lucideCircleCheck',
  warn: 'lucideCircleX',
  off: 'lucideCircleX',
  update: 'lucideCircleArrowUp',
};

interface HelperRow {
  helper: SystemIntegrationHelper;
  tone: Tone;
  status: string;
  // The command the row's button runs, shown so you can see what it does.
  command: string | null;
  action: 'install' | 'update' | null;
}

interface Row {
  id: string;
  title: string;
  tone: Tone;
  status: string;
  detail: string;
  action?: { label: string; run: () => void; secondary?: boolean };
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
                      <ng-icon [name]="toneIcon(row.tone)" size="15" aria-hidden="true" />
                      {{ row.status }}
                    </div>
                    <p class="si-detail">{{ row.detail }}</p>
                    @if (row.id === 'outlook' && outlookChanged()) {
                      <p class="si-note">Restart Outlook for this to take effect.</p>
                    }
                    @if (row.id === 'preview' && previewChanged()) {
                      <p class="si-note">Open a new File Explorer window for this to take effect.</p>
                    }
                  </div>
                  @if (row.action; as action) {
                    <p-button
                      [label]="action.label"
                      size="small"
                      [severity]="action.secondary ? 'secondary' : undefined"
                      [outlined]="!!action.secondary"
                      [disabled]="busy()"
                      (onClick)="action.run()"
                    />
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
            Studio works without these. Export and Import, coming in later versions, use them when they're installed.
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
                    <ng-icon [name]="toneIcon(row.tone)" size="15" aria-hidden="true" />
                    {{ row.status }}
                  </div>
                  <p class="si-detail">{{ helper.purpose }}</p>
                  @if (row.command) {
                    <code class="si-command">{{ row.command }}</code>
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
                  }
                  <p-button
                    [label]="helper.installed || helper.installCommand ? 'Website' : 'Download Page'"
                    size="small"
                    severity="secondary"
                    [outlined]="true"
                    [disabled]="busy()"
                    (onClick)="openPage(helper.id)"
                  />
                </div>
              </li>
            }
          </ul>
          @if (installStarted()) {
            <p class="si-note">It runs in its own window. When it's done, come back here, or click Check Again.</p>
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
    .si-intro { margin: 0 0 4px; }
    .si-note { color: #9a6700; }
    .si-command {
      display: inline-block; margin-top: 6px; padding: 2px 6px; border-radius: 4px;
      background: #ffffff; border: 1px solid #e3e6ea; font-size: 12px; user-select: all; overflow-wrap: anywhere;
    }
    .si-actions { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
    .si-loading { color: #68717d; }
    .si-error { color: #b42318; }
    @media (prefers-color-scheme: dark) {
      .si h3 { color: #e6e8ec; }
      .si-help { color: #6ea8fe; }
      .si-help:hover { background: rgba(110, 168, 254, 0.15); }
      .si-off, .si-loading { color: #9aa0a6; }
      .si-row { border-color: #3c3c3c; background: #262628; }
      ::ng-deep .si-dialog .p-dialog-footer { border-top-color: #3c3c3c; }
      .si-detail, .si-intro { color: #c4cad2; }
      .si-good { color: #4ac26b; }
      .si-warn { color: #f97066; }
      .si-note, .si-update { color: #d29922; }
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

  readonly status = signal<SystemIntegrationStatus | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly outlookChanged = signal(false);
  readonly previewChanged = signal(false);
  readonly installStarted = signal(false);
  readonly copyHint = signal<string | null>(null);
  readonly latestVersions = signal<HelperLatestVersions>({});

  readonly helperRows = computed<HelperRow[]>(() =>
    (this.status()?.helpers ?? []).map((helper) => this.helperRow(helper, this.latestVersions()[helper.id])));

  readonly windowsRows = computed<Row[]>(() => {
    const s = this.status();
    if (!s || s.platform !== 'win32') return [];
    return [this.markdownRow(s), this.previewRow(s), this.outlookRow(s)].filter((row): row is Row => row !== null);
  });

  // Choices made outside Studio (Windows Settings, an installer's terminal
  // window) show up when Studio's window gets the focus back.
  private readonly handleWindowFocus = () => {
    if (this.visible && !this.loading()) void this.refresh();
  };

  constructor() {
    window.addEventListener('focus', this.handleWindowFocus);
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.handleWindowFocus);
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
    if (!bridge?.getSystemIntegrationStatus) {
      this.error.set('System integration is available in the desktop app.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      this.status.set(await bridge.getSystemIntegrationStatus());
      // Newest versions come from the internet, after the local checks, so a
      // slow or missing network never holds up the dialog.
      void this.loadLatestVersions();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not check this computer.');
    } finally {
      this.loading.set(false);
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

  async update(helper: SystemIntegrationHelper): Promise<void> {
    const result = await this.run('upgrade-helper', helper.id);
    if (result?.ok) {
      this.installStarted.set(true);
    } else if (result?.error === 'no-terminal') {
      this.copyHint.set(helper.id);
    }
  }

  private helperRow(helper: SystemIntegrationHelper, newest?: { latest: string | null; upgradeCommand: string | null }): HelperRow {
    if (!helper.installed) {
      return { helper, tone: 'off', status: 'Not installed', command: helper.installCommand, action: helper.installCommand ? 'install' : null };
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
