import { SimpleChange } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemIntegrationDialogComponent, SystemIntegrationStatus } from './system-integration-dialog.component';

const helpers: SystemIntegrationStatus['helpers'] = [
  { id: 'pandoc', name: 'Pandoc', purpose: 'Converts.', url: 'https://pandoc.org', installCommand: 'winget install --id JohnMacFarlane.Pandoc --exact --source winget', installed: true, version: '3.14' },
  { id: 'typst', name: 'Typst', purpose: 'Typesets.', url: 'https://typst.app', installCommand: 'winget install --id Typst.Typst --exact --source winget', installed: false, version: null },
];

function windowsStatus(overrides: Partial<SystemIntegrationStatus> = {}): SystemIntegrationStatus {
  return {
    platform: 'win32',
    portable: false,
    markdownDefault: { state: 'not-default' },
    previewHandler: { state: 'installed' },
    outlook: { state: 'blocked', version: '16.0', managed: false },
    helpers,
    ...overrides,
  };
}

// The main process's side, answering from a status that a test can change:
// the cards at once, then each card's check.
function fakeBridge(initial: SystemIntegrationStatus) {
  let status = initial;
  const getCards = vi.fn(async () => ({
    platform: status.platform,
    portable: status.portable,
    windows: status.platform === 'win32' ? ['markdown', 'preview', 'outlook'] : [],
    helpers: status.helpers.map(({ installed: _installed, version: _version, ...card }) => card),
  }));
  const check = vi.fn(async (id: string) => {
    if (id === 'markdown') return status.markdownDefault;
    if (id === 'preview') return status.previewHandler;
    if (id === 'outlook') return status.outlook;
    const helper = status.helpers.find((candidate) => candidate.id === id)!;
    return { installed: helper.installed, version: helper.version };
  });
  return { getCards, check, setStatus: (next: SystemIntegrationStatus) => { status = next; } };
}

async function open(status: SystemIntegrationStatus, action = vi.fn().mockResolvedValue({ ok: true })) {
  const bridge = fakeBridge(status);
  vi.stubGlobal('mdzipStudio', {
    getSystemIntegrationCards: bridge.getCards,
    checkSystemIntegration: bridge.check,
    runSystemIntegrationAction: action,
  });
  const dialog = new SystemIntegrationDialogComponent();
  dialog.visible = true;
  dialog.ngOnChanges({ visible: new SimpleChange(false, true, true) });
  await vi.waitFor(() => expect(dialog.loading()).toBe(false));
  return { dialog, getCards: bridge.getCards, setStatus: bridge.setStatus, action };
}

