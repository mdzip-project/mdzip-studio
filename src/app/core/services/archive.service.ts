import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

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
  private currentArchive$ = new BehaviorSubject<MDZipArchive | null>(null);
  private recentFiles$ = new BehaviorSubject<string[]>([]);

  get currentArchive(): Observable<MDZipArchive | null> {
    return this.currentArchive$.asObservable();
  }

  get recentFiles(): Observable<string[]> {
    return this.recentFiles$.asObservable();
  }

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

    this.currentArchive$.next(archive);
    return archive;
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
    const archive = this.currentArchive$.value;
    if (!archive) {
      return Promise.reject(new Error('No archive open'));
    }
    // TODO: Implement archive saving
    return Promise.resolve();
  }

  saveAsArchive(path: string): Promise<void> {
    // TODO: Implement save as functionality
    return Promise.resolve();
  }

  addDocument(document: Document): void {
    const archive = this.currentArchive$.value;
    if (!archive) return;

    archive.documents.push(document);
    this.currentArchive$.next(archive);
  }

  updateDocument(id: string, content: string): void {
    const archive = this.currentArchive$.value;
    if (!archive) return;

    const doc = archive.documents.find((d) => d.id === id);
    if (doc) {
      doc.content = content;
      doc.modified = new Date();
      this.currentArchive$.next(archive);
    }
  }

  removeDocument(id: string): void {
    const archive = this.currentArchive$.value;
    if (!archive) return;

    archive.documents = archive.documents.filter((d) => d.id !== id);
    this.currentArchive$.next(archive);
  }

  addAsset(asset: Asset): void {
    const archive = this.currentArchive$.value;
    if (!archive) return;

    archive.assets.push(asset);
    this.currentArchive$.next(archive);
  }

  removeAsset(id: string): void {
    const archive = this.currentArchive$.value;
    if (!archive) return;

    archive.assets = archive.assets.filter((a) => a.id !== id);
    this.currentArchive$.next(archive);
  }

  updateManifest(manifest: Partial<Manifest>): void {
    const archive = this.currentArchive$.value;
    if (!archive) return;

    archive.manifest = { ...archive.manifest, ...manifest };
    this.currentArchive$.next(archive);
  }

  closeArchive(): void {
    this.currentArchive$.next(null);
  }

  addToRecentFiles(path: string): void {
    const recent = this.recentFiles$.value;
    const filtered = recent.filter((f) => f !== path);
    this.recentFiles$.next([path, ...filtered].slice(0, 10));
  }
}
