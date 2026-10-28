$ErrorActionPreference = 'Stop'

[array]$keys = Get-UninstallRegistryKey -SoftwareName 'MDZip Studio*'
foreach ($key in $keys) {
  # The uninstall string looks like: "C:\...\Uninstall MDZip Studio.exe" /allusers
  $file = if ($key.UninstallString -match '^"([^"]+)"') { $Matches[1] } else { ($key.UninstallString -split ' /')[0] }
  Uninstall-ChocolateyPackage -PackageName $env:ChocolateyPackageName `
    -FileType 'exe' -SilentArgs '/S /allusers' -File $file -ValidExitCodes @(0)
}
if ($keys.Count -eq 0) { Write-Warning 'MDZip Studio is not installed; nothing to uninstall.' }

# The NSIS uninstaller copies itself to a temp folder, starts the copy and
# exits at once, so wait for the real uninstall to finish.
$deadline = (Get-Date).AddMinutes(2)
while ((Get-UninstallRegistryKey -SoftwareName 'MDZip Studio*' 3>$null) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
if (Get-UninstallRegistryKey -SoftwareName 'MDZip Studio*' 3>$null) { Write-Warning 'MDZip Studio is still listed as installed after 2 minutes.' }
