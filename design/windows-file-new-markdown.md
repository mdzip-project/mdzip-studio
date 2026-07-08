# How to Add a "New Markdown File" Option to the Windows Explorer Context Menu

Windows doesn't include a Markdown option in the "New" context menu by default because it targets a general consumer audience that primarily uses formats like `.docx` and `.txt`. Since Windows lacks a native Markdown renderer, there is no default app association out of the box. 

You can manually add this feature using a quick Registry tweak.

---

## Registry Tweak Instructions

1. Open **Notepad**.
2. Copy and paste the following registry script into the document:

```reg
Windows Registry Editor Version 5.00

[HKEY_CLASSES_ROOT\.md]
@="MarkdownFile"
"PerceivedType"="text"

[HKEY_CLASSES_ROOT\.md\ShellNew]
"NullFile"=""

[HKEY_CLASSES_ROOT\MarkdownFile]
@="Markdown Document"