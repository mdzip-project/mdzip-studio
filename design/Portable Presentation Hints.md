# Markdown Hints and Portable Presentation

## Status

Future consideration. This document records a design direction, not an implementation commitment.

## Problem

MDZip Studio wants documents to be useful in two worlds:

- Regular Markdown editors and renderers, where portability matters most.
- MDZip-aware tools, where the archive can provide richer editing and presentation behavior.

Some common authoring needs sit between those worlds. Image resizing, image alignment, captions, side-by-side images, and layout clearing are easy in HTML or app-specific renderers, but they are not portable Markdown features. Raw HTML such as `<img width="200" align="right">` and `<br>` works in some Markdown renderers and is escaped or ignored in others.

The result is tension:

- Pure Markdown is portable but has reduced layout fidelity.
- Raw HTML can express layout but is not reliably portable.
- Renderer-specific Markdown extensions improve one app while degrading others.

## Design Direction

Treat presentation hints as a possible standalone Markdown convention, not as an MDZip-only feature.

Call the standalone idea **Markdown Hints** for now. MDZip Studio can be an early implementation and testbed, and MDZip archives can be a natural carrier for documents that use hints, but the hint syntax should also work in ordinary `.md` files.

The Markdown fallback should remain readable, complete, and useful without any hint-aware interpretation. Hint-aware tools may enhance that fallback using invisible, declarative metadata.

In short:

> Markdown carries the content. Markdown Hints may carry optional presentation intent. MDZip may package both with assets.

## Guiding Principle

If the plain `.md` fallback is still pleasant and complete after all hints are ignored or removed, the enhancement is allowed. If the fallback becomes confusing, misleading, or incomplete, the enhancement is out of scope.

This prevents MDZip from becoming a proprietary page layout format hidden inside a Markdown container.

## Intended Fallback Model

Markdown should keep using ordinary portable constructs:

```md
## Countertop

![Pasted image](images/countertop.png)

- QZR-150 Pure White from Granite Outlet
- Approx 52" x 22"
- Cut round hole for sink. Finish left side.
```

A hint-aware renderer could use an invisible comment before the image to display it at a preferred width, aligned to the right, or grouped with a caption:

```md
<!-- mdhint {"version":1,"type":"image","layout":{"width":200,"align":"right"}} -->
![Pasted image](images/countertop.png)
```

A regular Markdown renderer would ignore the comment and still show the image in a normal Markdown flow.

## Good Candidates

These are likely reasonable as optional Markdown Hints:

- Image display width or max width.
- Image alignment.
- Captions attached to images.
- Simple gallery or side-by-side image grouping.
- A "clear before this block" hint to avoid floated image overlap.
- Preferred preview density for embedded media.

These features improve presentation while leaving the Markdown fallback understandable.

## Poor Candidates

These are likely outside the desired boundary:

- Absolute positioning.
- Arbitrary page layout grids.
- Per-paragraph font, color, spacing, or styling controls.
- Renderer-specific behavior that changes document meaning.
- Hidden content that appears only in MDZip-aware tools.
- Any feature where the Markdown fallback becomes a placeholder for proprietary layout.

These would push MDZip toward a desktop publishing or word processor format, which is not the goal.

## Role of Raw HTML

If Markdown Hints cover common layout needs, raw HTML should become an escape hatch rather than the normal authoring path.

Studio may preserve and render safe inline HTML, but Studio-authored layout should prefer Markdown plus Markdown Hints.

HTML can still be useful for:

- Semantic inline elements Markdown does not express, such as `<sup>`, `<sub>`, `<kbd>`, `<abbr>`, or `<mark>`.
- Existing Markdown documents that already contain raw HTML.
- One-off advanced content where reduced portability is acceptable and intentional.
- Import/export interop with renderers that use HTML conventions.
- Prototyping possible future MDZip features before they deserve first-class metadata.
- Cases where HTML is the content itself, not merely presentation.

HTML should not be Studio's default mechanism for:

- Image sizing.
- Image alignment.
- Vertical spacing.
- Layout clearing.
- Captions.
- Galleries or side-by-side image layout.
- Common toolbar formatting controls.

