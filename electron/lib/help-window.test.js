import { describe, expect, it } from 'vitest';
import { helpStartupAction } from './help-window';

describe('helpStartupAction', () => {
  it('opens one of Studio’s help documents at a section', () => {
    expect(helpStartupAction({ doc: 'system-integration', anchor: 'explorer-previews' }))
      .toEqual({ kind: 'help', doc: 'system-integration', anchor: 'explorer-previews' });
    expect(helpStartupAction({ doc: 'changelog', anchor: null }))
      .toEqual({ kind: 'help', doc: 'changelog', anchor: null });
  });

  it('refuses anything else, and drops an anchor that is not a heading id', () => {
    expect(helpStartupAction({ doc: '../../secret' })).toBeNull();
    expect(helpStartupAction(null)).toBeNull();
    expect(helpStartupAction({ doc: 'known-issues', anchor: 'x" onload="' }).anchor).toBeNull();
    expect(helpStartupAction({ doc: 'known-issues', anchor: 42 }).anchor).toBeNull();
  });
});
