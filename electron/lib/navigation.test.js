import { describe, expect, it } from 'vitest';
import { navigationAction } from './navigation';

const page = 'file:///F:/Program%20Files/MDZip%20Studio/resources/app.asar/dist/mdzip-studio/index.html';

describe('navigationAction', () => {
  it("keeps Studio's own page, ignoring the #anchor", () => {
    expect(navigationAction(page, page)).toBe('stay');
    expect(navigationAction(`${page}#top`, page)).toBe('stay');
    expect(navigationAction('http://localhost:4300/', 'http://localhost:4300/')).toBe('stay');
  });

  it('opens web and mail links outside Studio', () => {
    expect(navigationAction('https://mdzip.org/studio', page)).toBe('external');
    expect(navigationAction('http://example.com', page)).toBe('external');
    expect(navigationAction('mailto:someone@example.com', page)).toBe('external');
  });

  it("drops a document's relative link, resolved against Studio's page", () => {
    expect(navigationAction('file:///F:/Program%20Files/MDZip%20Studio/resources/app.asar/dist/mdzip-studio/maps/places.png', page)).toBe('drop');
    expect(navigationAction('http://localhost:4300/maps/places.png', 'http://localhost:4300/')).toBe('drop');
  });

  it('never hands a file: link or another scheme to the system', () => {
    expect(navigationAction('file:///C:/Windows/System32/calc.exe', page)).toBe('drop');
    expect(navigationAction('javascript:alert(1)', page)).toBe('drop');
    expect(navigationAction('ms-settings:defaultapps', page)).toBe('drop');
    expect(navigationAction('not a url', page)).toBe('drop');
  });
});
