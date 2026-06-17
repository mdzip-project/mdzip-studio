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

  removeRecentFile(path: string): void {
    const recent = this.getRecentFiles().filter((f) => f !== path);
    this.setItem('recentFiles', recent);
    const titles = this.getRecentTitles();
    if (path in titles) {
      delete titles[path];
      this.setItem('recentTitles', titles);
    }
  }

  clearRecentFiles(): void {
    this.removeItem('recentFiles');
    this.removeItem('recentTitles');
  }

  // Cache of recent-file path → display title (e.g. an .mdz manifest title), so
  // the welcome list can show a friendly name instead of the bare file name.
  getRecentTitles(): Record<string, string> {
    return this.getItem<Record<string, string>>('recentTitles', {}) ?? {};
  }

  setRecentTitle(path: string, title: string): void {
    const titles = this.getRecentTitles();
    titles[path] = title;
    // Drop titles whose path has aged out of the (capped) recents list.
    const recent = new Set(this.getRecentFiles());
    for (const key of Object.keys(titles)) {
      if (!recent.has(key)) delete titles[key];
    }
    this.setItem('recentTitles', titles);
  }

  getTheme(): 'light' | 'dark' {
    return this.getItem<'light' | 'dark'>('theme', 'light') ?? 'light';
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.setItem('theme', theme);
  }
}
