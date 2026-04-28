#!/usr/bin/env sh
set -eu

BIN_NAME="helion-coder"
LEGACY_BIN_NAME="helioncoder"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat <<'EOF'
HelionCoder uninstaller

Usage:
  sh scripts/uninstall.sh

This removes the HelionCoder binary installed by scripts/install.sh.
It does not remove ~/.helioncoder project/user data.
EOF
  exit 0
fi

if [ "$#" -gt 0 ]; then
  echo "Error: too many arguments. Run with --help for usage." >&2
  exit 1
fi

log() {
  printf '%s\n' "==> $*" >&2
}

detect_os() {
  case "$(uname -s)" in
    Darwin) printf '%s' "darwin" ;;
    Linux) printf '%s' "linux" ;;
    MINGW*|MSYS*|CYGWIN*) printf '%s' "windows" ;;
    *) printf '%s' "unknown" ;;
  esac
}

default_install_dir() {
  if [ "$OS" = "windows" ]; then
    printf '%s/bin' "$HOME"
  else
    printf '%s' "/usr/local/bin"
  fi
}

run_privileged() {
  if [ "$OS" = "windows" ]; then
    "$@"
  elif [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Error: no permission to remove files from $INSTALL_DIR and sudo is not available" >&2
    exit 1
  fi
}

remove_file() {
  file="$1"
  if [ ! -e "$file" ] && [ ! -L "$file" ]; then
    return
  fi
  if rm -f "$file" 2>/dev/null; then
    log "Removed $file"
  else
    run_privileged rm -f "$file"
    log "Removed $file"
  fi
}

windows_path() {
  path_value="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$path_value"
  else
    printf '%s' "$path_value"
  fi
}

remove_windows_path() {
  [ "$OS" = "windows" ] || return
  bin_dir="$(windows_path "$INSTALL_DIR")"

  if command -v powershell.exe >/dev/null 2>&1; then
    PATH_TO_REMOVE="$bin_dir" powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '
      $bin = $env:PATH_TO_REMOVE
      $path = [Environment]::GetEnvironmentVariable("Path", "User")
      if ([string]::IsNullOrWhiteSpace($path)) { exit 0 }
      $parts = $path -split ";" | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and
        $_.TrimEnd("\") -ne $bin.TrimEnd("\")
      }
      [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
    ' >/dev/null 2>&1 || log "Warning: failed to remove $bin_dir from the Windows user PATH"
    log "Windows user PATH no longer includes: $bin_dir"
  fi
}

OS="${HELION_INSTALL_OS:-$(detect_os)}"
INSTALL_DIR="$(default_install_dir)"
EXT=""
if [ "$OS" = "windows" ]; then
  EXT=".exe"
fi

TARGET="$INSTALL_DIR/$BIN_NAME$EXT"
LEGACY_TARGET="$INSTALL_DIR/$LEGACY_BIN_NAME$EXT"

log "Install path: $TARGET"

if [ "${HELION_UNINSTALL_DRY_RUN:-}" = "1" ]; then
  log "Would remove $TARGET"
  if [ "$LEGACY_TARGET" != "$TARGET" ]; then
    log "Would remove legacy path $LEGACY_TARGET if present"
  fi
  if [ "$OS" = "windows" ]; then
    log "Would remove $INSTALL_DIR from the Windows user PATH"
  fi
  exit 0
fi

remove_file "$TARGET"
if [ "$LEGACY_TARGET" != "$TARGET" ]; then
  remove_file "$LEGACY_TARGET"
fi
remove_windows_path

if [ -d "$INSTALL_DIR" ] && [ "$OS" = "windows" ]; then
  rmdir "$INSTALL_DIR" 2>/dev/null || true
fi

log "HelionCoder has been uninstalled."
log "User data is unchanged: ~/.helioncoder"
