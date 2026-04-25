#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is required to build native executables." >&2
  exit 1
fi

EXTERNALS=(
  "@anthropic-ai/bedrock-sdk"
  "@anthropic-ai/foundry-sdk"
  "@anthropic-ai/vertex-sdk"
  "@azure/identity"
  "google-auth-library"
  "sharp"
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

build_native() {
  local target="$1"
  local outfile="$2"
  local args=(build --compile)

  if [[ -n "$target" ]]; then
    args+=(--target="$target")
  fi

  for pkg in "${EXTERNALS[@]}"; do
    args+=(--external "$pkg")
  done

  args+=(--outfile "$outfile" dist/cli.mjs)

  echo "==> Building $outfile"
  bun "${args[@]}"
}

echo "==> Building CLI bundle"
npm run build

echo "==> Packaging npm distribution"
npm run build:npm

build_native "" "dist/helion-coder"
build_native "bun-darwin-arm64" "dist/helion-coder-darwin-arm64"
build_native "bun-darwin-x64" "dist/helion-coder-darwin-x64"
build_native "bun-linux-x64" "dist/helion-coder-linux-x64"
build_native "bun-linux-arm64" "dist/helion-coder-linux-arm64"
build_native "bun-windows-x64" "dist/helion-coder-windows-x64.exe"

echo "==> Packaging VS Code extension"
npm run package:vscode

echo "==> Release artifacts"
ls -lh \
  dist/helion-coder \
  dist/helion-coder-darwin-arm64 \
  dist/helion-coder-darwin-x64 \
  dist/helion-coder-linux-x64 \
  dist/helion-coder-linux-arm64 \
  dist/helion-coder-windows-x64.exe \
  vscode-extension/helion-coder-vscode-0.1.0.vsix

file \
  dist/helion-coder \
  dist/helion-coder-darwin-arm64 \
  dist/helion-coder-darwin-x64 \
  dist/helion-coder-linux-x64 \
  dist/helion-coder-linux-arm64 \
  dist/helion-coder-windows-x64.exe
