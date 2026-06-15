import { Injectable, signal } from '@angular/core';

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
  readonly openDialog = signal<DialogConfig | null>(null);

  openManifestDialog(manifest: unknown): void {
    this.openDialog.set({
      title: 'Edit Manifest',
      type: 'manifest',
      data: manifest,
    });
  }

  openValidationDialog(data: unknown): void {
    this.openDialog.set({
      title: 'Validation Results',
      type: 'validation',
      data,
    });
  }

  closeDialog(): void {
    this.openDialog.set(null);
  }

  confirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.openDialog.set({
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
