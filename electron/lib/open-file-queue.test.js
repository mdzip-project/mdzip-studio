const path = require('path');
const { createOpenFileQueue } = require('./open-file-queue');

describe('createOpenFileQueue', () => {
  it('holds paths until drained, in order', () => {
    const queue = createOpenFileQueue();
    const open = vi.fn();
    queue.push('/Users/me/a.mdz');
    queue.push('/Users/me/b.md');
    expect(queue.pendingCount()).toBe(2);
    expect(open).not.toHaveBeenCalled();

    queue.drain(open);
    expect(open.mock.calls.map((c) => c[0])).toEqual([
      path.resolve('/Users/me/a.mdz'),
      path.resolve('/Users/me/b.md'),
    ]);
    expect(queue.pendingCount()).toBe(0);
  });

  it('sends pushes straight to the handler once drained', () => {
    const queue = createOpenFileQueue();
    const open = vi.fn();
    queue.drain(open);
    queue.push('/Users/me/late.MDZ');
    expect(open).toHaveBeenCalledWith(path.resolve('/Users/me/late.MDZ'));
    expect(queue.pendingCount()).toBe(0);
  });

  it('ignores anything that is not .md or .mdz', () => {
    const queue = createOpenFileQueue();
    const open = vi.fn();
    expect(queue.push('/Users/me/notes.txt')).toBe(false);
    expect(queue.push(undefined)).toBe(false);
    expect(queue.push('/Users/me/ok.md')).toBe(true);
    queue.drain(open);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not replay paths when drained twice', () => {
    const queue = createOpenFileQueue();
    queue.push('/Users/me/a.md');
    const first = vi.fn();
    const second = vi.fn();
    queue.drain(first);
    queue.drain(second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
