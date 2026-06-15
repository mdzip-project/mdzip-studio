import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ValidationService } from './validation.service';
import { MDZipArchive } from './archive.service';

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ValidationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('validateManifest', () => {
    it('should pass valid manifest', () => {
      const manifest = {
        version: '1.0.0',
        mode: 'document' as const,
        entryPoint: 'index.md',
      };

      const result = service.validateManifest(manifest);
      expect(result).toEqual([]);
    });

    it('should fail manifest without version', () => {
      const manifest = {
        version: '',
        mode: 'document' as const,
        entryPoint: 'index.md',
      };

      const result = service.validateManifest(manifest);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toContain('version');
    });

    it('should fail manifest with invalid mode', () => {
      const manifest = {
        version: '1.0.0',
        mode: 'invalid' as any,
        entryPoint: 'index.md',
      };

      const result = service.validateManifest(manifest);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toContain('mode');
    });

    it('should fail manifest without entry point', () => {
      const manifest = {
        version: '1.0.0',
        mode: 'document' as const,
        entryPoint: '',
      };

      const result = service.validateManifest(manifest);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].message).toContain('entry point');
    });
  });

  describe('validateArchive', () => {
    it('should validate valid archive', () => {
      const archive: MDZipArchive = {
        name: 'Test',
        mode: 'document',
        documents: [
          {
            id: '1',
            name: 'index.md',
            content: '# Test',
            modified: new Date(),
          },
        ],
        assets: [],
        manifest: {
          version: '1.0.0',
          mode: 'document',
          entryPoint: 'index.md',
        },
      };

      const result = service.validateArchive(archive);
      expect(result.valid).toBe(true);
    });

    it('should fail if entry point missing', () => {
      const archive: MDZipArchive = {
        name: 'Test',
        mode: 'document',
        documents: [
          {
            id: '1',
            name: 'other.md',
            content: '# Test',
            modified: new Date(),
          },
        ],
        assets: [],
        manifest: {
          version: '1.0.0',
          mode: 'document',
          entryPoint: 'index.md',
        },
      };

      const result = service.validateArchive(archive);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Entry point'))).toBe(
        true
      );
    });

    it('should detect duplicate document names', () => {
      const archive: MDZipArchive = {
        name: 'Test',
        mode: 'document',
        documents: [
          {
            id: '1',
            name: 'index.md',
            content: '# Test',
            modified: new Date(),
          },
          {
            id: '2',
            name: 'index.md',
            content: '# Duplicate',
            modified: new Date(),
          },
        ],
        assets: [],
        manifest: {
          version: '1.0.0',
          mode: 'document',
          entryPoint: 'index.md',
        },
      };

      const result = service.validateArchive(archive);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Duplicate'))).toBe(
        true
      );
    });
  });

  describe('validateMarkdown', () => {
    it('should validate non-empty markdown', () => {
      const result = service.validateMarkdown('# Heading');
      expect(result.filter((e) => e.type === 'error')).toEqual([]);
    });

    it('should warn on empty markdown', () => {
      const result = service.validateMarkdown('');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('warning');
    });
  });
});
