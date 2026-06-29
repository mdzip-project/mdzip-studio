# Winget — publish MDZip.Studio (pre-authored, interactive, no PAT)

Author the WinGet manifests **in this repo** under `winget/MDZip.Studio/<version>/`
and submit the folder — no interactive wizard, no PAT or repo secret (only a
GitHub browser sign-in during `wingetcreate submit`).

- **PackageIdentifier:** `MDZip.Studio`  **Moniker:** `mdzip-studio`
- Installer is the NSIS setup `MDZip-Studio-Setup-<ver>.exe` (`InstallerType: nullsoft`).
- Full plan/rationale: [design/NET10 Migration and WinGet Publishing.md](design/NET10%20Migration%20and%20WinGet%20Publishing.md) (Phase 6).

## Prereqs (must be true before submitting)
- A **published GitHub release** with the `MDZip-Studio-Setup-<ver>.exe` asset
  (winget needs a public URL + the file to hash).
- .NET 10 migration done and **clean-VM verification passed** (design Phase 5),
  including the silent install `/S /allusers /mdzipExplorerIntegration`.
- `wingetcreate` installed (`winget install Microsoft.WingetCreate`).

## Author the manifests

Create `winget/MDZip.Studio/<ver>/` with the three files below, replacing
`<ver>` and `<SHA256>` (compute: `(Get-FileHash MDZip-Studio-Setup-<ver>.exe -Algorithm SHA256).Hash`).

`MDZip.Studio.installer.yaml` — one URL+hash, **two installer scopes**:
```yaml
# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json
PackageIdentifier: MDZip.Studio
PackageVersion: <ver>
InstallerType: nullsoft
InstallerUrl: https://github.com/mdzip-project/mdzip-studio/releases/download/v<ver>/MDZip-Studio-Setup-<ver>.exe
InstallerSha256: <SHA256>
Installers:
- Architecture: x64
  Scope: user                     # default: app only, no Explorer previewer
  InstallerSwitches:
    Silent: /S /currentuser
- Architecture: x64
  Scope: machine                  # adds the Explorer preview handler (HKLM)
  InstallerSwitches:
    Silent: /S /allusers /mdzipExplorerIntegration
  ElevationRequirement: elevatesSelf
  Dependencies:
    PackageDependencies:
    - PackageIdentifier: Microsoft.DotNet.DesktopRuntime.10
ManifestType: installer
ManifestVersion: 1.12.0
```

`MDZip.Studio.locale.en-US.yaml`:
```yaml
# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.12.0.schema.json
PackageIdentifier: MDZip.Studio
PackageVersion: <ver>
PackageLocale: en-US
Publisher: MDZip Project
PublisherUrl: https://github.com/mdzip-project
PublisherSupportUrl: https://github.com/mdzip-project/mdzip-studio/issues
Author: MDZip Project
PackageName: MDZip Studio
PackageUrl: https://mdzip.org
License: Apache-2.0
LicenseUrl: https://github.com/mdzip-project/mdzip-studio/blob/main/LICENSE
Copyright: Copyright (c) MDZip Project
ShortDescription: Desktop app for viewing and editing .mdz (MDZip) files, with Windows Explorer preview integration.
Moniker: mdzip-studio
Tags:
- mdz
- mdzip
- markdown
- editor
- viewer
ReleaseNotesUrl: https://github.com/mdzip-project/mdzip-studio/releases/tag/v<ver>
ManifestType: defaultLocale
ManifestVersion: 1.12.0
```

`MDZip.Studio.yaml`:
```yaml
# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.12.0.schema.json
PackageIdentifier: MDZip.Studio
PackageVersion: <ver>
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.12.0
```

## Validate & submit

```powershell
winget validate --manifest winget/MDZip.Studio/<ver>
wingetcreate submit --prtitle "New package: MDZip.Studio version <ver>" winget/MDZip.Studio/<ver>
```

For later releases, copy the folder, bump `PackageVersion` / `InstallerUrl` /
`InstallerSha256` (re-edit switches/dependency only if they change), validate, submit.

## Notes
- **Default `winget install MDZip.Studio` is user scope = app only.** The Explorer
  previewer needs `winget install MDZip.Studio --scope machine` (HKLM + elevation) —
  document this in release notes.
- Declaring `Microsoft.DotNet.DesktopRuntime.10` makes winget install the runtime
  first, so the installer's bundled download is skipped and sandboxed validation
  doesn't hit the network (design Phase 6).
- The bundled CLI inside Studio is **not** winget-managed — it tracks Studio's
  version; headless users wanting independent CLI updates install `MDZip.Cli`.
- Unsigned installer → users may see SmartScreen until reputation builds
  (accepted by winget; code signing is out of scope for now).
