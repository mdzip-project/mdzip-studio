import { describe, expect, it } from 'vitest';
import { helpStartupAction } from './help-window';

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
