# @mdzip/editor-ng — Issues & Requests

Filed against: `@mdzip/editor-ng@1.2.5`  
Filed by: mdzip-studio (consumer)  
Date: 2026-06-08

---

## Issue 1 — Package published without compiled output

**Severity: Blocking**

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

## Issue 2 — Internal import uses old (unscoped) package name

**Severity: Blocking**

`workspace.component.ts` imports from `'mdzip-editor'` instead of `'@mdzip/editor'`:

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

## Issue 3 — Peer dependency range excludes Angular 21+

**Severity: High**

```json
"peerDependencies": {
  "@angular/common": "^20.0.0",
  "@angular/core": "^20.0.0"
}
```

Angular 21 is a non-breaking major for this library's API surface. The range should be widened to avoid `ERESOLVE` errors for Angular 21+ consumers (currently requires `--legacy-peer-deps`).

**Fix:** Update to `">=20.0.0"` or `"^20.0.0 || ^21.0.0"`.

---

## Issue 4 — Peer dependency on `@mdzip/editor` uses exact version

**Severity: Medium**

```json
"@mdzip/editor": "1.2.5"
```

An exact peer version prevents consumers from running a patched release of `@mdzip/editor` without re-publishing `@mdzip/editor-ng`. Use a compatible range instead.

**Fix:** `"^1.2.5"` (or `"~1.2.5"` if minor-level changes are considered breaking).

---

## Issue 5 — Implicit `any` parameters fail under `strict: true`

**Severity: High** (breaks builds when library source is compiled by a strict consumer)

Several callback parameters in `workspace.component.ts` lack explicit type annotations:

```ts
// lines 170–174 — implicit any under noImplicitAny
onSelectionChanged: (snapshot) => ...,
onDirtyChanged: (snapshot) => ...,
onValidationChanged: (snapshot) => ...,
onColorSchemeChanged: (colorScheme) => ...,
onFailed: (e) => ...,
```

All required types (`MdzipWorkspaceSnapshot`, `MdzipColorScheme`) are already imported. Adding explicit annotations is a one-line fix per parameter.

**Workaround in use (mdzip-studio):** Direct node_modules patch (not persistent across `npm install`).

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

## Summary checklist

| # | Issue | Severity |
|---|-------|---------|
| 1 | Publish compiled APF output (dist + exports) | Blocking |
| 2 | Fix internal `'mdzip-editor'` → `'@mdzip/editor'` imports | Blocking |
| 3 | Widen Angular peer dep to include v21+ | High |
| 4 | Use semver range for `@mdzip/editor` peer dep | Medium |
| 5 | Add explicit types to implicit-`any` callback parameters | High |
| 6 | Replace `isomorphic-dompurify` with ESM-native `dompurify` | Medium |
