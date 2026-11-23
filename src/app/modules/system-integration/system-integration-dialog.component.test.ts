import { SimpleChange } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemIntegrationDialogComponent, SystemIntegrationStatus, helperFacts, readerNames } from './system-integration-dialog.component';

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
    windows: status.platform === 'win32' ? [...(status.portable ? ['studio'] : []), 'markdown', 'preview', 'outlook'] : [],
    helpers: status.helpers.map(({ installed: _installed, version: _version, missingReaders: _missing, requirementMissing: _requirement, ...card }) => card),
  }));
  const check = vi.fn(async (id: string) => {
    if (id === 'markdown') return status.markdownDefault;
    if (id === 'preview') return status.previewHandler;
    if (id === 'outlook') return status.outlook;
    if (id === 'studio') return status.studio;
    const helper = status.helpers.find((candidate) => candidate.id === id)!;
    return { installed: helper.installed, version: helper.version, missingReaders: helper.missingReaders, requirementMissing: helper.requirementMissing };
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

  it('offers to install Studio first in the portable version, and not otherwise', async () => {
    const portable = (studio: SystemIntegrationStatus['studio']) => windowsStatus({
      portable: true, markdownDefault: { state: 'unsupported' }, previewHandler: { state: 'portable' }, studio,
    });
    const winget = 'winget install --id MDZip.Studio --exact --source winget --scope machine';
    const { dialog, action } = await open(portable({ installed: null, via: 'winget', command: winget }));
    const rows = dialog.windowsRows();
    expect(rows.map((row) => row.id)).toEqual(['studio', 'markdown', 'preview', 'outlook']);
    expect(rows[0]).toMatchObject({ title: 'Install MDZip Studio', status: 'This is the portable version', command: winget });
    expect(rows[0].detail).toMatch(/install a new version when you choose to.*with winget/);
    expect(rows[0].action?.label).toBe('Install');
    expect(rows[0].more?.label).toBe('Get the Installer');
    rows[0].action!.run();
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith({ action: 'install-studio', id: undefined }));
    await vi.waitFor(() => expect(dialog.installStarted()).toBe(true));
    rows[0].more!.run();
    await vi.waitFor(() => expect(action).toHaveBeenCalledWith({ action: 'open-page', id: 'studio' }));

    dialog.onFinished({ action: 'install-studio', id: 'studio', code: 0 });
    expect(dialog.finished()).toEqual({ ok: true, text: 'MDZip Studio was installed.' });

    const asked: (string | null)[] = [];
    dialog.learnMore.subscribe((anchor) => asked.push(anchor));
    dialog.showHelp('studio');
    expect(asked).toEqual(['installing-mdzip-studio']);

    const choco = await open(portable({ installed: null, via: 'choco', command: 'choco install mdzip-studio -y' }));
    expect(choco.dialog.windowsRows()[0].detail).toMatch(/with Chocolatey/);

    const neither = await open(portable({ installed: null, via: null, command: null }));
    const row = neither.dialog.windowsRows()[0];
    expect(row.action?.label).toBe('Get the Installer');
    expect(row.more).toBeUndefined();
    expect(row.command).toBeUndefined();

    const both = await open(portable({ installed: 'machine', via: null, command: null }));
    const installedRow = both.dialog.windowsRows()[0];
    expect(installedRow).toMatchObject({ title: 'Installed version', tone: 'good', status: 'Installed for all users' });
    expect(installedRow.action?.label).toBe('Open Installed Version');
    installedRow.action!.run();
    await vi.waitFor(() => expect(both.action).toHaveBeenCalledWith({ action: 'open-studio', id: undefined }));

    const installed = await open(windowsStatus());
    expect(installed.dialog.windowsRows().some((row) => row.id === 'studio')).toBe(false);
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

  it("says which files markitdown-mdz can't read, and offers to add the readers", async () => {
    const markitdown = {
      id: 'markitdown-mdz', name: 'markitdown-mdz', purpose: 'Imports.', url: 'https://example.org',
      installCommand: 'py -m pip install --user "markitdown-mdzip[all]"', installed: true, version: '0.1.1',
      missingReaders: ['docx', 'pptx', 'xlsx', 'xls'],
    };
    const { dialog, action } = await open(windowsStatus({ helpers: [markitdown] }));
    const row = dialog.helperRows()[0];
    expect(row.status).toBe("Installed, version 0.1.1, but can't read Word, PowerPoint and Excel files");
    expect([row.tone, row.action, row.command]).toEqual(['warn', 'readers', 'py -m pip install --user "markitdown-mdzip[all]"']);
    await dialog.install(row.helper);
    expect(action).toHaveBeenCalledWith({ action: 'install-helper', id: 'markitdown-mdz' });
    expect(readerNames(['pdf'])).toBe('PDF');
    expect(readerNames(['docx', 'rtf'])).toBe('Word and .rtf');
  });

  it('says what a program needs and costs, and offers to get what installs it when that is missing', async () => {
    const markitdown = {
      id: 'markitdown-mdz', name: 'markitdown-mdz', purpose: 'Imports.', url: 'https://example.org',
      installCommand: 'py -m pip install --user "markitdown-mdzip[all]"', size: 'About 115 MB to download.',
      requires: 'Python', requiresAlways: true, installed: false, version: null, requirementMissing: true,
    };
    const pandoc = {
      id: 'pandoc', name: 'Pandoc', purpose: 'Converts.', url: 'https://example.org',
      installCommand: 'winget install --id JohnMacFarlane.Pandoc --exact --source winget', size: 'About 45 MB to download.',
      requires: 'winget', requiresAlways: false, installed: false, version: null, requirementMissing: false,
    };
    const { dialog, action } = await open(windowsStatus({ helpers: [markitdown, pandoc] }));
    const [python, winget] = dialog.helperRows();
    expect([python.status, python.action, python.facts]).toEqual(['Not installed. Needs Python first', 'requires', 'Needs Python. About 115 MB to download.']);
    // winget is there, so it isn't mentioned; the size is.
    expect([winget.status, winget.action, winget.facts]).toEqual(['Not installed', 'install', 'About 45 MB to download.']);
    await dialog.openPage('requires:markitdown-mdz');
    expect(action).toHaveBeenCalledWith({ action: 'open-page', id: 'requires:markitdown-mdz' });

    // Installed: what it needs stays (Python), what it cost goes.
    expect(helperFacts({ ...markitdown, installed: true, version: '0.1.1', requirementMissing: false })).toBe('Needs Python.');
    expect(helperFacts({ ...pandoc, installed: true, version: '3.14' })).toBe('');
    expect(helperFacts({ ...pandoc, requirementMissing: true })).toBe('Needs winget. About 45 MB to download.');
  });

  it('uninstalls a program only after its card asks, and says what stays behind', async () => {
    const mmdc = {
      id: 'mmdc', name: 'Mermaid CLI', purpose: 'Draws.', url: 'https://example.org',
      installCommand: 'npm install -g @mermaid-js/mermaid-cli', uninstallCommand: 'npm uninstall -g @mermaid-js/mermaid-cli',
      uninstallNote: 'Its copies of Chrome stay.', installed: true, version: '12.2.0',
    };
    const typst = { ...mmdc, id: 'typst', name: 'Typst', uninstallCommand: 'winget uninstall --id Typst.Typst --exact --source winget', uninstallNote: null, installed: false, version: null };
    const { dialog, action } = await open(windowsStatus({ helpers: [mmdc, typst] }));
    expect(dialog.confirmUninstall()).toBeNull();
    dialog.confirmUninstall.set('mmdc'); // Uninstall… asks first; nothing has run yet
    expect(action).not.toHaveBeenCalled();
    await dialog.uninstall(dialog.helperRows()[0].helper);
    expect(action).toHaveBeenCalledWith({ action: 'uninstall-helper', id: 'mmdc' });
    expect(dialog.confirmUninstall()).toBeNull();
    expect(dialog.installStarted()).toBe(true);

    // Where Studio can't open a terminal, the question stays open: it shows the command.
    action.mockResolvedValue({ ok: false, error: 'no-terminal', command: mmdc.uninstallCommand });
    dialog.confirmUninstall.set('mmdc');
    await dialog.uninstall(dialog.helperRows()[0].helper);
    expect(dialog.confirmUninstall()).toBe('mmdc');
    expect(dialog.copyHint()).toBe('mmdc');
  });

  it('checks again and says so when an install, update or uninstall finishes in its window', async () => {
    let finish: ((data: { action: string; id: string; code: number | null }) => void) | null = null;
    const stop = vi.fn();
    const bridge = fakeBridge(windowsStatus());
    const action = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('mdzipStudio', {
      getSystemIntegrationCards: bridge.getCards,
      checkSystemIntegration: bridge.check,
      runSystemIntegrationAction: action,
      onSystemIntegrationFinished: (callback: typeof finish) => { finish = callback; return stop; },
    });
    const dialog = new SystemIntegrationDialogComponent();
    dialog.visible = true;
    dialog.ngOnChanges({ visible: new SimpleChange(false, true, true) });
    await vi.waitFor(() => expect(dialog.loading()).toBe(false));
    expect(dialog.helperRows()[1].status).toBe('Not installed');

    await dialog.install(helpers[1]);
    expect(dialog.installStarted()).toBe(true);
    // Typst's window finishes; Studio never lost the focus.
    bridge.setStatus(windowsStatus({ helpers: [helpers[0], { ...helpers[1], installed: true, version: '0.15.1' }] }));
    finish!({ action: 'install-helper', id: 'typst', code: 0 });
    expect(dialog.installStarted()).toBe(false);
    expect(dialog.finished()).toEqual({ ok: true, text: 'Typst was installed.' });
    await vi.waitFor(() => expect(dialog.helperRows()[1].status).toBe('Installed, version 0.15.1'));

    finish!({ action: 'uninstall-helper', id: 'typst', code: 1 });
    expect(dialog.finished()).toEqual({ ok: false, text: "The Typst uninstall didn't finish: its window says why." });
    dialog.ngOnDestroy();
    expect(stop).toHaveBeenCalled();
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
