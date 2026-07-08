import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrintService } from './print.service';

describe('PrintService', () => {
  let service: PrintService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PrintService);
  });

  function previewRoot(innerHtml: string): HTMLElement {
    const root = document.createElement('article');
    root.innerHTML = innerHtml;
    return root;
  }

  it('wraps the capture in a complete standalone document', async () => {
    const html = await service.buildPrintDocument(previewRoot('<h1>Hello</h1><p>World</p>'), 'My Doc');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>My Doc</title>');
    expect(html).toContain('<style>');
    expect(html).toContain('<h1>Hello</h1><p>World</p>');
    // Scripts must stay blocked in the temp file's file:// context.
    expect(html).toContain('Content-Security-Policy');
  });

  it('escapes the document title', async () => {
    const html = await service.buildPrintDocument(previewRoot('<p>x</p>'), '<b>"A&B"</b>');

    expect(html).toContain('<title>&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;</title>');
    expect(html).not.toContain('<title><b>');
  });

  it('inlines blob: images via the resolver and leaves other sources alone', async () => {
    const resolver = vi.fn(async () => 'data:image/png;base64,AAAA');
    const html = await service.buildPrintDocument(
      previewRoot(
        '<img src="blob:http://localhost/abc">'
        + '<img src="data:image/gif;base64,BBBB">'
        + '<img src="https://example.com/pic.png">'
      ),
      'Doc',
      resolver
    );

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith('blob:http://localhost/abc');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('src="data:image/gif;base64,BBBB"');
    expect(html).toContain('src="https://example.com/pic.png"');
    expect(html).not.toContain('blob:');
  });

  it('drops the src of a blob image the resolver cannot read', async () => {
    const html = await service.buildPrintDocument(
      previewRoot('<img src="blob:http://localhost/gone" alt="missing">'),
      'Doc',
      async () => null
    );

    expect(html).not.toContain('blob:');
    expect(html).toContain('<img alt="missing">');
  });

  it('strips editor hydration artifacts but keeps the images', async () => {
    const html = await service.buildPrintDocument(
      previewRoot(
        '<span class="mdzip-image-slot mdzip-image-open mdzip-image-animation-off">'
        + '<img class="mdzip-image-loading" mdzip-studio-src="./a.png" src="data:image/png;base64,CCCC" width="10" height="20">'
        + '</span>'
      ),
      'Doc'
    );

    expect(html).not.toContain('mdzip-image-slot');
    expect(html).not.toContain('mdzip-image-loading');
    expect(html).not.toContain('mdzip-studio-src');
    expect(html).toContain('src="data:image/png;base64,CCCC"');
    expect(html).toContain('width="10"');
    expect(html).toContain('height="20"');
  });
});
