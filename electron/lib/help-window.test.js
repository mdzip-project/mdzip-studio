import { describe, expect, it } from 'vitest';
import { helpStartupAction, shouldCloseLeftoverHelp } from './help-window';

describe('helpStartupAction', () => {
  it('opens Studio’s help at a page and section', () => {
    expect(helpStartupAction({ doc: 'studio-help', page: 'system-integration.md', anchor: 'explorer-previews' }))
      .toEqual({ kind: 'help', doc: 'studio-help', page: 'system-integration.md', anchor: 'explorer-previews' });
    expect(helpStartupAction({ doc: 'studio-help' }))
      .toEqual({ kind: 'help', doc: 'studio-help', page: null, anchor: null });
    expect(helpStartupAction({ doc: 'changelog', anchor: null }))
      .toEqual({ kind: 'help', doc: 'changelog', page: null, anchor: null });
  });

  it('refuses anything else, and drops a page or anchor that is not a plain name', () => {
    expect(helpStartupAction({ doc: '../../secret' })).toBeNull();
    expect(helpStartupAction(null)).toBeNull();
    const action = helpStartupAction({ doc: 'studio-help', page: '../outside.md', anchor: 'x" onload="' });
    expect(action.page).toBeNull();
    expect(action.anchor).toBeNull();
    expect(helpStartupAction({ doc: 'studio-help', page: 'images/x.png', anchor: 42 })).toMatchObject({ page: null, anchor: null });
  });
});

describe('shouldCloseLeftoverHelp', () => {
  it('closes help windows left after the last Studio window closes', () => {
    expect(shouldCloseLeftoverHelp([{ help: true }, { help: true }], 'win32')).toBe(true);
    expect(shouldCloseLeftoverHelp([{ help: true }], 'linux')).toBe(true);
  });

  it('leaves them while a Studio window is open, and on macOS', () => {
    expect(shouldCloseLeftoverHelp([{ help: true }, { help: false }], 'win32')).toBe(false);
    expect(shouldCloseLeftoverHelp([], 'win32')).toBe(false);
    expect(shouldCloseLeftoverHelp([{ help: true }], 'darwin')).toBe(false);
  });
});
