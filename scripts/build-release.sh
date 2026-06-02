#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUILD_TARGET="${1:-all}"
WINDOWS_ICON="src/logo/logo.ico"
VERSION="$(node -p "require('./package.json').version")"
VSCODE_VSIX="vscode-extension/helioncoder-vscode-${VERSION}.vsix"
JETBRAINS_ZIP="jetbrains-plugin/build/distributions/helion-coder-jetbrains-${VERSION}.zip"

NEEDS_BUN=0
case "$BUILD_TARGET" in
  all|native|windows)
    NEEDS_BUN=1
    ;;
esac

if [[ "$NEEDS_BUN" == "1" ]] && ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is required to build native executables." >&2
  exit 1
fi

case "$BUILD_TARGET" in
  all|native|windows|vscode|npm|jetbrains)
    ;;
  *)
    echo "Usage: $0 [all|native|windows|vscode|npm|jetbrains]" >&2
    exit 1
    ;;
esac

EXTERNALS=(
  "@anthropic-ai/bedrock-sdk"
  "@anthropic-ai/foundry-sdk"
  "@anthropic-ai/vertex-sdk"
  "@azure/identity"
  "google-auth-library"
  "sharp"
  "image-processor-napi"
  "@opentelemetry/exporter-metrics-otlp-grpc"
  "@opentelemetry/exporter-metrics-otlp-http"
  "@opentelemetry/exporter-metrics-otlp-proto"
  "@opentelemetry/exporter-prometheus"
  "@opentelemetry/exporter-logs-otlp-grpc"
  "@opentelemetry/exporter-logs-otlp-http"
  "@opentelemetry/exporter-logs-otlp-proto"
  "@opentelemetry/exporter-trace-otlp-grpc"
  "@opentelemetry/exporter-trace-otlp-http"
  "@opentelemetry/exporter-trace-otlp-proto"
)

is_windows_host() {
  case "$OSTYPE" in
    msys*|cygwin*|win32*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

build_native() {
  local target="$1"
  local outfile="$2"
  local args=(build --compile)

  if [[ -n "$target" ]]; then
    args+=(--target="$target")
  fi

  if [[ "$target" == bun-windows-* ]] && is_windows_host; then
    args+=(--windows-icon="$WINDOWS_ICON")
  elif [[ "$target" == bun-windows-* ]]; then
    echo "==> Skipping Windows icon: Bun only supports --windows-icon when compiling on Windows"
  fi

  for pkg in "${EXTERNALS[@]}"; do
    args+=(--external "$pkg")
  done

  args+=(--outfile "$outfile" dist/cli.mjs)

  echo "==> Building $outfile"
  bun "${args[@]}"
}

find_jetbrains_jbr21_home() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    arm64|aarch64)
      arch="aarch64"
      ;;
    x86_64|amd64)
      arch="x86_64"
      ;;
  esac

  find "$HOME/.gradle/caches" \
    -path "*idea-2025.3.3-${arch}/jbr/Contents/Home/bin/java" \
    -print -quit | sed 's#/bin/java$##'
}

build_jetbrains_plugin() {
  local jbr21_home
  jbr21_home="$(find_jetbrains_jbr21_home)"
  if [[ -z "$jbr21_home" ]]; then
    echo "未找到 IDEA 2025.3.3 自带的 JBR 21" >&2
    exit 1
  fi

  echo "==> Using JetBrains JBR 21: $jbr21_home"
  (
    cd jetbrains-plugin
    JAVA_HOME="$jbr21_home" ./gradlew --no-daemon clean buildPlugin
  )
}

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "native" || "$BUILD_TARGET" == "windows" || "$BUILD_TARGET" == "npm" ]]; then
  echo "==> Building CLI bundle"
  npm run build
fi

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "npm" ]]; then
  echo "==> Packaging npm distribution"
  npm run build:npm
fi

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "native" ]]; then
  build_native "" "dist/helion-coder"
  build_native "bun-darwin-arm64" "dist/helion-coder-darwin-arm64"
  build_native "bun-darwin-x64" "dist/helion-coder-darwin-x64"
  build_native "bun-linux-x64" "dist/helion-coder-linux-x64"
  build_native "bun-linux-arm64" "dist/helion-coder-linux-arm64"
  build_native "bun-windows-x64" "dist/helion-coder-windows-x64.exe"
elif [[ "$BUILD_TARGET" == "windows" ]]; then
  build_native "bun-windows-x64" "dist/helion-coder-windows-x64.exe"
fi

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "vscode" ]]; then
  echo "==> Packaging VS Code extension"
  npm run package:vscode
fi

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "jetbrains" ]]; then
  echo "==> Packaging JetBrains plugin"
  build_jetbrains_plugin
fi

echo "==> Release artifacts"
ARTIFACTS=()
FILE_ARTIFACTS=()

if [[ "$BUILD_TARGET" == "windows" ]]; then
  ARTIFACTS+=(dist/helion-coder-windows-x64.exe)
  FILE_ARTIFACTS+=(dist/helion-coder-windows-x64.exe)
fi

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "native" ]]; then
  ARTIFACTS+=(
    dist/helion-coder
    dist/helion-coder-darwin-arm64
    dist/helion-coder-darwin-x64
    dist/helion-coder-linux-x64
    dist/helion-coder-linux-arm64
    dist/helion-coder-windows-x64.exe
  )
  FILE_ARTIFACTS+=("${ARTIFACTS[@]}")
fi

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "vscode" ]]; then
  ARTIFACTS+=("$VSCODE_VSIX")
fi

if [[ "$BUILD_TARGET" == "all" || "$BUILD_TARGET" == "jetbrains" ]]; then
  ARTIFACTS+=("$JETBRAINS_ZIP")
fi

if [[ "${#ARTIFACTS[@]}" -gt 0 ]]; then
  ls -lh "${ARTIFACTS[@]}"
fi

if [[ "${#FILE_ARTIFACTS[@]}" -gt 0 ]]; then
  file "${FILE_ARTIFACTS[@]}"
fi
