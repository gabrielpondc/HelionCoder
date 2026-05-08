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

function Test-PathListContains {
  param(
    [string]$PathValue,
    [string]$Directory
  )

  if ([string]::IsNullOrWhiteSpace($PathValue) -or [string]::IsNullOrWhiteSpace($Directory)) {
    return $false
  }

  $normalized = $Directory.TrimEnd("\")
  foreach ($part in ($PathValue -split ";")) {
    if (-not [string]::IsNullOrWhiteSpace($part) -and $part.TrimEnd("\") -ieq $normalized) {
      return $true
    }
  }

  return $false
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
  } elseif (-not (Test-PathListContains -PathValue $current -Directory $Directory)) {
    $parts = $current -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    [Environment]::SetEnvironmentVariable("Path", ($parts + $Directory) -join ";", "User")
  }

  if (-not (Test-PathListContains -PathValue $env:Path -Directory $Directory)) {
    if ([string]::IsNullOrWhiteSpace($env:Path)) {
      $env:Path = $Directory
    } else {
      $env:Path = "$env:Path;$Directory"
    }
  }
}

function Test-CommandAvailable {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-GitVersion {
  if (-not (Test-CommandAvailable -Name "git")) {
    return $null
  }

  try {
    $output = & git --version 2>$null | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($output)) {
      return $output
    }
  } catch {
    return $null
  }

  return $null
}

function Get-GitPathDirectories {
  $candidates = @()
  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if ($gitCommand -and $gitCommand.Source) {
    $candidates += (Split-Path -Parent $gitCommand.Source)
  }

  $gitRoots = @()
  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    $gitRoots += (Join-Path $env:ProgramFiles "Git")
  }

  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
    $gitRoots += (Join-Path $programFilesX86 "Git")
  }

  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $gitRoots += (Join-Path $env:LOCALAPPDATA "Programs\Git")
  }

  foreach ($root in $gitRoots) {
    $gitCmd = Join-Path $root "cmd"
    $gitBin = Join-Path $root "bin"
    if (Test-Path (Join-Path $gitCmd "git.exe")) {
      $candidates += $gitCmd
    } elseif (Test-Path (Join-Path $gitBin "git.exe")) {
      $candidates += $gitBin
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:ProgramData)) {
    $candidates += (Join-Path $env:ProgramData "chocolatey\bin")
  }

  if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    $candidates += (Join-Path $env:USERPROFILE "scoop\shims")
  }

  $seen = @{}
  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }

    if (-not (Test-Path (Join-Path $candidate "git.exe"))) {
      continue
    }

    $key = $candidate.TrimEnd("\").ToLowerInvariant()
    if (-not $seen.ContainsKey($key)) {
      $seen[$key] = $true
      Write-Output $candidate
    }
  }
}

function Add-GitToPath {
  $gitDirs = @(Get-GitPathDirectories)
  foreach ($gitDir in $gitDirs) {
    Add-UserPath -Directory $gitDir
    Write-Step "Windows user PATH includes Git: $gitDir"
  }
}

function Install-Git {
  if (Test-CommandAvailable -Name "winget") {
    Write-Step "Git not found. Installing Git for Windows with winget."
    & winget install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) {
      throw "winget failed to install Git (exit code $LASTEXITCODE)."
    }
    return
  }

  if (Test-CommandAvailable -Name "choco") {
    Write-Step "Git not found. Installing Git for Windows with Chocolatey."
    & choco install git -y --no-progress
    if ($LASTEXITCODE -ne 0) {
      throw "Chocolatey failed to install Git (exit code $LASTEXITCODE)."
    }
    return
  }

  if (Test-CommandAvailable -Name "scoop") {
    Write-Step "Git not found. Installing Git for Windows with Scoop."
    & scoop install git
    if ($LASTEXITCODE -ne 0) {
      throw "Scoop failed to install Git (exit code $LASTEXITCODE)."
    }
    return
  }

  throw "Git is required, but git was not found and no supported installer was found. Install winget, Chocolatey, Scoop, or Git for Windows, then rerun this installer."
}

function Ensure-Git {
  $gitVersion = Get-GitVersion
  if ($gitVersion) {
    Write-Step "Git detected: $gitVersion"
    return
  }

  Write-Step "Git not found on PATH. Checking common Git install paths."
  Add-GitToPath
  $gitVersion = Get-GitVersion
  if ($gitVersion) {
    Write-Step "Git found and added to PATH: $gitVersion"
    return
  }

  Install-Git
  Add-GitToPath

  $gitVersion = Get-GitVersion
  if (-not $gitVersion) {
    throw "Git was installed, but git.exe is still not available on PATH. Open a new terminal or add Git to PATH, then rerun this installer."
  }

  Write-Step "Git installed: $gitVersion"
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
  $GitVersion = Get-GitVersion
  if ($GitVersion) {
    Write-Step "Git: $GitVersion"
  } else {
    Write-Step "Git: missing; would install Git before HelionCoder"
  }
  exit 0
}

Ensure-Git
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
