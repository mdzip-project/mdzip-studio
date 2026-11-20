// The blue strip across the top of a reading window (Studio's help, or View >
// Reading View), in place of the menu and toolbar: the open book, the
// label and page (with several pages, a contents dropdown of every page and
// its sections, Show the files and Save a Copy), and on the right the help's
// version and its page online.
import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output, signal } from '@angular/core';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideBookOpen, lucideChevronDown } from '@ng-icons/lucide';
import { DocumentContentsPage } from './document-contents';
import { ReaderStrip } from './reader-window';

@Component({
  selector: 'app-reader-strip',
  standalone: true,
  imports: [NgIconComponent, NgTemplateOutlet],
  providers: [provideIcons({ lucideBookOpen, lucideChevronDown })],
  templateUrl: './reader-strip.component.html',
  styleUrl: './reader-strip.component.scss',
})
export class ReaderStripComponent {
  readonly strip = input.required<ReaderStrip>();
  // Empty for a document without sections: the title is plain text, no dropdown.
  readonly contents = input<DocumentContentsPage[]>([]);
  readonly currentPage = input<string | null>(null);
  readonly filesShown = input(false);
  // Desktop only: Save a Copy needs the save dialog.
  readonly canSaveCopy = input(false);

  // A page (anchor null) or one of its sections.
  readonly pageSelected = output<{ file: string; anchor: string | null }>();
  readonly filesToggled = output<void>();
  readonly saveCopyRequested = output<void>();

  readonly contentsOpen = signal(false);

  // A contents dropdown is worth having with several pages, or one with sections.
  hasContents(): boolean {
    const contents = this.contents();
    return contents.length > 1 || (contents.length === 1 && contents[0].sections.length > 0);
  }

  select(file: string, anchor: string | null): void {
    this.contentsOpen.set(false);
    this.pageSelected.emit({ file, anchor });
  }

  toggleFiles(): void {
    this.contentsOpen.set(false);
    this.filesToggled.emit();
  }

  saveCopy(): void {
    this.contentsOpen.set(false);
    this.saveCopyRequested.emit();
  }
}
