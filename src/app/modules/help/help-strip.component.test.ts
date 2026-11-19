import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HelpStripComponent } from './help-strip.component';

describe('HelpStripComponent', () => {
  let strip: HelpStripComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    runInInjectionContext(TestBed.inject(Injector), () => {
      strip = new HelpStripComponent();
    });
  });

  it('closes the contents when a page or section is chosen, and says which', () => {
    const chosen: { file: string; anchor: string | null }[] = [];
    strip.pageSelected.subscribe((page) => chosen.push(page));

    strip.contentsOpen.set(true);
    strip.select('system-integration.md', 'outlook-attachments');
    expect(strip.contentsOpen()).toBe(false);
    strip.select('index.md', null);
    expect(chosen).toEqual([
      { file: 'system-integration.md', anchor: 'outlook-attachments' },
      { file: 'index.md', anchor: null },
    ]);
  });

  it('closes the contents when the files are shown or hidden', () => {
    let toggled = 0;
    strip.filesToggled.subscribe(() => toggled++);
    strip.contentsOpen.set(true);
    strip.toggleFiles();
    expect(strip.contentsOpen()).toBe(false);
    expect(toggled).toBe(1);
  });
});
