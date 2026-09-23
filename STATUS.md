Status: ready-to-commit
Last: Fixed the real per-keystroke flash — missing overflow:hidden on html/body let the outer document scroll

Kyle reported every keystroke causing a visible flash — toolbar
disappearing/reappearing, scrollbar briefly jumping to the title bar —
after hooking Studio up to the local `@mdzip/editor` dev symlink to test
its editor/preview scroll-jump fix (see `../mdzip-editor/STATUS.md`). This
took an extended live-debugging session across both repos to pin down;
three real bugs surfaced and were fixed in `@mdzip/editor` along the way
(see its STATUS.md) but none of them were the actual cause of what Kyle
was seeing — each made the underlying chunk-rendering pipeline more
correct, but the flash persisted after every one of them.

The actual root cause: Studio's global `html, body` had `height: 100%` but
no `overflow: hidden`. `.app-shell` is a fixed `100vh` with `overflow:
hidden` all the way down its own layout tree, so the document should never
need to scroll — but without that constraint, any transient internal
content overflow (even for a single frame, from any of the DOM churn the
`@mdzip/editor` fixes were addressing) made the browser show a native
document scrollbar, narrowing and reflowing the *entire app* for that
instant. Found via frame-by-frame analysis of a screen recording Kyle
provided: a measurable width-reflow (a table row in the editor pane
wrapping to a second line, then back) at the exact moment Kyle reported
seeing the flash, with the outer page's own scrollbar the only remaining
explanation once every internal-pane mechanism had been fixed and
independently verified.

Fixed with `overflow: hidden` on `html, body` (`styles.scss`) and on
`:host` (`app.component.scss`, belt-and-suspenders alongside the same
`.app-shell` invariant). Also removed `[progressiveTextRendering]="true"`
from the live editor's `<mdzip-workspace>` binding, added earlier under a
mistaken diagnosis — eager mounting (the default) is simpler and doesn't
carry the same lazy-tail complexity, with no observed downside for
Studio's typical document sizes.

Verified: Kyle confirmed live in Studio the flash is gone. Full suite (84
`ng test` + 41 `vitest` electron) green throughout.

<!-- Status: idle | in-progress | awaiting-test | ready-to-commit | blocked -->
