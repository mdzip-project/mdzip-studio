import { Injectable, computed, signal } from '@angular/core';

export interface MDZipArchive {
  name: string;
  path?: string;
  mode: 'document' | 'project';
  documents: Document[];
  assets: Asset[];
  manifest: Manifest;
}

export interface Document {
  id: string;
  name: string;
  content: string;
  modified: Date;
}

export interface Asset {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
}

export interface Manifest {
  version: string;
  mode: 'document' | 'project';
  entryPoint: string;
  metadata?: Record<string, unknown>;
}

@Injectable({
  providedIn: 'root',
})
export class ArchiveService {
  readonly currentArchive = signal<MDZipArchive | null>(null);
  readonly recentFiles = signal<string[]>([]);
  readonly documents = computed(() => this.currentArchive()?.documents ?? []);
  readonly assets = computed(() => this.currentArchive()?.assets ?? []);

  createNewArchive(name: string, mode: 'document' | 'project'): MDZipArchive {
    const archive: MDZipArchive = {
      name,
      mode,
      documents: [],
      assets: [],
      manifest: {
        version: '1.0.0',
        mode,
        entryPoint: 'index.md',
      },
    };

    this.currentArchive.set(archive);
    return archive;
  }

  loadArchive(archive: MDZipArchive): void {
    this.currentArchive.set(archive);
  }

  openArchive(path: string): Promise<MDZipArchive> {
    // TODO: Implement archive loading from file system
    return Promise.resolve({
      name: 'Archive',
      path,
      mode: 'document',
      documents: [],
      assets: [],
      manifest: {
        version: '1.0.0',
        mode: 'document',
        entryPoint: 'index.md',
      },
    });
  }

  saveArchive(): Promise<void> {
    const archive = this.currentArchive();
    if (!archive) {
      return Promise.reject(new Error('No document open'));
    }
    // TODO: Implement archive saving
    return Promise.resolve();
  }

  saveAsArchive(path: string): Promise<void> {
    // TODO: Implement save as functionality
    return Promise.resolve();
  }

  addDocument(document: Document): void {
    const archive = this.currentArchive();
    if (!archive) return;

    this.currentArchive.update((current) =>
      current
        ? {
            ...current,
            documents: [...current.documents, document],
          }
        : current
    );
  }

  updateDocument(id: string, content: string): void {
    this.currentArchive.update((archive) =>
      archive
        ? {
            ...archive,
            documents: archive.documents.map((doc) =>
              doc.id === id ? { ...doc, content, modified: new Date() } : doc
            ),
          }
        : archive
    );
  }

  removeDocument(id: string): void {
    this.currentArchive.update((archive) =>
      archive
        ? {
            ...archive,
            documents: archive.documents.filter((document) => document.id !== id),
          }
        : archive
    );
  }

  addAsset(asset: Asset): void {
    this.currentArchive.update((archive) =>
      archive
        ? {
            ...archive,
            assets: [...archive.assets, asset],
          }
        : archive
    );
  }

  removeAsset(id: string): void {
    this.currentArchive.update((archive) =>
      archive
        ? {
            ...archive,
            assets: archive.assets.filter((asset) => asset.id !== id),
          }
        : archive
    );
  }

  updateManifest(manifest: Partial<Manifest>): void {
    this.currentArchive.update((archive) =>
      archive
        ? {
            ...archive,
            manifest: { ...archive.manifest, ...manifest },
          }
        : archive
    );
  }

  closeArchive(): void {
    this.currentArchive.set(null);
  }

  addToRecentFiles(path: string): void {
    const recent = this.recentFiles();
    const filtered = recent.filter((f) => f !== path);
    this.recentFiles.set([path, ...filtered].slice(0, 10));
  }
}
