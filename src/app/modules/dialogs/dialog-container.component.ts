import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService, DialogConfig } from '../../core/services/dialog.service';
import { ArchiveService, Manifest } from '../../core/services/archive.service';
import { ValidationService, ValidationResult } from '../../core/services/validation.service';
import { ManifestEditorComponent } from '../manifest/manifest-editor.component';
import { ValidationResultComponent } from '../validation/validation-result.component';

@Component({
  selector: 'app-dialog-container',
  standalone: true,
  imports: [
    CommonModule,
    ManifestEditorComponent,
    ValidationResultComponent,
  ],
  template: `
    <div class="dialog-overlay" *ngIf="currentDialog" (click)="closeDialog()">
      <div class="dialog-content" (click)="$event.stopPropagation()">
        <!-- Manifest Editor Dialog -->
        <app-manifest-editor
          *ngIf="currentDialog.type === 'manifest'"
          [manifest]="currentDialog.data as Manifest"
          (saved)="onManifestSaved($event)"
          (closed)="closeDialog()"
        ></app-manifest-editor>

        <!-- Validation Results Dialog -->
        <app-validation-result
          *ngIf="currentDialog.type === 'validation'"
          [valid]="(currentDialog.data as ValidationResult).valid"
          [errors]="(currentDialog.data as ValidationResult).errors"
          (closed)="closeDialog()"
        ></app-validation-result>
      </div>
    </div>
  `,
  styles: [`
    .dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.2s ease-in-out;
    }

    .dialog-content {
      max-width: 90vw;
      max-height: 90vh;
      animation: slideIn 0.2s ease-in-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes slideIn {
      from {
        transform: translateY(-20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
  `],
})
export class DialogContainerComponent implements OnInit {
  currentDialog: DialogConfig | null = null;

  constructor(
    private dialogService: DialogService,
    private archiveService: ArchiveService,
    private validationService: ValidationService
  ) {}

  ngOnInit() {
    this.dialogService.openDialog.subscribe((dialog) => {
      this.currentDialog = dialog;
    });
  }

  closeDialog() {
    this.dialogService.closeDialog();
  }

  onManifestSaved(manifest: Manifest) {
    this.archiveService.updateManifest(manifest);
    this.closeDialog();
  }
}
