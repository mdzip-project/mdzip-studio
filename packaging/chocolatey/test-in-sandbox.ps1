# Tests the Chocolatey package in Windows Sandbox: a throwaway copy of
# Windows, so the Studio installed on this machine is untouched.
#
#   .\test-in-sandbox.ps1
#
# Needs the Windows Sandbox feature (Windows Pro or Enterprise). To turn it
# on once, from an elevated PowerShell, then restart:
#   Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM
#
# The sandbox installs Chocolatey and the .NET 10 Desktop Runtime (straight
# from Microsoft), then the package without its dependencies, checks the
# install, uninstalls it and checks that too. The results land in
# result.txt in the work folder this script prints; close the sandbox when
# it says "done".
#
# -WithDependencies lets Chocolatey install the runtime through the
# dotnet-10.0-desktopruntime package instead. That pulls in vcredist140 and
# Windows update packages (KB2919442 and others), which failed in Sandbox
# when tried on 2026-10-27, so it isn't the default.
param([switch] $WithDependencies)
$ErrorActionPreference = 'Stop'

$work = Join-Path $env:TEMP 'mdzip-choco-sandbox'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $work | Out-Null

Push-Location $PSScriptRoot
try { choco pack --out $work | Out-Host } finally { Pop-Location }

$runtimeStep = if ($WithDependencies) { '$deps = $true' } else { '$deps = $false' }
($runtimeStep + "`r`n" + @'
$ErrorActionPreference = 'Continue'
# Windows PowerShell 5.1 downloads very slowly while drawing a progress bar.
$ProgressPreference = 'SilentlyContinue'
$log = 'C:\pkg\result.txt'
function Say($text) { Add-Content -Path $log -Value $text -Encoding utf8 }
function Check($label, $ok) { Say ($(if ($ok) { 'PASS ' } else { 'FAIL ' }) + $label) }
function Run($label, [scriptblock]$cmd) { Say "== $label"; & $cmd 2>&1 | Out-File $log -Append -Encoding utf8; Say "exit code $LASTEXITCODE" }

Set-ExecutionPolicy Bypass -Scope Process -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Run 'Install Chocolatey' { Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1')) }
$choco = 'C:\ProgramData\chocolatey\bin\choco.exe'

if ($deps) {
  Run 'choco install mdzip-studio (with dependencies)' { & $choco install mdzip-studio --source "'C:\pkg;https://community.chocolatey.org/api/v2/'" -y --no-progress }
} else {
  Run 'Install .NET 10 Desktop Runtime (Microsoft installer)' {
    $rt = Join-Path $env:TEMP 'windowsdesktop-runtime.exe'
    Invoke-WebRequest -UseBasicParsing 'https://aka.ms/dotnet/10.0/windowsdesktop-runtime-win-x64.exe' -OutFile $rt
    Start-Process $rt -ArgumentList '/install /quiet /norestart' -Wait
  }
  Run 'choco install mdzip-studio --ignore-dependencies' { & $choco install mdzip-studio --source C:\pkg --ignore-dependencies -y --no-progress }
}
$exe = 'C:\Program Files\MDZip Studio\MDZip Studio.exe'
Check 'Studio installed for all users' (Test-Path $exe)
Check '.mdz opens with Studio' ((Get-ItemProperty 'HKLM:\Software\Classes\.mdz' -ErrorAction SilentlyContinue).'(default)' -eq 'MDZip.Studio.Document')
Check 'Explorer preview registered' ($null -ne (Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' -ErrorAction SilentlyContinue).'{CA7A244F-7A83-4B5E-9D7A-9F13EF5E8B3A}')
Check '.NET 10 Desktop Runtime installed' (Test-Path 'C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App\10.*')

Run 'choco uninstall mdzip-studio' { & $choco uninstall mdzip-studio -y --no-progress }
Check 'Studio removed' (-not (Test-Path $exe))
Check 'Explorer preview removed' ($null -eq (Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' -ErrorAction SilentlyContinue).'{CA7A244F-7A83-4B5E-9D7A-9F13EF5E8B3A}')
Say 'done'
'@) | Set-Content (Join-Path $work 'run.ps1') -Encoding utf8

@"
<Configuration>
  <MappedFolders>
    <MappedFolder><HostFolder>$work</HostFolder><SandboxFolder>C:\pkg</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\pkg\run.ps1</Command>
  </LogonCommand>
</Configuration>
"@ | Set-Content (Join-Path $work 'test.wsb') -Encoding utf8

Write-Output "Starting Windows Sandbox. Results: $work\result.txt"
Start-Process (Join-Path $work 'test.wsb')
