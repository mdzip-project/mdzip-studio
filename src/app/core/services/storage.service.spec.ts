import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StorageService);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('item storage', () => {
    it('should save and retrieve items', () => {
      service.setItem('testKey', { data: 'value' });
      const result = service.getItem<{ data: string }>('testKey');
      expect(result).toEqual({ data: 'value' });
    });

    it('should return default value if key not found', () => {
      const result = service.getItem('nonexistent', { default: true });
      expect(result).toEqual({ default: true });
    });

    it('should remove items', () => {
      service.setItem('testKey', 'value');
      service.removeItem('testKey');
      const result = service.getItem('testKey');
      expect(result).toBeNull();
    });

    it('should clear all items', () => {
      service.setItem('key1', 'value1');
      service.setItem('key2', 'value2');
      service.clear();

      expect(service.getItem('key1')).toBeNull();
      expect(service.getItem('key2')).toBeNull();
    });
  });

  describe('recent files', () => {
    it('should add recent files', () => {
      service.addRecentFile('/path/to/file1.mdz');
      service.addRecentFile('/path/to/file2.mdz');

      const recent = service.getRecentFiles();
      expect(recent[0]).toBe('/path/to/file2.mdz');
      expect(recent[1]).toBe('/path/to/file1.mdz');
    });

    it('should limit recent files to 10', () => {
      for (let i = 0; i < 15; i++) {
        service.addRecentFile(`/path/file${i}.mdz`);
      }

      const recent = service.getRecentFiles();
      expect(recent.length).toBe(10);
    });

    it('should move file to front when re-added', () => {
      service.addRecentFile('/path/file1.mdz');
      service.addRecentFile('/path/file2.mdz');
      service.addRecentFile('/path/file1.mdz');

      const recent = service.getRecentFiles();
      expect(recent[0]).toBe('/path/file1.mdz');
      expect(recent[1]).toBe('/path/file2.mdz');
    });

    it('should clear recent files', () => {
      service.addRecentFile('/path/file.mdz');
      service.clearRecentFiles();
      expect(service.getRecentFiles()).toEqual([]);
    });
  });

  describe('theme', () => {
    it('should get default theme', () => {
      const theme = service.getTheme();
      expect(theme).toBe('light');
    });

    it('should save and retrieve theme', () => {
      service.setTheme('dark');
      const theme = service.getTheme();
      expect(theme).toBe('dark');
    });
  });
});
