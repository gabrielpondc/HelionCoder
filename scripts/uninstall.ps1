$ErrorActionPreference = "Stop"

$BinName = "helion-coder"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\HelionCoder\bin"
$Target = Join-Path $InstallDir "$BinName.exe"
$LegacyTarget = Join-Path $InstallDir "helioncoder.exe"

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Remove-UserPath {
  param([string]$Directory)

  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  if ([string]::IsNullOrWhiteSpace($current)) {
    return
  }

  $normalized = $Directory.TrimEnd("\")
  $parts = $current -split ";" | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and
    $_.TrimEnd("\") -ne $normalized
  }
  [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")

  $sessionParts = $env:Path -split ";" | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and
    $_.TrimEnd("\") -ne $normalized
  }
  $env:Path = $sessionParts -join ";"
}

Write-Step "Install path: $Target"

if ($env:HELION_UNINSTALL_DRY_RUN -eq "1") {
  Write-Step "Would remove $Target"
  Write-Step "Would remove legacy path $LegacyTarget if present"
  Write-Step "Would remove $InstallDir from the Windows user PATH"
  exit 0
}

if (Test-Path $Target) {
  Remove-Item -Force $Target
  Write-Step "Removed $Target"
}

if (Test-Path $LegacyTarget) {
  Remove-Item -Force $LegacyTarget
  Write-Step "Removed legacy path $LegacyTarget"
}

Remove-UserPath -Directory $InstallDir
Write-Step "Windows user PATH no longer includes: $InstallDir"

try {
  if (Test-Path $InstallDir -PathType Container -and -not (Get-ChildItem -Force $InstallDir | Select-Object -First 1)) {
    Remove-Item -Force $InstallDir
  }
} catch {
  Write-Step "Install directory was left in place: $InstallDir"
}

Write-Step "HelionCoder has been uninstalled."
Write-Step "User data is unchanged: $HOME\.helioncoder"
