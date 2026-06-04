import { Injectable } from '@angular/core';
import { MDZipArchive, Manifest } from './archive.service';

export interface ValidationError {
  type: 'error' | 'warning';
  message: string;
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

@Injectable({
  providedIn: 'root',
})
export class ValidationService {
  validateArchive(archive: MDZipArchive): ValidationResult {
    const errors: ValidationError[] = [];

    // Validate manifest
    const manifestErrors = this.validateManifest(archive.manifest);
    errors.push(...manifestErrors);

    // Validate that entry point exists
    if (!archive.documents.some((d) => d.name === archive.manifest.entryPoint)) {
      errors.push({
        type: 'error',
        message: `Entry point "${archive.manifest.entryPoint}" not found in documents`,
      });
    }

    // Validate document names are unique
    const docNames = archive.documents.map((d) => d.name);
    const duplicates = docNames.filter((name, idx) => docNames.indexOf(name) !== idx);
    if (duplicates.length > 0) {
      errors.push({
        type: 'error',
        message: `Duplicate document names: ${duplicates.join(', ')}`,
      });
    }

    return {
      valid: errors.filter((e) => e.type === 'error').length === 0,
      errors,
    };
  }

  validateManifest(manifest: Manifest): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!manifest.version) {
      errors.push({
        type: 'error',
        message: 'Manifest must have a version',
      });
    }

    if (!manifest.mode || !['document', 'project'].includes(manifest.mode)) {
      errors.push({
        type: 'error',
        message: 'Manifest mode must be "document" or "project"',
      });
    }

    if (!manifest.entryPoint) {
      errors.push({
        type: 'error',
        message: 'Manifest must have an entry point',
      });
    }

    return errors;
  }

  validateMarkdown(content: string): ValidationError[] {
    const errors: ValidationError[] = [];

    // Basic markdown validation - check for common issues
    if (content.trim() === '') {
      errors.push({
        type: 'warning',
        message: 'Document is empty',
      });
    }

    return errors;
  }
}
