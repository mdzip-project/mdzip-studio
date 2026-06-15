# Host-Resolved Image Insertion for Plain Markdown

Filed as [mdzip-project/mdzip-editor#2](https://github.com/mdzip-project/mdzip-editor/issues/2)
on 2026-06-13.

Proposed for: `@mdzip/editor` and framework wrappers  
Requested by: MDZip Studio  
Reviewed against: `@mdzip/editor@1.3.2`, `@mdzip/editor-ng@1.3.2`  
Date: 2026-06-13

## Summary

The `onConversionRequested` hook lets a host intercept image paste, drop, and
Insert Image actions on a plain `.md` file. It does not currently provide a
supported way for the host to finish the operation by inserting an external
Markdown image reference at the selection that triggered the action.

MDZip Studio needs to offer three choices:

1. Copy the image beside the `.md` file and insert a relative link.
2. Copy the image into a named subfolder and insert a relative link.
3. Convert the document to `.mdz` and embed the image.

The host owns filesystem placement for the first two choices. The editor should
own selection-aware text insertion and the existing MDZip embedding behavior.

## Current Capability

The conversion hook receives:

```ts
export type MdzipConversionAction =
  | { kind: 'navigation' }
  | { kind: 'image-picker' }
  | { kind: 'image-file'; file: File };
```

Returning `true` suppresses the built-in conversion dialog. The host can then
write an image file through native filesystem APIs, but it cannot insert the
resulting Markdown text through a public editor API.

Using private CodeMirror state or querying editor DOM is not an acceptable host
integration boundary.

## Temporary Studio Workaround

Studio currently resolves the gap without modifying the MDZip libraries by:

- locating the embedded CodeMirror `EditorView` through its rendered DOM;
- capturing the active document selection before opening the destination dialog;
- writing linked images through Studio's Electron IPC layer;
- dispatching the Markdown replacement directly through CodeMirror; and
- calling the wrapper's existing conversion and command APIs for `.mdz`.

This works, but it makes Studio depend on the editor's current DOM structure and
CodeMirror implementation. Those are implementation details rather than a
stable MDZip integration contract. The direct `@codemirror/view` dependency can
be removed once the requested context API is available.

## Requested API

Provide a selection-aware operation context with image conversion actions:

```ts
export interface MdzipConversionContext {
  /**
   * Replaces the Markdown selection captured when the conversion action was
   * raised. Returns false if that document/selection is no longer valid.
   */
  insertMarkdown(text: string): boolean | Promise<boolean>;

  /**
   * Runs the existing conversion and image insertion behavior using the
   * captured action.
   */
  convertToMdz(): boolean | Promise<boolean>;
}

onConversionRequested?: (
  action: MdzipConversionAction,
  context: MdzipConversionContext
) => boolean | Promise<boolean>;
```

Equivalent APIs are acceptable, such as a stable action token plus
`resolveConversion(token, resolution)`, provided they preserve the triggering
selection and do not expose editor implementation details.

An imperative general-purpose method such as
`replaceSelection(text, selectionToken?)` could also be useful, but the
conversion context should remain the ergonomic path for this workflow.

The context-based shape is preferred because the editor can validate the
captured document and selection internally. It also keeps the host from needing
to coordinate conversion, editor focus, command timing, or private editor
instances.

## Required Behavior

- Image paste, image drop, and Insert Image produce the same host contract.
- The insertion target is captured before focus moves to the host dialog.
- `insertMarkdown()` replaces the original selection and restores editor focus.
- If the document changes, closes, or the selection token becomes stale, the
  operation returns `false` without editing another document.
- A canceled host dialog leaves the Markdown unchanged.
- `convertToMdz()` preserves the current built-in behavior:
  - `image-file` embeds that file after conversion.
  - `image-picker` opens the image picker after conversion.
- The capability is available through raw JavaScript and all maintained
  framework wrappers.
- Wrapper changes do not recreate the workspace view.

## Studio Flow

```ts
onConversionRequested(action, context) {
  const choice = await showImageDestinationDialog();

  if (choice.kind === 'same-folder' || choice.kind === 'subfolder') {
    const file = action.kind === 'image-file'
      ? action.file
      : await pickImage();
    const relativePath = await writeImageBesideMarkdown(file, choice);
    return context.insertMarkdown(
      `![${imageAlt(file.name)}](${encodeMarkdownPath(relativePath)})`
    );
  }

  if (choice.kind === 'mdz') {
    return context.convertToMdz();
  }

  return true; // handled by cancellation
}
```

## Acceptance Criteria

- Studio can implement all three choices without modifying `@mdzip/editor`.
- The relative image link is inserted at the selection active when the user
  pasted, dropped, or clicked Insert Image.
- Waiting in a host modal does not lose or redirect the insertion target.
- Existing consumers using the one-argument hook remain source compatible.
- The built-in conversion dialog remains the fallback when the hook returns
  `false`, throws, or is omitted.

## Studio Migration

When this API ships, Studio can retain its existing destination dialog and
filesystem IPC. The integration change should be limited to:

1. Store the supplied `MdzipConversionContext` with the pending image action.
2. Replace the direct CodeMirror dispatch with `context.insertMarkdown(...)`.
3. Replace the manual conversion/command sequence with
   `context.convertToMdz()`.
4. Remove DOM lookup, captured CodeMirror selection state, and the direct
   `@codemirror/view` dependency.

No user-facing workflow or Electron filesystem contract should need to change.