describe('SystemIntegrationDialogComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checks the computer when opened and lists the Windows rows', async () => {
    const { dialog, getCards } = await open(windowsStatus());
    expect(getCards).toHaveBeenCalledOnce();
    expect(dialog.windowsRows().map((row) => [row.id, row.status])).toEqual([
      ['markdown', 'Another app opens .md files'],
      ['preview', 'On'],
      ['outlook', 'Blocked'],
    ]);
  });

  it("on Windows 11, sends the .md choice to Studio's page in Settings and re-checks on return", async () => {
    const { dialog, setStatus } = await open(windowsStatus({ markdownDefault: { state: 'not-default', via: 'settings' } }));
    const row = dialog.windowsRows().find((entry) => entry.id === 'markdown')!;
    expect(row.action?.label).toBe('Open Settings…');
    expect(row.detail).toMatch(/click \.md, then choose MDZip Studio/);

    setStatus(windowsStatus({ markdownDefault: { state: 'default', via: 'settings' } }));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(dialog.windowsRows()[0].status).toBe('MDZip Studio opens .md files'));
    dialog.ngOnDestroy();
  });

  it('points a current-user install to the installer instead of Settings for .md', async () => {
    const { dialog, action } = await open(windowsStatus({ markdownDefault: { state: 'unregistered', via: 'settings' } }));
    const row = dialog.windowsRows().find((entry) => entry.id === 'markdown')!;
    expect(row.status).toBe('Needs an all-users install');
    expect(row.action?.label).toBe('Get the Installer');
    row.action!.run();
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith({ action: 'open-page', id: 'studio' }));
  });

  it("asks for each card's section of the help page", async () => {
    const { dialog } = await open(windowsStatus());
    const asked: (string | null)[] = [];
    dialog.learnMore.subscribe((anchor) => asked.push(anchor));
    for (const id of ['markdown', 'preview', 'outlook', 'helpers', 'pandoc', 'mmdc', 'mdz']) dialog.showHelp(id);
    expect(asked).toEqual([
      'opening-md-files', 'explorer-previews', 'outlook-attachments', 'helper-programs', 'pandoc', 'mermaid-cli', 'mdz-command-line',
    ]);
  });

  it('has no Windows rows elsewhere, only helper programs', async () => {
    const { dialog } = await open(windowsStatus({ platform: 'darwin', markdownDefault: null, previewHandler: null, outlook: null }));
    expect(dialog.windowsRows()).toEqual([]);
    expect(dialog.status()?.helpers).toHaveLength(2);
  });

  it('allows .mdz in Outlook, re-checks, and asks for an Outlook restart', async () => {
    const { dialog, setStatus, action } = await open(windowsStatus());
    setStatus(windowsStatus({ outlook: { state: 'allowed', version: '16.0', managed: false } }));
    dialog.windowsRows().find((row) => row.id === 'outlook')!.action!.run();
    await vi.waitFor(() => expect(dialog.windowsRows().find((row) => row.id === 'outlook')?.status).toBe('Allowed'));
    expect(action).toHaveBeenCalledWith({ action: 'outlook-allow', id: undefined });
    expect(dialog.outlookChanged()).toBe(true);
    expect(dialog.windowsRows().find((row) => row.id === 'outlook')?.action?.label).toBe('Block Again');
  });

  it('turns Explorer previews off for this user, says what shows instead, and back on', async () => {
    const { dialog, setStatus, action } = await open(windowsStatus());
    const preview = () => dialog.windowsRows().find((row) => row.id === 'preview')!;
    expect(preview().action?.label).toBe('Turn Off for Me');

    setStatus(windowsStatus({
      previewHandler: { state: 'off-for-user', other: { clsid: '{6F3A5A7E-9B2C-4D1E-8F0A-2B3C4D5E6F7A}', name: 'MarkdownZip Preview Handler' } },
    }));
    preview().action!.run();
    await vi.waitFor(() => expect(preview().status).toBe('Off for you'));
    expect(action).toHaveBeenCalledWith({ action: 'preview-off', id: undefined });
    expect(preview().detail).toMatch(/“MarkdownZip Preview Handler” for \.mdz files instead\. Other people who use this computer aren’t affected\.$/);
    expect(dialog.previewChanged()).toBe(true);

    setStatus(windowsStatus());
    expect(preview().action?.label).toBe('Turn On');
    preview().action!.run();
    await vi.waitFor(() => expect(preview().status).toBe('On'));
    expect(action).toHaveBeenCalledWith({ action: 'preview-on', id: undefined });
  });

  it('offers no Outlook button when the organization manages it', async () => {
    const { dialog } = await open(windowsStatus({ outlook: { state: 'managed', version: '16.0', managed: true } }));
    const row = dialog.windowsRows().find((entry) => entry.id === 'outlook')!;
    expect(row.status).toBe('Blocked by your organization');
    expect(row.action).toBeUndefined();
  });

  it('points to the installer when Explorer previews are missing or broken', async () => {
    for (const previewHandler of [
      { state: 'not-installed' as const },
      { state: 'portable' as const },
      { state: 'broken' as const, reason: 'runtime' as const },
    ]) {
      const { dialog, action } = await open(windowsStatus({ previewHandler }));
      const row = dialog.windowsRows().find((entry) => entry.id === 'preview')!;
      expect(row.action?.label).toBe('Get the Installer');
      row.action!.run();
      await vi.waitFor(() => expect(action).toHaveBeenCalledWith({ action: 'open-page', id: 'studio' }));
    }
  });

  it('installs a helper in a terminal, or asks to run the command where it cannot', async () => {
    const { dialog, action } = await open(windowsStatus());
    await dialog.install(helpers[1]);
    expect(action).toHaveBeenCalledWith({ action: 'install-helper', id: 'typst' });
    expect(dialog.installStarted()).toBe(true);

    action.mockResolvedValue({ ok: false, error: 'no-terminal', command: helpers[1].installCommand });
    await dialog.install(helpers[1]);
    expect(dialog.copyHint()).toBe('typst');
    expect(dialog.error()).toBeNull();
  });

  it('compares installed helpers with their newest versions, and offers Update', async () => {
    const getLatest = vi.fn().mockResolvedValue({
      pandoc: { latest: '3.14', upgradeCommand: 'winget upgrade --id JohnMacFarlane.Pandoc --exact --source winget' },
      typst: { latest: '0.15.1', upgradeCommand: 'winget upgrade --id Typst.Typst --exact --source winget' },
    });
    const mdz = { id: 'mdz', name: 'mdz command line', purpose: 'CLI.', url: 'https://example.org', installCommand: 'winget install --id MDZip.Cli --exact --source winget', installed: true, version: '2.0.0' };
    const bridge = fakeBridge(windowsStatus({ helpers: [...helpers, mdz] }));
    const action = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('mdzipStudio', {
      getSystemIntegrationCards: bridge.getCards,
      checkSystemIntegration: bridge.check,
      getHelperLatestVersions: getLatest,
      runSystemIntegrationAction: action,
    });
    const dialog = new SystemIntegrationDialogComponent();
    await dialog.refresh();
    await vi.waitFor(() => expect(dialog.helperRows()[0].status).toBe('Installed, version 3.14 (the latest)'));

    expect(dialog.helperRows().map((row) => [row.helper.id, row.tone, row.action])).toEqual([
      ['pandoc', 'good', null],
      ['typst', 'off', 'install'],
      // No answer for mdz: it just doesn't say whether it's the latest.
      ['mdz', 'good', null],
    ]);

    getLatest.mockResolvedValue({ mdz: { latest: '2.1.0', upgradeCommand: 'winget upgrade --id MDZip.Cli --exact --source winget' } });
    await dialog.refresh();
    await vi.waitFor(() => expect(dialog.helperRows()[2].tone).toBe('update'));
    const row = dialog.helperRows()[2];
    expect(row.status).toBe('Version 2.0.0 installed; 2.1.0 is available');
    expect(row.command).toBe('winget upgrade --id MDZip.Cli --exact --source winget');
    expect(dialog.toneIcon(row.tone)).toBe('lucideCircleArrowUp');
    await dialog.update(mdz);
    expect(action).toHaveBeenCalledWith({ action: 'upgrade-helper', id: 'mdz' });
    expect(dialog.installStarted()).toBe(true);
  });

  it('shows every card at once, each checking until its own check answers', async () => {
    const bridge = fakeBridge(windowsStatus());
    const answers = new Map<string, (value: unknown) => void>();
    const slow = vi.fn((id: string) => new Promise((resolve) => answers.set(id, resolve)));
    vi.stubGlobal('mdzipStudio', { getSystemIntegrationCards: bridge.getCards, checkSystemIntegration: slow });
    const dialog = new SystemIntegrationDialogComponent();
    void dialog.refresh();
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(5));
    expect(dialog.windowsRows().map((row) => [row.title, row.tone])).toEqual([
      ['Open .md files with MDZip Studio', 'checking'],
      ['Previews in File Explorer', 'checking'],
      ['.mdz attachments in Outlook', 'checking'],
    ]);
    expect(dialog.helperRows().map((row) => [row.helper.name, row.status])).toEqual([['Pandoc', 'Checking…'], ['Typst', 'Checking…']]);

    // Typst answers first; Pandoc (slow) still checks.
    answers.get('typst')!({ installed: false, version: null });
    answers.get('outlook')!({ state: 'blocked', version: '16.0', managed: false });
    await vi.waitFor(() => expect(dialog.helperRows()[1].status).toBe('Not installed'));
    expect(dialog.helperRows()[0].tone).toBe('checking');
    expect(dialog.windowsRows().map((row) => row.tone)).toEqual(['checking', 'checking', 'warn']);
    expect(dialog.loading()).toBe(true);

    for (const [id, resolve] of answers) {
      if (id === 'pandoc') resolve({ installed: true, version: '3.14' });
      else if (id === 'markdown') resolve({ state: 'default' });
      else if (id === 'preview') resolve({ state: 'installed' });
    }
    await vi.waitFor(() => expect(dialog.loading()).toBe(false));
    expect(dialog.helperRows()[0].status).toBe('Installed, version 3.14');
  });

  it("keeps a card's last answer while it's checked again, and a failed check doesn't stop the rest", async () => {
    const { dialog } = await open(windowsStatus());
    const check = vi.fn((id: string) => (id === 'pandoc' ? new Promise(() => {}) : id === 'typst' ? Promise.reject(new Error('no')) : Promise.resolve({ state: 'installed' })));
    (window.mdzipStudio as { checkSystemIntegration: unknown }).checkSystemIntegration = check;
    void dialog.refresh();
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(5));
    expect(dialog.helperRows()[0].status).toBe('Installed, version 3.14');
    await vi.waitFor(() => expect(dialog.helperRows()[1].status).toBe('Not installed'));
    expect(dialog.error()).toBeNull();
  });

  it('says so outside the desktop app', async () => {
    vi.stubGlobal('mdzipStudio', undefined);
    const dialog = new SystemIntegrationDialogComponent();
    await dialog.refresh();
    expect(dialog.error()).toMatch(/desktop app/);
  });
});
