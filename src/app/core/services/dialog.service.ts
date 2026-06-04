import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface DialogConfig {
  title: string;
  type: 'manifest' | 'validation' | 'confirm' | 'prompt';
  data?: unknown;
  onConfirm?: (result: unknown) => void;
  onCancel?: () => void;
}

@Injectable({
  providedIn: 'root',
})
export class DialogService {
  private openDialogs$ = new BehaviorSubject<DialogConfig | null>(null);

  get openDialog(): Observable<DialogConfig | null> {
    return this.openDialogs$.asObservable();
  }

  openManifestDialog(manifest: unknown): void {
    this.openDialogs$.next({
      title: 'Edit Manifest',
      type: 'manifest',
      data: manifest,
    });
  }

  openValidationDialog(data: unknown): void {
    this.openDialogs$.next({
      title: 'Validation Results',
      type: 'validation',
      data,
    });
  }

  closeDialog(): void {
    this.openDialogs$.next(null);
  }

  confirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.openDialogs$.next({
        title: 'Confirm',
        type: 'confirm',
        data: message,
        onConfirm: () => {
          resolve(true);
          this.closeDialog();
        },
        onCancel: () => {
          resolve(false);
          this.closeDialog();
        },
      });
    });
  }
}
