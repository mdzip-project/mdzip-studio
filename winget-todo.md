# Winget — publishing MDZip Studio (interactive, no PAT)

Publish MDZip Studio to `microsoft/winget-pkgs` as:

```text
MDZip.Studio   (moniker: mdzip-studio)
```

We publish **interactively** via WingetCreate's GitHub sign-in — no personal
access token or repo secret is needed. First run opens a browser sign-in and
caches the credential; later runs reuse it.

> Studio's winget work is the tail end of the .NET 10 / packaging effort.
> Full plan and rationale: [design/NET10 Migration and WinGet Publishing.md](design/NET10%20Migration%20and%20WinGet%20Publishing.md) (Phase 6).

## Prereqs (must be true before submitting)
- Run on **Windows** with `wingetcreate` installed (`winget install Microsoft.WingetCreate`).
- A **published GitHub release** whose asset is the NSIS installer
  `MDZip-Studio-Setup-<ver>.exe` (winget needs a public URL + the file to hash).
- .NET 10 migration complete and **clean-VM verification passed** (design Phase 5)
  — including the silent install (`/S /allusers /mdzipExplorerIntegration`).

## First publish (one time)

Studio's manifest is more than a single installer line, so generate, then
hand-edit before submitting:

```powershell
# 1. Generate a draft from the installer URL (auto-computes SHA256, detects NSIS):
wingetcreate new "https://github.com/mdzip-project/mdzip-studio/releases/download/v<ver>/MDZip-Studio-Setup-<ver>.exe"
```
When prompted: **PackageIdentifier** `MDZip.Studio`, **Moniker** `mdzip-studio`,
**License** `Apache-2.0`, plus publisher / name / description.

```powershell
# 2. Edit the generated manifest to add TWO installer nodes (same URL + hash):
#    - user scope    : Scope: user,    Silent: /S /currentuser            (app only)
#    - machine scope : Scope: machine, Silent: /S /allusers /mdzipExplorerIntegration
#                      ElevationRequirement: elevatesSelf
#                      PackageDependencies: Microsoft.DotNet.DesktopRuntime.10
#
# 3. Validate, then sign in to GitHub and submit the PR:
wingetcreate submit --prtitle "New package: MDZip.Studio v<ver>" <path-to-manifest-folder>
```
Declaring `Microsoft.DotNet.DesktopRuntime.10` as a dependency makes winget
install the runtime first, so the installer's bundled download is skipped and
sandboxed validation doesn't hit the network (design Phase 6).

Wait for Microsoft's bots/maintainers to validate and merge. Then:
```powershell
winget install MDZip.Studio                 # user scope: app only
winget install MDZip.Studio --scope machine # machine scope: + Explorer previewer
```

## Every release after that

Once the manifest exists, update interactively (reuses cached sign-in):

```powershell
wingetcreate update MDZip.Studio --version <ver> --urls "https://github.com/mdzip-project/mdzip-studio/releases/download/v<ver>/MDZip-Studio-Setup-<ver>.exe" --submit
```
If the installer's silent switches or the .NET dependency change, re-edit the
manifest (as in step 2) before submitting.

## Notes
- **Default `winget install` is user scope = app only.** The Explorer previewer
  needs `--scope machine` (HKLM + elevation) — document this in release notes.
- An expired cached credential just triggers a fresh browser sign-in.
- Unsigned installer → users may see SmartScreen until reputation builds
  (accepted by winget; code signing is out of scope for now).
