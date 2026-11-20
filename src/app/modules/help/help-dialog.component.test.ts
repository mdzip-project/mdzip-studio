import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpDialogComponent, HelpLocation } from './help-dialog.component';

// Constructed directly in an injection context, like AppComponent's tests: no
// template compiler here.
describe('HelpDialogComponent', () => {
  let dialog: HelpDialogComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    runInInjectionContext(TestBed.inject(Injector), () => {
      dialog = new HelpDialogComponent();
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens a help document from the bundled copy when the newest one cannot be fetched', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new TextEncoder().encode('# Known Issues\n\nBundled copy').buffer });
    vi.stubGlobal('fetch', fetch);

    await dialog.open('known-issues');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://raw.githubusercontent.com/mdzip-project/mdzip-studio/main/src/assets/help/known-issues.md',
      { cache: 'no-store' }
    );
    expect(fetch).toHaveBeenNthCalledWith(2, 'assets/help/known-issues.md', { cache: 'no-store' });
    expect(dialog.visible()).toBe(true);
    expect(dialog.status()).toBe('Showing bundled copy');
    expect(new TextDecoder().decode(dialog.bytes() ?? new Uint8Array())).toContain('Bundled copy');
    // Not Studio's help: no page on mdzip.org.
    expect(dialog.onlineUrl()).toBeNull();
  });

  it("opens Studio's help from the bundled copy at a page and section, and hands it to a new window", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([80, 75, 3, 4]).buffer });
    vi.stubGlobal('fetch', fetch);
    const moved: HelpLocation[] = [];
    dialog.openWindow.subscribe((location) => moved.push(location));

    await dialog.open('studio-help', 'explorer-previews', 'system-integration.md');

    // No GitHub fetch: the bundled copy describes this version of Studio.
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('assets/help/mdzip-studio-help.mdz', { cache: 'no-store' });
    expect(dialog.status()).toMatch(/^For MDZip Studio \d/);
    expect(dialog.onlineUrl()).toBe('https://mdzip.org/docs/studio-system-integration.html#explorer-previews');

    dialog.openInNewWindow();
    expect(moved).toEqual([{ doc: 'studio-help', page: 'system-integration.md', anchor: 'explorer-previews' }]);
    expect(dialog.visible()).toBe(false);
  });
});