## Storage Options

Several storage approaches are possible and need separate design:

- Structured HTML comments near Markdown elements.
- Manifest-level presentation map keyed by block identity.
- Sidecar metadata file in the archive.
- Extended image attributes in Markdown, if a portable-enough convention emerges.

The preferred first design is structured comments, because they work in plain Markdown files, stay near the affected content, and are ignored by legacy renderers:

```md
<!-- mdhint {"version":1,"type":"image","layout":{"width":200,"align":"right"}} -->
![Pasted image](images/countertop.png)
```

Archive metadata and sidecar files may still be useful for document-wide defaults, shared styles, or large hint sets that should not clutter the Markdown source.

The comment payload should be structured data, not hidden HTML, CSS, or executable code.

## Identity Problem

Presentation hints need stable targets. A hint such as "make this image 200px wide and right-aligned" must survive ordinary editing.

Path-only targeting is simple:

```text
images/countertop.png -> width 200, align right
```

But it breaks down when the same image appears more than once with different layouts. Block-level targeting is more precise, but requires a stable way to identify Markdown elements without making the source unpleasant.

This should be solved before adding broad presentation metadata.

Inline comment hints largely solve the repeated-image case because the hint applies to the next compatible Markdown block, not to every use of an asset path:

```md
<!-- mdhint {"version":1,"type":"image","layout":{"width":160,"align":"right"}} -->
![Before](images/photo.png)

Some notes.

<!-- mdhint {"version":1,"type":"image","layout":{"width":"100%","align":"center"}} -->
![Before detail](images/photo.png)
```

Both image blocks can point to the same asset while carrying different presentation intent.

If archive-level metadata is used later, it should target stable block IDs rather than asset paths.

## Editing UX

Studio should avoid making the user think they are writing fully portable Markdown when they are relying on hint-aware behavior.

Possible UX cues:

- Label controls as "presentation hints" when they create non-Markdown behavior.
- Provide a "portable Markdown preview" mode that ignores Markdown Hints.
- Warn when exporting to plain Markdown that presentation hints will be reduced or omitted.
- Prefer transformations that keep the Markdown fallback useful, such as creating resized image files when the user wants maximum portability.

## Export Behavior

When unpacking or exporting to plain Markdown, Studio should preserve the clean Markdown content and assets. Presentation hints may be:

- Preserved as comments.
- Removed when the user asks for strict portable Markdown.
- Converted to best-effort raw HTML only when the user asks for a target that supports it.
- Applied physically, such as generating resized image variants.

The default should favor portability over fidelity.

## Possible Syntax Rules

If this becomes a standalone effort, a small v1 syntax could be:

```md
<!-- mdhint {"version":1,"type":"image","layout":{"width":200,"align":"right"}} -->
![Countertop](images/countertop.png)
```

Proposed rules:

- The marker is `mdhint`, not `mdz`, so the convention is not tied to MDZip.
- The payload is JSON.
- The comment applies to the next compatible Markdown block.
- Unknown fields must be ignored.
- Invalid JSON must be ignored.
- If the next block is not compatible with `type`, the hint is ignored.
- Renderers must not execute code from hints.
- Hints must not be required to understand document content.
- Hints should be safe to preserve when copying or unpacking Markdown files.

## Open Questions

- Should Markdown Hints become a standalone spec, with MDZip as one packaging host?
- What organization or repository should own the standalone effort?
- How should hints target repeated uses of the same asset?
- Should Studio support generated image variants for portable resizing?
- Should tables be the recommended fallback for side-by-side image layouts?
- Should "clear before heading" be modeled as a hint, a renderer style rule, or avoided entirely?
- How should validation report unknown or unsupported presentation hints?

## Recommendation

Keep this idea, but implement it conservatively.

Start with image presentation hints only, because image sizing and alignment are the clearest portability pain. Require that every enhanced image still exists as a normal Markdown image reference. Add a portable-preview mode before expanding the hint system beyond images.

Treat the hint syntax as a possible separate Markdown Hints project from the beginning. MDZip Studio can prove the value, but the convention should not require `.mdz`.
