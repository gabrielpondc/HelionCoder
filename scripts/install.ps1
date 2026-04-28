param(
  [Parameter(Position = 0)]
  [string]$Version = $env:HELION_VERSION
)

$ErrorActionPreference = "Stop"

$Repo = if ($env:HELION_REPO) { $env:HELION_REPO } else { "gabrielpondc/HelionCoder" }
$BinName = "helion-coder"
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = "latest"
}

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Get-InstallArch {
  $machine = $env:PROCESSOR_ARCHITEW6432
  if ([string]::IsNullOrWhiteSpace($machine)) {
    $machine = $env:PROCESSOR_ARCHITECTURE
  }

  switch -Regex ($machine) {
    "ARM64" { return "arm64" }
    "AMD64|x86_64" { return "x64" }
    default {
      throw "Unsupported Windows architecture: $machine"
    }
  }
}

function Add-UserPath {
  param([string]$Directory)

  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  if ([string]::IsNullOrWhiteSpace($current)) {
    [Environment]::SetEnvironmentVariable("Path", $Directory, "User")
    $env:Path = "$env:Path;$Directory"
    return
  }

  $parts = $current -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($parts -contains $Directory) {
    return
  }

  [Environment]::SetEnvironmentVariable("Path", ($parts + $Directory) -join ";", "User")
  $env:Path = "$env:Path;$Directory"
}

$DetectedArch = Get-InstallArch
$AssetArch = $DetectedArch
if ($DetectedArch -eq "arm64") {
  $AssetArch = "x64"
  Write-Step "Windows ARM64 detected; using x64 binary because the current release asset is windows-x64."
}

$Asset = "helion-coder-windows-$AssetArch.exe"
if ($Version -eq "latest") {
  $DownloadUrl = "https://github.com/$Repo/releases/latest/download/$Asset"
} else {
  $DownloadUrl = "https://github.com/$Repo/releases/download/$Version/$Asset"
}

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\HelionCoder\bin"
$Target = Join-Path $InstallDir "$BinName.exe"

Write-Step "Version: $Version"
Write-Step "Platform: windows-$DetectedArch"
Write-Step "Asset: $Asset"
Write-Step "Install path: $Target"

if ($env:HELION_INSTALL_DRY_RUN -eq "1") {
  Write-Step "Download URL: $DownloadUrl"
  exit 0
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$TempFile = Join-Path ([System.IO.Path]::GetTempPath()) "$Asset.$([Guid]::NewGuid().ToString('N')).download"

try {
  Write-Step "Downloading $DownloadUrl"
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempFile -UseBasicParsing
  Move-Item -Force -Path $TempFile -Destination $Target
  Add-UserPath -Directory $InstallDir

  Write-Step "Installed HelionCoder to $Target"
  try {
    $InstalledVersion = & $Target --version 2>$null
    if ($InstalledVersion) {
      Write-Step $InstalledVersion
    }
  } catch {
    Write-Step "Installed, but version check failed: $($_.Exception.Message)"
  }
  Write-Step "Open a new terminal, then run: helion-coder --version"
} finally {
  if (Test-Path $TempFile) {
    Remove-Item -Force $TempFile
  }
}
