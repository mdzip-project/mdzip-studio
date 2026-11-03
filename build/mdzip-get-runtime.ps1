# Downloads the .NET 10 Desktop Runtime installer for the Explorer preview
# handler (build/installer.nsh, EnsureDotNetDesktopRuntime).
#
# Prints a line about every 10% so the installer's details show progress,
# gives up on a stalled connection instead of hanging, and retries.
# Exit code 0 means the file is complete at -OutFile.
param(
  [Parameter(Mandatory = $true)][string]$Uri,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$Attempts = 3,
  [int]$StallSeconds = 60
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
  $response = $null; $stream = $null; $output = $null
  try {
    $request = [Net.HttpWebRequest]::Create($Uri)
    $request.Timeout = $StallSeconds * 1000           # connecting and the first response
    $request.ReadWriteTimeout = $StallSeconds * 1000  # each read: a stalled download fails here
    $response = $request.GetResponse()
    $total = $response.ContentLength
    $stream = $response.GetResponseStream()
    $output = [IO.File]::Create($OutFile)
    $buffer = New-Object byte[] 262144
    $done = 0; $nextReport = 0.1
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $output.Write($buffer, 0, $read)
      $done += $read
      if ($total -gt 0 -and $done / $total -ge $nextReport) {
        Write-Output ('Downloaded {0} of {1} MB' -f [math]::Round($done / 1MB), [math]::Round($total / 1MB))
        $nextReport += 0.1
      }
    }
    if ($total -gt 0 -and $done -ne $total) { throw "The download ended early ($done of $total bytes)." }
    Write-Output 'Download complete.'
    exit 0
  } catch {
    Write-Output ('Download attempt {0} of {1} failed: {2}' -f $attempt, $Attempts, $_.Exception.Message)
    if ($attempt -lt $Attempts) { Start-Sleep -Seconds (5 * $attempt) }
  } finally {
    if ($output) { $output.Dispose() }
    if ($stream) { $stream.Dispose() }
    if ($response) { $response.Dispose() }
  }
}
exit 1
