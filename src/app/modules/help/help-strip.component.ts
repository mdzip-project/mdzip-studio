// The blue strip across the top of a help window, in place of the menu and
// toolbar: the open book, the page's title (for Studio's help, a contents
// dropdown of every page and its sections), and on the right either where the
// link under the pointer goes or the version note and the page online.
import { Component, input, output, signal } from '@angular/core';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import { lucideBookOpen, lucideChevronDown } from '@ng-icons/lucide';
import { HelpContentsPage } from './help-contents';
import { HelpStrip } from './help-window';

@Component({
  selector: 'app-help-strip',
  standalone: true,
  imports: [NgIconComponent],
  providers: [provideIcons({ lucideBookOpen, lucideChevronDown })],
  templateUrl: './help-strip.component.html',
  styleUrl: './help-strip.component.scss',
})
export class HelpStripComponent {
  readonly strip = input.required<HelpStrip>();
  // Empty for a one-page document: the title is plain text, no dropdown.
  readonly contents = input<HelpContentsPage[]>([]);
  readonly currentPage = input<string | null>(null);
  readonly filesShown = input(false);

  // A page (anchor null) or one of its sections.
  readonly pageSelected = output<{ file: string; anchor: string | null }>();
  readonly filesToggled = output<void>();

  readonly contentsOpen = signal(false);

  select(file: string, anchor: string | null): void {
    this.contentsOpen.set(false);
    this.pageSelected.emit({ file, anchor });
  }

  toggleFiles(): void {
    this.contentsOpen.set(false);
    this.filesToggled.emit();
  }
}
