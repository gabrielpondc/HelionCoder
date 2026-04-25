<div align="center">

# Claude Code Source Snapshot

**An exploratory mirror of a source snapshot reportedly exposed via published source maps on March 31, 2026**

[![TypeScript](https://img.shields.io/badge/TypeScript-512K%2B_lines-3178C6?logo=typescript&logoColor=white)](#tech-stack)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?logo=bun&logoColor=white)](#tech-stack)
[![Files](https://img.shields.io/badge/~1,900_files-source_only-grey)](#directory-structure)
[![MCP Server](https://img.shields.io/badge/MCP-Explorer_Server-blueviolet)](#-explore-with-mcp-server)
</div>

Also check out these two cool projects:
1. [claude_agent_teams_ui](https://github.com/777genius/claude_agent_teams_ui) - You're the CTO, agents are your team. They handle tasks themselves, message each other, review each other's code. You just look at the kanban board and drink coffee.
2. [claude-notifications-go](https://github.com/777genius/claude-notifications-go) - 🔔 Cross-platform smart notifications plugin for Claude Code. 6 types. Click-to-focus. 1 line installation.

   

> The raw imported snapshot is preserved in this repository's [`backup` branch](https://github.com/777genius/claude-code-source-code/tree/backup). The `main` branch contains added documentation, tooling, and repository metadata.



---

## Table of Contents

- [How It Leaked](#how-it-leaked)
- [What Is Claude Code?](#what-is-claude-code)
- [Documentation](#-documentation)
- [Explore with MCP Server](#-explore-with-mcp-server)
- [Terminal Commands](#terminal-commands)
- [Directory Structure](#directory-structure)
- [Build and Binary Packaging](#build-and-binary-packaging)
- [Architecture](#architecture)
  - [Tool System](#1-tool-system)
  - [Command System](#2-command-system)
  - [Service Layer](#3-service-layer)
  - [Bridge System](#4-bridge-system)
  - [Permission System](#5-permission-system)
  - [Feature Flags](#6-feature-flags)
- [Key Files](#key-files)
- [Tech Stack](#tech-stack)
- [Design Patterns](#design-patterns)
- [GitPretty Setup](#gitpretty-setup)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)

---

## How It Leaked

[Chaofan Shou (@Fried_rice)](https://x.com/Fried_rice) discovered that the published npm package for Claude Code included a `.map` file referencing the full, unobfuscated TypeScript source — downloadable as a zip from Anthropic's R2 storage bucket.

> **"Claude code source code has been leaked via a map file in their npm registry!"**
>
> — [@Fried_rice, March 31, 2026](https://x.com/Fried_rice/status/2038894956459290963)

---

## What Is Claude Code?

Claude Code is Anthropic's official CLI tool for interacting with Claude directly from the terminal: editing files, running commands, searching codebases, managing git workflows, and more. This repository contains a source snapshot together with added docs, MCP tooling, and repository metadata to help inspect it.

| | |
|---|---|
| **Leaked** | 2026-03-31 |
| **Language** | TypeScript (strict) |
| **Runtime** | [Bun](https://bun.sh) |
| **Terminal UI** | [React](https://react.dev) + [Ink](https://github.com/vadimdemedes/ink) |
| **Scale** | ~1,900 files · 512,000+ lines of code |

---

## Documentation

For in-depth guides, see the [`docs/`](docs/) directory:

| Guide | Description |
|-------|-------------|
| **[Architecture](docs/architecture.md)** | Core pipeline, startup sequence, state management, rendering, data flow |
| **[Tools Reference](docs/tools.md)** | Complete catalog of all ~40 agent tools with categories and permission model |
| **[Commands Reference](docs/commands.md)** | All ~85 slash commands organized by category |
| **[Subsystems Guide](docs/subsystems.md)** | Deep dives into Bridge, MCP, Permissions, Plugins, Skills, Tasks, Memory, Voice |
| **[Exploration Guide](docs/exploration-guide.md)** | How to navigate the codebase — study paths, grep patterns, key files |

Also see: [CONTRIBUTING.md](CONTRIBUTING.md) · [MCP Server README](mcp-server/README.md)

---

## Explore with MCP Server

This repo also ships an [MCP server](https://modelcontextprotocol.io/) that lets any MCP-compatible client (Claude Code, Claude Desktop, VS Code Copilot, Cursor) explore the snapshot interactively.

### Install from npm

The MCP server is published as [`claude-code-explorer-mcp`](https://www.npmjs.com/package/claude-code-explorer-mcp) on npm — no need to clone the repo:

```bash
# Claude Code
claude mcp add claude-code-explorer -- npx -y claude-code-explorer-mcp
```

### One-liner setup (from source)

```bash
git clone https://github.com/777genius/claude-code-source-code.git ~/claude-code-source-code \
  && cd ~/claude-code-source-code/mcp-server \
  && npm install && npm run build \
  && claude mcp add claude-code-explorer -- node ~/claude-code-source-code/mcp-server/dist/index.js
```

<details>
<summary><strong>Step-by-step setup</strong></summary>

```bash
# 1. Clone the repo
git clone https://github.com/777genius/claude-code-source-code.git
cd claude-code-source-code/mcp-server

# 2. Install & build
npm install && npm run build

# 3. Register with Claude Code
claude mcp add claude-code-explorer -- node /absolute/path/to/claude-code-source-code/mcp-server/dist/index.js
```

Replace `/absolute/path/to/claude-code-source-code` with your actual clone path.

</details>

<details>
<summary><strong>VS Code / Cursor / Claude Desktop config</strong></summary>

**VS Code** — add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "claude-code-explorer": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/mcp-server/dist/index.js"],
      "env": { "CLAUDE_CODE_SRC_ROOT": "${workspaceFolder}/src" }
    }
  }
}
```

**Claude Desktop** — add to your config file:
```json
{
  "mcpServers": {
    "claude-code-explorer": {
      "command": "node",
      "args": ["/absolute/path/to/claude-code-source-code/mcp-server/dist/index.js"],
      "env": { "CLAUDE_CODE_SRC_ROOT": "/absolute/path/to/claude-code-source-code/src" }
    }
  }
}
```

**Cursor** — add to `~/.cursor/mcp.json` (same format as Claude Desktop).

</details>

### Available tools & prompts

| Tool | Description |
|------|-------------|
| `list_tools` | List all ~40 agent tools with source files |
| `list_commands` | List all ~50 slash commands with source files |
| `get_tool_source` | Read full source of any tool (e.g. BashTool, FileEditTool) |
| `get_command_source` | Read source of any slash command (e.g. review, mcp) |
| `read_source_file` | Read any file from `src/` by path |
| `search_source` | Grep across the entire source tree |
| `list_directory` | Browse `src/` directories |
| `get_architecture` | High-level architecture overview |

| Prompt | Description |
|--------|-------------|
| `explain_tool` | Deep-dive into how a specific tool works |
| `explain_command` | Understand a slash command's implementation |
| `architecture_overview` | Guided tour of the full architecture |
| `how_does_it_work` | Explain any subsystem (permissions, MCP, bridge, etc.) |
| `compare_tools` | Side-by-side comparison of two tools |

**Try asking:** *"How does the BashTool work?"* · *"Search for where permissions are checked"* · *"Show me the /review command source"*

### Custom source path / Remove

```bash
# Custom source location
claude mcp add claude-code-explorer -e CLAUDE_CODE_SRC_ROOT=/path/to/src -- node /path/to/mcp-server/dist/index.js

# Remove
claude mcp remove claude-code-explorer
```

---

## Terminal Commands

Run commands from the repository root.

### Install dependencies

```bash
# Recommended: use the package manager declared in package.json
bun install

# Alternative when Bun is not available
npm install
```

### Develop locally

```bash
# Build the Node-compatible CLI bundle into dist/cli.mjs
bun run build

# Rebuild automatically while editing
bun run build:watch

# Run the bundled CLI
bun run start

# Or run the bundle directly
node dist/cli.mjs --help
node dist/cli.mjs --version
```

### Quality checks

```bash
# TypeScript only
bun run typecheck

# Biome lint/check
bun run lint

# Auto-fix lint/format issues in src/
bun run lint:fix
bun run format

# Lint + typecheck
bun run check

# Shell helper: install + check
./scripts/build.sh
./scripts/build.sh install
./scripts/build.sh check

# CI-style pipeline: install, typecheck, lint, production build, verify output
./scripts/ci-build.sh
```

### Build auxiliary packages

```bash
# Web assets
bun run build:web
bun run build:web:prod

# VS Code extension
bun run build:vscode
bun run package:vscode

# Generate a publishable npm package in dist/npm/
bun run build:prod
bun run build:npm
```

---

## Directory Structure

### Top-level repository

```
.
├── README.md                  # Project overview and usage notes
├── package.json               # Scripts, dependencies, bin names, package metadata
├── bun.lock                   # Bun dependency lockfile
├── package-lock.json          # npm dependency lockfile
├── tsconfig.json              # TypeScript compiler configuration
├── biome.json                 # Biome lint/format configuration
├── bunfig.toml                # Bun configuration
├── Dockerfile                 # Container build entrypoint
├── docker/                    # Docker-related assets
├── docs/                      # Architecture, commands, tools, subsystem guides
├── prompts/                   # Prompt templates and prompt-related assets
├── scripts/                   # Build, packaging, CI, and test helper scripts
├── src/                       # Main CLI TypeScript source snapshot
├── dist/                      # Generated bundles and binaries
├── mcp-server/                # Source for the explorer MCP server
├── vscode-extension/          # VS Code extension package
└── web/                       # Web UI/assets build target
```

### Main CLI source

```
src/
├── entrypoints/
│   ├── cli.tsx                # CLI entrypoint used by scripts/build-bundle.ts
│   ├── init.ts                # Runtime initialization
│   ├── mcp.ts                 # MCP entrypoint
│   └── sdk/                   # SDK entrypoints
├── main.tsx                   # Commander.js CLI parser + React/Ink renderer
├── QueryEngine.ts             # Core LLM API caller (~46K lines)
├── Tool.ts                    # Tool type definitions (~29K lines)
├── commands.ts                # Command registry (~25K lines)
├── tools.ts                   # Tool registry
├── context.ts                 # System/user context collection
├── cost-tracker.ts            # Token cost tracking
│
├── tools/                     # Agent tool implementations (~40)
├── commands/                  # Slash command implementations (~50)
├── components/                # Ink UI components (~140)
├── services/                  # External service integrations
├── hooks/                     # React hooks and permission checks
├── types/                     # TypeScript type definitions
├── utils/                     # Utility functions
├── screens/                   # Full-screen UIs (Doctor, REPL, Resume)
│
├── bridge/                    # IDE integration (VS Code, JetBrains)
├── coordinator/               # Multi-agent orchestration
├── plugins/                   # Plugin system
├── skills/                    # Skill system
├── server/                    # Server mode
├── remote/                    # Remote sessions
├── memdir/                    # Persistent memory directory
├── tasks/                     # Task management
├── state/                     # State management
│
├── voice/                     # Voice input
├── vim/                       # Vim mode
├── keybindings/               # Keybinding configuration
├── schemas/                   # Config schemas (Zod)
├── migrations/                # Config migrations
├── query/                     # Query pipeline
├── ink/                       # Ink renderer wrapper
├── native-ts/                 # Native TypeScript utilities
├── outputStyles/              # Output styling
└── upstreamproxy/             # Proxy configuration
```

### Build outputs

```
dist/
├── cli.mjs                    # Node-compatible bundled CLI
├── cli.mjs.map                # Source map for cli.mjs
├── meta.json                  # esbuild bundle metadata
├── npm/                       # Publishable npm package generated by build:npm
├── helion-coder               # Native binary for the current build host
├── helion-coder-darwin-arm64  # macOS Apple Silicon binary
├── helion-coder-darwin-x64    # macOS Intel binary
├── helion-coder-linux-arm64   # Linux ARM64 binary
├── helion-coder-linux-x64     # Linux x64 binary
└── helion-coder-windows-x64.exe # Windows x64 binary
```

---

## Build and Binary Packaging

This repository has two practical output types:

1. `dist/cli.mjs`: a bundled ESM CLI that runs with Node.js 20+.
2. `dist/helion-coder-*`: native executables generated with Bun's compile target.

### Build the Node-compatible bundle

```bash
# Development bundle with source map
bun run build

# Production bundle with minification
bun run build:prod

# Production bundle without source map
bun scripts/build-bundle.ts --minify --no-sourcemap

# Verify the bundle
node dist/cli.mjs --version
node dist/cli.mjs --help
```

`build` and `build:prod` call `scripts/build-bundle.ts`, which bundles `src/entrypoints/cli.tsx` with esbuild and writes `dist/cli.mjs`.

### Generate the npm package

```bash
bun run build:prod
bun run build:npm

# Inspect locally
cd dist/npm
npm pack --dry-run

# Optional local install test
npm install -g .
helioncoder --version
helion-coder --help
```

The npm package maps both terminal commands to the same CLI bundle:

```text
helioncoder  -> dist/npm/cli.mjs
helion-coder -> dist/npm/cli.mjs
```

### Compile native binaries for each platform

Bun can cross-compile the bundled entrypoint into single-file executables. Run these commands from the repository root after installing dependencies.

```bash
# macOS Apple Silicon
bun build ./src/entrypoints/cli.tsx --compile --target=bun-darwin-arm64 --outfile=dist/helion-coder-darwin-arm64

# macOS Intel
bun build ./src/entrypoints/cli.tsx --compile --target=bun-darwin-x64 --outfile=dist/helion-coder-darwin-x64

# Linux x64
bun build ./src/entrypoints/cli.tsx --compile --target=bun-linux-x64 --outfile=dist/helion-coder-linux-x64

# Linux ARM64
bun build ./src/entrypoints/cli.tsx --compile --target=bun-linux-arm64 --outfile=dist/helion-coder-linux-arm64

# Windows x64
bun build ./src/entrypoints/cli.tsx --compile --target=bun-windows-x64 --outfile=dist/helion-coder-windows-x64.exe
```

If you only need a binary for your current platform:

```bash
bun build ./src/entrypoints/cli.tsx --compile --outfile=dist/helion-coder
```

Make Unix-like outputs executable if needed:

```bash
chmod +x dist/helion-coder \
  dist/helion-coder-darwin-arm64 \
  dist/helion-coder-darwin-x64 \
  dist/helion-coder-linux-arm64 \
  dist/helion-coder-linux-x64
```

Verify binaries:

```bash
# Current platform binary
./dist/helion-coder --version
./dist/helion-coder --help

# macOS/Linux target built for your current architecture
./dist/helion-coder-darwin-arm64 --version
./dist/helion-coder-linux-x64 --version

# Windows, from PowerShell or cmd.exe
.\\dist\\helion-coder-windows-x64.exe --version
```

Notes:

- `dist/cli.mjs` is the most portable output for Node.js environments.
- Native binaries are platform/architecture-specific; test each artifact on its target OS.
- Cross-compilation support depends on the installed Bun version. This project declares `bun >= 1.1.0`.
- If imports using the `src/` alias fail during direct `bun build --compile`, first build `dist/cli.mjs` with `bun run build:prod`, then compile the generated bundle for the current platform with `bun build ./dist/cli.mjs --compile --outfile=dist/helion-coder`.

---

## Architecture

### 1. Tool System

> `src/tools/` — Every tool Claude can invoke is a self-contained module with its own input schema, permission model, and execution logic.

| Tool | Description |
|---|---|
| **File I/O** | |
| `FileReadTool` | Read files (images, PDFs, notebooks) |
| `FileWriteTool` | Create / overwrite files |
| `FileEditTool` | Partial modification (string replacement) |
| `NotebookEditTool` | Jupyter notebook editing |
| **Search** | |
| `GlobTool` | File pattern matching |
| `GrepTool` | ripgrep-based content search |
| `WebSearchTool` | Web search |
| `WebFetchTool` | Fetch URL content |
| **Execution** | |
| `BashTool` | Shell command execution |
| `SkillTool` | Skill execution |
| `MCPTool` | MCP server tool invocation |
| `LSPTool` | Language Server Protocol integration |
| **Agents & Teams** | |
| `AgentTool` | Sub-agent spawning |
| `SendMessageTool` | Inter-agent messaging |
| `TeamCreateTool` / `TeamDeleteTool` | Team management |
| `TaskCreateTool` / `TaskUpdateTool` | Task management |
| **Mode & State** | |
| `EnterPlanModeTool` / `ExitPlanModeTool` | Plan mode toggle |
| `EnterWorktreeTool` / `ExitWorktreeTool` | Git worktree isolation |
| `ToolSearchTool` | Deferred tool discovery |
| `SleepTool` | Proactive mode wait |
| `CronCreateTool` | Scheduled triggers |
| `RemoteTriggerTool` | Remote trigger |
| `SyntheticOutputTool` | Structured output generation |

### 2. Command System

> `src/commands/` — User-facing slash commands invoked with `/` in the REPL.

| Command | Description | | Command | Description |
|---|---|---|---|---|
| `/commit` | Git commit | | `/memory` | Persistent memory |
| `/review` | Code review | | `/skills` | Skill management |
| `/compact` | Context compression | | `/tasks` | Task management |
| `/mcp` | MCP server management | | `/vim` | Vim mode toggle |
| `/config` | Settings | | `/diff` | View changes |
| `/doctor` | Environment diagnostics | | `/cost` | Check usage cost |
| `/login` / `/logout` | Auth | | `/theme` | Change theme |
| `/context` | Context visualization | | `/share` | Share session |
| `/pr_comments` | PR comments | | `/resume` | Restore session |
| `/desktop` | Desktop handoff | | `/mobile` | Mobile handoff |

### 3. Service Layer

> `src/services/` — External integrations and core infrastructure.

| Service | Description |
|---|---|
| `api/` | Anthropic API client, file API, bootstrap |
| `mcp/` | Model Context Protocol connection & management |
| `oauth/` | OAuth 2.0 authentication |
| `lsp/` | Language Server Protocol manager |
| `analytics/` | GrowthBook feature flags & analytics |
| `plugins/` | Plugin loader |
| `compact/` | Conversation context compression |
| `extractMemories/` | Automatic memory extraction |
| `teamMemorySync/` | Team memory synchronization |
| `tokenEstimation.ts` | Token count estimation |
| `policyLimits/` | Organization policy limits |
| `remoteManagedSettings/` | Remote managed settings |

### 4. Bridge System

> `src/bridge/` — Bidirectional communication layer connecting IDE extensions (VS Code, JetBrains) with the CLI.

Key files: `bridgeMain.ts` (main loop) · `bridgeMessaging.ts` (protocol) · `bridgePermissionCallbacks.ts` (permission callbacks) · `replBridge.ts` (REPL session) · `jwtUtils.ts` (JWT auth) · `sessionRunner.ts` (session execution)

### 5. Permission System

> `src/hooks/toolPermission/` — Checks permissions on every tool invocation.

Prompts the user for approval/denial or auto-resolves based on the configured permission mode: `default`, `plan`, `bypassPermissions`, `auto`, etc.

### 6. Feature Flags

Dead code elimination at build time via Bun's `bun:bundle`:

```typescript
import { feature } from 'bun:bundle'

const voiceCommand = feature('VOICE_MODE')
  ? require('./commands/voice/index.js').default
  : null
```

Notable flags: `PROACTIVE` · `KAIROS` · `BRIDGE_MODE` · `DAEMON` · `VOICE_MODE` · `AGENT_TRIGGERS` · `MONITOR_TOOL`

---

## Key Files

| File | Lines | Purpose |
|------|------:|---------|
| `QueryEngine.ts` | ~46K | Core LLM API engine — streaming, tool loops, thinking mode, retries, token counting |
| `Tool.ts` | ~29K | Base types/interfaces for all tools — input schemas, permissions, progress state |
| `commands.ts` | ~25K | Command registration & execution with conditional per-environment imports |
| `main.tsx` | — | CLI parser + React/Ink renderer; parallelizes MDM, keychain, and GrowthBook on startup |

---

## Tech Stack

| Category | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript (strict) |
| Terminal UI | [React](https://react.dev) + [Ink](https://github.com/vadimdemedes/ink) |
| CLI Parsing | [Commander.js](https://github.com/tj/commander.js) (extra-typings) |
| Schema Validation | [Zod v4](https://zod.dev) |
| Code Search | [ripgrep](https://github.com/BurntSushi/ripgrep) (via GrepTool) |
| Protocols | [MCP SDK](https://modelcontextprotocol.io) · LSP |
| API | [Anthropic SDK](https://docs.anthropic.com) |
| Telemetry | OpenTelemetry + gRPC |
| Feature Flags | GrowthBook |
| Auth | OAuth 2.0 · JWT · macOS Keychain |

---

## Design Patterns

<details>
<summary><strong>Parallel Prefetch</strong> — Startup optimization</summary>

MDM settings, keychain reads, and API preconnect fire in parallel as side-effects before heavy module evaluation:

```typescript
// main.tsx
startMdmRawRead()
startKeychainPrefetch()
```

</details>

<details>
<summary><strong>Lazy Loading</strong> — Deferred heavy modules</summary>

OpenTelemetry (~400KB) and gRPC (~700KB) are loaded via dynamic `import()` only when needed.

</details>

<details>
<summary><strong>Agent Swarms</strong> — Multi-agent orchestration</summary>

Sub-agents spawn via `AgentTool`, with `coordinator/` handling orchestration. `TeamCreateTool` enables team-level parallel work.

</details>

<details>
<summary><strong>Skill System</strong> — Reusable workflows</summary>

Defined in `skills/` and executed through `SkillTool`. Users can add custom skills.

</details>

<details>
<summary><strong>Plugin Architecture</strong> — Extensibility</summary>

Built-in and third-party plugins loaded through the `plugins/` subsystem.

</details>

---

## GitPretty Setup

<details>
<summary>Show per-file emoji commit messages in GitHub's file UI</summary>

```bash
# Apply emoji commits
bash ./gitpretty-apply.sh .

# Optional: install hooks for future commits
bash ./gitpretty-apply.sh . --hooks

# Push as usual
git push origin main
```

</details>

---

## Contributing

Contributions to documentation, the MCP server, and exploration tooling are welcome. Changes to the archived snapshot under `src/` are not the default contribution path. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

> **Note:** The `src/` directory is the archived source snapshot and should generally remain unchanged.

---

## Disclaimer

This repository archives a source snapshot reportedly exposed via Anthropic's npm distribution on **2026-03-31**. It is provided for research, documentation, and exploratory tooling around the snapshot. The original Claude Code source remains the property of [Anthropic](https://www.anthropic.com), this is not an official release, and no rights to Anthropic's original code are granted by this repository. If you choose to use or redistribute any of the archived material, you are responsible for assessing the legal implications yourself. Contact [nichxbt](https://www.x.com/nichxbt) for any comments.
