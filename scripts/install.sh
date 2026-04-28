#!/usr/bin/env sh
set -eu

REPO="${HELION_REPO:-gabrielpondc/HelionCoder}"
VERSION="${HELION_VERSION:-latest}"
BIN_NAME="helion-coder"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat <<'EOF'
HelionCoder installer

Usage:
  sh scripts/install.sh [version]

Examples:
  sh scripts/install.sh
  sh scripts/install.sh 0.0.4
  curl -fsSL https://raw.githubusercontent.com/gabrielpondc/HelionCoder/main/scripts/install.sh | sh -s -- 0.0.4

Environment:
  HELION_VERSION       Release tag to install. Defaults to latest.
  HELION_REPO          GitHub repo. Defaults to gabrielpondc/HelionCoder.
  HELION_INSTALL_DRY_RUN=1  Print detected target and URL without installing.
EOF
  exit 0
fi

if [ "$#" -gt 1 ]; then
  echo "Error: too many arguments. Run with --help for usage." >&2
  exit 1
fi

if [ "${1:-}" != "" ]; then
  VERSION="$1"
fi

log() {
  printf '%s\n' "==> $*" >&2
}

fail() {
  printf '%s\n' "Error: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

detect_os() {
  case "$(uname -s)" in
    Darwin) printf '%s' "darwin" ;;
    Linux) printf '%s' "linux" ;;
    MINGW*|MSYS*|CYGWIN*) printf '%s' "windows" ;;
    *) fail "unsupported operating system: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64|aarch64) printf '%s' "arm64" ;;
    x86_64|amd64) printf '%s' "x64" ;;
    *) fail "unsupported architecture: $(uname -m)" ;;
  esac
}

default_install_dir() {
  if [ "$OS" = "windows" ]; then
    printf '%s/bin' "$HOME"
  else
    printf '%s' "/usr/local/bin"
  fi
}

download_file() {
  url="$1"
  output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --connect-timeout 20 -o "$output" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$output" "$url"
  else
    fail "curl or wget is required to download HelionCoder"
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
    fail "no write permission for $INSTALL_DIR and sudo is not available"
  fi
}

ensure_dir() {
  dir="$1"
  if [ -d "$dir" ]; then
    return
  fi
  if mkdir -p "$dir" 2>/dev/null; then
    return
  fi
  run_privileged mkdir -p "$dir"
}

install_binary() {
  src="$1"
  dest="$2"
  if [ "$OS" = "darwin" ]; then
    need_cmd sudo
    if command -v install >/dev/null 2>&1; then
      sudo install -m 755 "$src" "$dest"
    else
      sudo cp "$src" "$dest"
      sudo chmod 755 "$dest"
    fi
    return
  fi

  if [ "$OS" != "windows" ] &&
    { [ ! -w "$INSTALL_DIR" ] || { [ -e "$dest" ] && [ ! -w "$dest" ]; }; }; then
    if command -v install >/dev/null 2>&1; then
      run_privileged install -m 755 "$src" "$dest"
    else
      run_privileged cp "$src" "$dest"
      run_privileged chmod 755 "$dest"
    fi
    return
  fi

  if command -v install >/dev/null 2>&1; then
    install -m 755 "$src" "$dest"
  else
    cp "$src" "$dest"
    chmod 755 "$dest"
  fi
}

ensure_executable() {
  target="$1"
  [ "$OS" = "windows" ] && return
  if chmod 755 "$target" 2>/dev/null; then
    return
  fi
  run_privileged chmod 755 "$target"
}

clear_macos_quarantine() {
  target="$1"
  [ "$OS" = "darwin" ] || return
  need_cmd sudo
  command -v xattr >/dev/null 2>&1 || return
  sudo xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
}

windows_path() {
  path_value="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$path_value"
  else
    printf '%s' "$path_value"
  fi
}

add_windows_path() {
  [ "$OS" = "windows" ] || return
  bin_dir="$(windows_path "$INSTALL_DIR")"

  if command -v powershell.exe >/dev/null 2>&1; then
    PATH_TO_ADD="$bin_dir" powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '
      $bin = $env:PATH_TO_ADD
      $path = [Environment]::GetEnvironmentVariable("Path", "User")
      if ([string]::IsNullOrWhiteSpace($path)) {
        [Environment]::SetEnvironmentVariable("Path", $bin, "User")
        exit 0
      }
      $parts = $path -split ";"
      if ($parts -contains $bin) { exit 0 }
      [Environment]::SetEnvironmentVariable("Path", $path.TrimEnd(";") + ";" + $bin, "User")
    ' >/dev/null 2>&1 || log "Warning: failed to add $bin_dir to the Windows user PATH"
    log "Windows user PATH includes: $bin_dir"
  elif command -v setx >/dev/null 2>&1; then
    setx PATH "%PATH%;$bin_dir" >/dev/null 2>&1 ||
      log "Warning: failed to add $bin_dir to the Windows user PATH"
    log "Windows user PATH includes: $bin_dir"
  else
    log "Warning: add $bin_dir to your Windows user PATH manually"
  fi
}

OS="${HELION_INSTALL_OS:-$(detect_os)}"
ARCH="${HELION_INSTALL_ARCH:-$(detect_arch)}"
EXT=""
if [ "$OS" = "windows" ]; then
  EXT=".exe"
fi

INSTALL_DIR="$(default_install_dir)"
ASSET="helion-coder-$OS-$ARCH$EXT"
TARGET="$INSTALL_DIR/$BIN_NAME$EXT"

if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$ASSET"
else
  DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
fi

log "Version: $VERSION"
log "Platform: $OS-$ARCH"
log "Asset: $ASSET"
log "Install path: $TARGET"

if [ "${HELION_INSTALL_DRY_RUN:-}" = "1" ]; then
  log "Download URL: $DOWNLOAD_URL"
  exit 0
fi

need_cmd uname

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t helion-coder)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM
TMP_BIN="$TMP_DIR/$ASSET"

log "Downloading $DOWNLOAD_URL"
download_file "$DOWNLOAD_URL" "$TMP_BIN"
chmod 755 "$TMP_BIN"

ensure_dir "$INSTALL_DIR"
install_binary "$TMP_BIN" "$TARGET"
ensure_executable "$TARGET"
clear_macos_quarantine "$TARGET"
add_windows_path

INSTALLED_VERSION="$("$TARGET" --version 2>/dev/null || true)"
log "Installed HelionCoder to $TARGET"
if [ -n "$INSTALLED_VERSION" ]; then
  log "$INSTALLED_VERSION"
fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    if [ "$OS" = "windows" ]; then
      log "Restart your terminal before running $BIN_NAME."
    else
      log "Warning: $INSTALL_DIR is not in PATH. Add it to your shell profile to run $BIN_NAME directly."
    fi
    ;;
esac
