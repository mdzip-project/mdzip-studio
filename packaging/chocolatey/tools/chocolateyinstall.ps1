$ErrorActionPreference = 'Stop'

$pp = Get-PackageParameters
$silentArgs = '/S /allusers'
if (-not $pp['NoExplorerIntegration']) { $silentArgs += ' /mdzipExplorerIntegration' }
if ($pp['MakeMdDefault']) { $silentArgs += ' /mdzipMakeMdDefault' }

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'exe'
  url64bit       = 'https://github.com/mdzip-project/mdzip-studio/releases/download/v1.6.0/MDZip-Studio-Setup-1.6.0.exe'
  checksum64     = '5aed0ebbdab20578cbdb1f2148e881c923d89ce6ee3350ee01a7895c6ce1efbf'
  checksumType64 = 'sha256'
  silentArgs     = $silentArgs
  validExitCodes = @(0)
  softwareName   = 'MDZip Studio*'
}

Install-ChocolateyPackage @packageArgs
