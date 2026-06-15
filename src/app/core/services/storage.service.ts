import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private prefix = 'mdzip-studio:';

  setItem(key: string, value: unknown): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      console.error(`Failed to save ${key}:`, e);
    }
  }

  getItem<T>(key: string, defaultValue?: T): T | null {
    try {
      const value = localStorage.getItem(this.prefix + key);
      return value ? (JSON.parse(value) as T) : defaultValue ?? null;
    } catch (e) {
      console.error(`Failed to retrieve ${key}:`, e);
      return defaultValue ?? null;
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch (e) {
      console.error(`Failed to remove ${key}:`, e);
    }
  }

  clear(): void {
    try {
      const keysToRemove: string[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(this.prefix)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (e) {
      console.error('Failed to clear storage:', e);
    }
  }

  getRecentFiles(): string[] {
    return this.getItem<string[]>('recentFiles', []) ?? [];
  }

  addRecentFile(path: string): void {
    const recent = this.getRecentFiles();
    const filtered = recent.filter((f) => f !== path);
    this.setItem('recentFiles', [path, ...filtered].slice(0, 10));
  }

  clearRecentFiles(): void {
    this.removeItem('recentFiles');
  }

  getTheme(): 'light' | 'dark' {
    return this.getItem<'light' | 'dark'>('theme', 'light') ?? 'light';
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.setItem('theme', theme);
  }
}
