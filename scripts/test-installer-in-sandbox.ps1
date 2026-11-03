# Tests the Windows installer's .NET runtime step (#21) in Windows Sandbox:
# a throwaway copy of Windows without the .NET 10 Desktop Runtime, so the
# installer has to download and install it. The Studio installed on this
# machine is untouched.
#
#   .\scripts\test-installer-in-sandbox.ps1 [-Installer dist\MDZip-Studio-Setup-x.y.z.exe]
#
# Needs the Windows Sandbox feature (see packaging/chocolatey/test-in-sandbox.ps1).
#
# Two runs, one after the other:
#   1. With the installer window, all users + Explorer integration, pressing
#      Enter through the pages and taking a screenshot every 3 seconds
#      (shots\), so the runtime step's messages can be checked.
#   2. Silent, with WinGet's switches, after removing Studio and the runtime,
#      while Windows Installer is busy (the test holds its _MSIExecute lock
#      for 75 seconds, as a running install does). That is the "killed
#      installer left msiexec behind" case: the installer must wait (error
#      1618) and then succeed.
# Both runs log when each process the installer starts begins and ends, so
# slow steps show up.
# Results land in result.txt in the work folder this script prints; close the
# sandbox when it says "done".
param([string] $Installer)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
if (-not $Installer) {
  $Installer = Get-ChildItem (Join-Path $root 'dist') -Filter 'MDZip-Studio-Setup-*.exe' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Installer -or -not (Test-Path $Installer)) { throw 'No installer found. Run npm run build first.' }

$work = Join-Path $env:TEMP 'mdzip-installer-sandbox'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $work 'shots') | Out-Null
Copy-Item $Installer (Join-Path $work 'setup.exe')

@'
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$log = 'C:\pkg\result.txt'
function Say($text) { Add-Content -Path $log -Value ("{0:HH:mm:ss} {1}" -f (Get-Date), $text) -Encoding utf8 }
function Check($label, $ok) { Say ($(if ($ok) { 'PASS ' } else { 'FAIL ' }) + $label) }
$exe = 'C:\Program Files\MDZip Studio\MDZip Studio.exe'
$clsid = '{CA7A244F-7A83-4B5E-9D7A-9F13EF5E8B3A}'
$runtimeDir = 'C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App'
function CheckInstall {
  Check 'Studio installed for all users' (Test-Path $exe)
  Check '.NET 10 Desktop Runtime installed' (Test-Path "$runtimeDir\10.*\WindowsBase.dll")
  Check 'Explorer preview registered' ($null -ne (Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' -ErrorAction SilentlyContinue).$clsid)
}
$script:baseline = @{}
$script:running = @{}
function TrackStart {
  $script:baseline = @{}; $script:running = @{}
  Get-Process | ForEach-Object { $script:baseline[$_.Id] = $true }
}
function TrackTick {
  $now = @{}
  foreach ($proc in Get-Process) {
    if ($script:baseline[$proc.Id]) { continue }
    $now[$proc.Id] = $true
    if (-not $script:running[$proc.Id]) {
      $script:running[$proc.Id] = @{ Name = $proc.ProcessName; Start = Get-Date }
      Say "  started $($proc.ProcessName) (pid $($proc.Id))"
    }
  }
  foreach ($id in @($script:running.Keys)) {
    if (-not $now[$id]) {
      $r = $script:running[$id]
      Say ("  ended   {0} (pid {1}) after {2:N0} s" -f $r.Name, $id, ((Get-Date) - $r.Start).TotalSeconds)
      $script:running.Remove($id)
    }
  }
}
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Shot($path) {
  $b = [Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object Drawing.Bitmap $b.Width, $b.Height
  $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [Drawing.Point]::Empty, $b.Size)
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()
}

Say "runtime present before: $(Test-Path "$runtimeDir\10.*")"

# Run 1: installer window.
Say '== Run 1: installer window, all users + Explorer integration'
$shell = New-Object -ComObject WScript.Shell
TrackStart
$start = Get-Date
$p = Start-Process 'C:\pkg\setup.exe' -ArgumentList '/allusers /mdzipExplorerIntegration' -PassThru
$i = 0
while (-not $p.HasExited -and ((Get-Date) - $start).TotalMinutes -lt 15) {
  Start-Sleep -Seconds 3
  $i++
  Shot ('C:\pkg\shots\run1-{0:D3}.png' -f $i)
  TrackTick
  # Next/Install on the wizard pages. Enter does nothing while installing;
  # on the last page it clicks Finish.
  if ($shell.AppActivate($p.Id)) { $shell.SendKeys('{ENTER}') }
}
TrackTick
Say ("exit code {0}, {1:N0} s" -f $p.ExitCode, ((Get-Date) - $start).TotalSeconds)
Start-Sleep -Seconds 5
Get-Process 'MDZip Studio' -ErrorAction SilentlyContinue | Stop-Process -Force
CheckInstall

# Reset: remove Studio and the runtime.
Say '== Reset: uninstall Studio and the runtime'
$un = Get-ChildItem 'C:\Program Files\MDZip Studio' -Filter 'Uninstall*.exe' | Select-Object -First 1
if ($un) { Start-Process $un.FullName -ArgumentList '/S /allusers' -Wait; Start-Sleep -Seconds 10 }
$rt = 'C:\pkg\windowsdesktop-runtime.exe'
Invoke-WebRequest -UseBasicParsing 'https://aka.ms/dotnet/10.0/windowsdesktop-runtime-win-x64.exe' -OutFile $rt
Start-Process $rt -ArgumentList '/uninstall /quiet /norestart' -Wait
Check 'Studio removed' (-not (Test-Path $exe))
Check 'runtime removed' (-not (Test-Path "$runtimeDir\10.*\WindowsBase.dll"))

# Run 2: silent, while another runtime install holds Windows Installer.
Say '== Run 2: silent (/S /allusers /mdzipExplorerIntegration) while Windows Installer is busy for 75 s'
$holder = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList `
  '-NoProfile -Command "$m = New-Object Threading.Mutex($true, ''Global\_MSIExecute''); Start-Sleep -Seconds 75; $m.ReleaseMutex()"'
Start-Sleep -Seconds 2
TrackStart
$start = Get-Date
$p = Start-Process 'C:\pkg\setup.exe' -ArgumentList '/S /allusers /mdzipExplorerIntegration' -PassThru
$seen = @{}
while (-not $p.HasExited -and ((Get-Date) - $start).TotalMinutes -lt 15) {
  Start-Sleep -Seconds 2
  TrackTick
  # Count the runtime installers the Studio installer starts (from its temp folder).
  Get-CimInstance Win32_Process -Filter "Name='windowsdesktop-runtime.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -notlike 'C:\pkg\*' } |
    ForEach-Object { if (-not $seen[$_.ProcessId]) { $seen[$_.ProcessId] = $true; Say "Studio installer started a runtime install (pid $($_.ProcessId))" } }
}
TrackTick
Say ("exit code {0}, {1:N0} s; lock holder finished: {2}" -f $p.ExitCode, ((Get-Date) - $start).TotalSeconds, $holder.HasExited)
Say "runtime installs started by Studio's installer: $($seen.Count) (more than 1 means it waited and retried)"
CheckInstall
Say 'done'
'@ | Set-Content (Join-Path $work 'run.ps1') -Encoding utf8

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
