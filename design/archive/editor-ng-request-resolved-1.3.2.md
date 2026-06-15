# @mdzip/editor-ng — Issues & Request

Filed against: `@mdzip/editor-ng@1.2.5`  
Filed by: mdzip-studio (consumer)  
Date: 2026-06-08  
Last reviewed: 2026-06-09 (against `@mdzip/editor-ng@1.2.9`, `@mdzip/editor@1.2.6`)

---

## ~~Issue 1 — Package published without compiled output~~ ✅ RESOLVED

**Resolved in:** `@mdzip/editor-ng@1.2.9` — package now ships compiled APF output with `dist/`, `exports`, `main`, and `typings` fields. Workaround (`postinstall` patch) can be removed.

~~**Severity: Blocking**~~

The npm tarball contains only TypeScript source files and build configuration. There is no compiled `dist/` folder, and `package.json` has no `main` or `exports` field. Standard Node/bundler resolution cannot locate an entry point.

**Current state:**
```
@mdzip/editor-ng/
  ng-package.json
  tsconfig.lib.json
  src/public-api.ts
  src/workspace.component.ts
  src/workspace.component.css
```

**Expected state:** The package should be built with `ng-packagr` before publishing and include a compiled FESM/ESM output with an `exports` field, matching Angular Package Format (APF).

**Workaround in use (mdzip-studio):** `postinstall` script patches the installed `package.json` to add the missing `exports`, `main`, and `typings` fields after every `npm install`.

The `exports` field that should be in the published `package.json`:
```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "default": "./dist/fesm2022/mdzip-editor-ng.mjs"
  }
},
"main": "./dist/fesm2022/mdzip-editor-ng.mjs",
"typings": "./dist/index.d.ts"
```

---

## ~~Issue 2 — Internal import uses old (unscoped) package name~~ ✅ RESOLVED

**Resolved in:** `@mdzip/editor-ng@1.2.9` — compiled `.mjs` output no longer contains any `'mdzip-editor'` imports. Workaround (tsconfig path alias) can be removed.

~~**Severity: Blocking**~~

~~`workspace.component.ts` imports from `'mdzip-editor'` instead of `'@mdzip/editor'`:~~

```ts
import { MdzipWorkspaceView } from 'mdzip-editor';
import type { ..., MdzipWorkspaceSnapshot } from 'mdzip-editor';
```

The package was renamed to `@mdzip/editor`. Consumers who install `@mdzip/editor` do not have `mdzip-editor` in their `node_modules`, so this import fails at build time.

**Fix:** Update all internal imports to `'@mdzip/editor'`.

**Workaround in use (mdzip-studio):** tsconfig path alias bridging the old name:
```json
"mdzip-editor": ["node_modules/@mdzip/editor/dist/index.js"]
```

---

## ~~Issue 3 — Peer dependency range excludes Angular 21+~~ ✅ RESOLVED

**Resolved in:** `@mdzip/editor-ng@1.2.9` — peer deps are now `">=20.0.0"`, covering Angular 21+. `--legacy-peer-deps` is no longer needed for this reason.

---

## ~~Issue 4 — Peer dependency on `@mdzip/editor` uses exact version~~ ✅ RESOLVED

**Resolved in:** `@mdzip/editor-ng@1.2.9` — peer dep is now `"^1.2.6"` (semver caret range).

---

## ~~Issue 5 — Implicit `any` parameters fail under `strict: true`~~ ✅ RESOLVED (moot)

**Resolved in:** `@mdzip/editor-ng@1.2.9` — package ships compiled output; consumers never compile library TypeScript source, so implicit-`any` in source never reaches the consumer's type checker.

---

---

## Issue 6 — `isomorphic-dompurify` is a CommonJS module

**Severity: Medium**

`@mdzip/editor` pulls in `isomorphic-dompurify` as a dependency, which ships only a CommonJS entry point. This causes Angular's build pipeline to emit an optimisation-bailout warning:

```
Module 'isomorphic-dompurify' used by 'node_modules/@mdzip/editor/dist/rendering.js' is not ESM
CommonJS or AMD dependencies can cause optimization bailouts.
```

In an ESM-first app this prevents full tree-shaking of the rendering bundle and increases initial bundle size.

**Fix:** Replace `isomorphic-dompurify` with `dompurify` directly (the canonical package ships a native ESM build). The `isomorphic-*` wrapper exists only to add a JSDOM environment for Node.js — unnecessary in a browser-only renderer.

**Workaround in use (mdzip-studio):** `allowedCommonJsDependencies: ["isomorphic-dompurify"]` in `angular.json` suppresses the warning but does not restore tree-shaking.

---

## Issue 7 — Large project archives load very slowly (performance)

**Severity: High**

**Affected packages:** `@mdzip/editor` and `@mdzip/core-js`

Opening a large `.mdz` archive in project mode (e.g. 750 documents) takes many seconds because the workspace reads every document's full text upfront in two separate passes.

### Root cause — `@mdzip/editor` (`workspace.js`)

`MdzipWorkspaceService.open()` hardcodes `includeOrphanedAssetAnalysis: true`:

```javascript
const coreWorkspace = await MdzArchiveCore.openWorkspace(bytes, {
    includeOrphanedAssetAnalysis: true   // forces a full text scan of every document
});
```

This flag causes `openWorkspace` to scan every markdown document for image references to find orphaned assets. For 750 documents that is a second full read pass on top of the initial document-text pass. Orphaned asset information is only relevant when the user opens the Media/Assets panel — it should not be computed eagerly on every archive open.

**Fix:** Change the hardcoded `true` to `false` (or make it an option passed in from outside). Compute orphaned assets lazily, triggered only when needed (e.g. when the asset browser is first displayed).

### Root cause — `@mdzip/core-js`

`MdzArchiveCore.openWorkspace()` has no lazy option for document text. `MdzWorkspaceDocument.text` is always eagerly populated for every document, even ones the user has not yet navigated to. For contrast, assets already support lazy loading via `includeLazyAssetReaders`.

**Fix:** Add a matching `includeLazyDocumentReaders?: boolean` option to `MdzOpenWorkspaceOptions`. When `true`:
- Set `MdzWorkspaceDocument.text = ''` for all documents except the entry point.
- Add an optional `readText?: () => Promise<string>` lazy reader to `MdzWorkspaceDocument`.

`@mdzip/editor`'s workspace service should call `readText()` the first time the user navigates to a document whose `text` is empty and a lazy reader is available.

**Observed impact:** A 750-document archive shows a blank "No MDZip workspace loaded." placeholder for many seconds (or indefinitely) while the workspace reads and decompresses all document content before rendering anything.

---

## Summary checklist

| # | Issue | Severity | Status |
|---|-------|---------|--------|
| 1 | Publish compiled APF output (dist + exports) | Blocking | ✅ Resolved in `editor-ng@1.2.9` |
| 2 | Fix internal `'mdzip-editor'` → `'@mdzip/editor'` imports | Blocking | ✅ Resolved in `editor-ng@1.2.9` |
| 3 | Widen Angular peer dep to include v21+ | High | ✅ Resolved in `editor-ng@1.2.9` |
| 4 | Use semver range for `@mdzip/editor` peer dep | Medium | ✅ Resolved in `editor-ng@1.2.9` |
| 5 | Add explicit types to implicit-`any` callback parameters | High | ✅ Resolved (moot — ships compiled output) |
| 6 | Replace `isomorphic-dompurify` with ESM-native `dompurify` | Medium | ❌ Still open (`@mdzip/editor@1.2.6`) |
| 7 | Large project archives load slowly — remove eager orphan scan, add lazy document reading | High | ❌ Still open |
