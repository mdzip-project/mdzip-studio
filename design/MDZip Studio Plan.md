# MDZip Studio

## Project Overview

References
- https://mdzip.org
- https://github.com/mdzip-project
- https://github.com/mdzip-project/mdzip-spec

MDZip Studio is the reference desktop application for the MDZip ecosystem.

It is not intended to compete with:

* Visual Studio Code (we have an extension already)

* Obsidian

* Typora

* Logseq

* Other full-featured Markdown editors

Instead, MDZip Studio serves as:

* A reference implementation of MDZip

* A desktop host for `@mdzip/editor-ng`

* A showcase for MDZip capabilities

* A testing and validation environment for the MDZip ecosystem

The application should demonstrate how MDZip archives are:

* Created

* Viewed

* Edited

* Validated

* Packaged

* Inspected

***

# Goals

## Primary Goals

* Open/edit existing `.mdz` and `.md` files

* Create new `.mdz`  and `.md` files

* Browse archive contents

* Edit Markdown content

* Manage assets

* Edit manifests

* Validate archives

* Save archives

## Secondary Goals

* Demonstrate best practices for MDZip consumers

* Provide a platform for testing MDZip features

* Provide a desktop experience for non-developer users

***

# Non-Goals

MDZip Studio is not intended to become:

* A note-taking platform

* A knowledge management system

* A personal wiki

* A Git client

* A plugin ecosystem

* A replacement for VS Code

The focus should remain on MDZip.

***

# Architecture

## Dependency Hierarchy

```text
@mdzip/core-js
      ↓
@mdzip/editor
      ↓
@mdzip/editor-ng
      ↓
mdzip-studio
```

MDZip Studio should consume `@mdzip/ditor-ng`.

The application should not duplicate functionality already provided by:

* @mdzip/core-js

* @mdzip/editor-ng (although there may be cases where we want studio to provide some functionality instead of the library)

***

# Technology Stack

## Recommended

* Electron

* Angular

* TypeScript

Reasons:

* Existing Angular expertise

* Existing MDZip TypeScript ecosystem

* Maximum code reuse

* Cross-platform support

Target platforms:

* Windows

* macOS

* Linux

***

# Phase 1 - Reference Desktop Application

## Archive Operations

Support:

* Open .md and MDZip archive

* Create .md and MDZip archive

* Save .md MDZip archive

* Save As

* Recent Files

***

## Workspace

Provide:

* File navigation

* Archive navigation

* Document navigation

Support:

* Document mode archives

* Project mode archives

***

## Viewing

Provide:

### Read-Only View

* Rendered Markdown

* Asset viewing

* Manifest viewing

### Preview View

* Rendered Markdown preview

***

## Editing

Provide:

### Source Mode

Markdown editor

### Split Mode

Editor + preview

### Manifest Editing

Manifest editor

### Asset Management

* Browse assets

* Insert images

* Add assets

* Remove assets

***

# Phase 2 - Workspace Features

## Search

Provide:

* Archive-wide search

* Document search

***

## Validation

Provide:

* Manifest validation

* Entry point validation

* Archive consistency validation

***

## Diagnostics

Provide:

* Validation errors

* Warnings

* Archive health indicators

***

## User Experience

Provide:

* Recent files

* Settings

* Theme support

* Keyboard shortcuts

***

# Phase 3 - Studio Features

## Package Inspector

Provide:

* Archive structure visualization

* Manifest inspection

* Asset inspection

* Metadata inspection

***

## Manifest Designer

Provide visual editing tools for:

* Mode

* Entry point

* Metadata

***

## Archive Explorer

Provide advanced archive inspection capabilities.

***

## Spec Conformance

Provide:

* Spec validation

* Conformance reporting

***

# Phase 4 - AI Features

## Context Package Builder

Assist users in creating MDZip archives intended for AI consumption.

Potential capabilities:

* Archive optimization

* Context analysis

* Package sizing guidance

***

## AGENTS.md Support

Provide:

* AGENTS.md generation

* AGENTS.md editing

* AGENTS.md validation

***

## Token Analysis

Provide:

* Approximate token counts

* Archive size metrics

* Context usage estimates

***

## MCP Testing Tools

Provide tools to:

* Validate MDZip MCP integrations

* Inspect MCP responses

* Test archive access patterns

***

# User Interface

## Main Layout

Suggested layout:

```text
+--------------------------------------------------+
| Menu / Toolbar                                   |
+--------------------------------------------------+
| Navigation | Editor / Preview Area               |
|            |                                     |
|            |                                     |
+--------------------------------------------------+
| Status Bar                                       |
+--------------------------------------------------+
```

***

## Navigation Pane

Support:

* Documents

* Assets

* Manifest

* Archive structure

***

## Workspace Area

Support:

* Read-only viewing

* Editing

* Split mode

* Preview mode

***

# Repository

Repository:

```text
mdzip-studio
```

Suggested structure:

```text
mdzip-studio/
├── src/
├── electron/
├── docs/
├── tests/
└── package.json
```

***

# Success Criteria

Version 1 is successful when a user can:

1. Create a new MDZip archive.

2. Open an existing MDZip archive.

3. View archive contents.

4. Edit Markdown files.

5. Manage assets.

6. Edit the manifest.

7. Validate the archive.

8. Save the archive.

Version 1 should demonstrate the complete MDZip workflow while remaining intentionally focused and lightweight.

***

# Guiding Principle

MDZip Studio should be the easiest way to understand, create, inspect, and validate MDZip archives.

Whenever a design decision is unclear, favor:

* Simplicity

* Transparency

* Spec compliance

* Demonstration of best practices

over feature accumulation.
