```text
██╗  ██╗███████╗██╗     ██╗ ██████╗ ███╗   ██╗     ██████╗ ██████╗ ██████╗ ███████╗██████╗ 
██║  ██║██╔════╝██║     ██║██╔═══██╗████╗  ██║    ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔══██╗
███████║█████╗  ██║     ██║██║   ██║██╔██╗ ██║    ██║     ██║   ██║██║  ██║█████╗  ██████╔╝
██╔══██║██╔══╝  ██║     ██║██║   ██║██║╚██╗██║    ██║     ██║   ██║██║  ██║██╔══╝  ██╔══██╗
██║  ██║███████╗███████╗██║╚██████╔╝██║ ╚████║    ╚██████╗╚██████╔╝██████╔╝███████╗██║  ██║
╚═╝  ╚═╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝
```

# HelionCoder

HelionCoder 是一个基于 OpenAI 兼容 API 的终端 AI 编程 CLI。项目包含主 CLI、可选的 Web 终端资源、VS Code 插件，以及用于探索 Claude Code 源码快照的 MCP Server。

## 目录

- [项目内容](#项目内容)
- [环境要求](#环境要求)
- [快速安装](#快速安装)
- [基础配置](#基础配置)
- [本地开发](#本地开发)
- [编译与打包流程](#编译与打包流程)
- [质量检查](#质量检查)
- [MCP Server](#mcp-server)
- [VS Code 插件配置](#vs-code-插件配置)
- [常用命令速查](#常用命令速查)
- [贡献说明](#贡献说明)

## 项目内容

- `src/`：主 CLI 源码，入口为 `src/entrypoints/cli.tsx`。
- `scripts/`：构建、打包、发布辅助脚本。
- `dist/`：构建产物目录，包含 `cli.mjs`、bundle 元数据和可执行文件。
- `docs/`：架构、命令、工具和子系统说明。
- `mcp-server/`：源码探索 MCP Server，支持 STDIO、HTTP 和 SSE。
- `vscode-extension/`：HelionCoder VS Code 插件。
- `web/`：Web UI / 资源相关子项目。
- `prompts/`：提示词模板和相关资源。

## 环境要求

- Bun `>= 1.1.0`（推荐，项目 `packageManager` 为 `bun@1.1.0`）
- Node.js 20+（运行 `dist/cli.mjs`）
- npm（用于部分子项目或无 Bun 环境）

## 快速安装

安装脚本会根据当前系统和架构自动选择 GitHub Release 里的最新版二进制产物，并安装成 `helion-coder` 命令。

- macOS / Linux：安装到 `/usr/local/bin/helion-coder`。脚本会自动设置可执行权限，macOS 会强制使用 `sudo install`，并清理 quarantine 标记，避免出现“已损坏”提示。
- Windows：使用 PowerShell 脚本安装到用户级 bin 目录，并写入用户 PATH。打开新终端后可直接运行 `helion-coder`。

安装最新版：

```bash
curl -fsSL https://raw.githubusercontent.com/gabrielpondc/HelionCoder/main/scripts/install.sh | sh
```

Windows PowerShell：

```powershell
iwr https://raw.githubusercontent.com/gabrielpondc/HelionCoder/main/scripts/install.ps1 -UseB | iex
```

安装指定版本。Release tag 直接使用版本号，例如 `0.0.4`：

```bash
curl -fsSL https://raw.githubusercontent.com/gabrielpondc/HelionCoder/main/scripts/install.sh | sh -s -- 0.0.4
```

Windows PowerShell 指定版本：

```powershell
$env:HELION_VERSION="0.0.4"; iwr https://raw.githubusercontent.com/gabrielpondc/HelionCoder/main/scripts/install.ps1 -UseB | iex
```

安装完成后：

```bash
helion-coder --version
```

安装依赖：

```bash
bun install
```

如果没有 Bun，也可以使用：

```bash
npm install
```

## 基础配置

项目提供 `.env.example` 作为环境变量模板：

```bash
cp .env.example .env
```

常用配置项：

```bash
# 推荐：OpenAI 兼容 API Key
OPENAI_API_KEY=your_api_key

# OpenAI 兼容 API Base URL，默认 https://api.openai.com/v1
OPENAI_BASE_URL=https://api.openai.com/v1

# 默认模型，默认 gpt-5.4
OPENAI_MODEL=your-model

# 小模型 / 快速模型，默认 gpt-5.4-mini
OPENAI_SMALL_MODEL=your-fast-model

# 多模态接口可单独配置；不配置时复用上面的主接口
OPENAI_MM_API_KEY=your_multimodal_api_key
OPENAI_MM_BASE_URL=https://api.openai.com/v1
OPENAI_MM_MODEL=your-multimodal-model

# 兼容旧配置：代码中仍会把 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL
# 作为 OpenAI 配置的后备来源读取，但新配置建议优先使用 OPENAI_*。
ANTHROPIC_API_KEY=your_api_key
ANTHROPIC_BASE_URL=https://api.openai.com/v1
ANTHROPIC_MODEL=your-model

# 禁用遥测
DISABLE_TELEMETRY=true
```

### 第三方 / 中转服务

当前 HelionCoder 的主链路是 OpenAI Responses API。接入第三方模型服务、代理网关或兼容 OpenAI 的中转服务时，通常只需要改 `OPENAI_BASE_URL`、`OPENAI_API_KEY` 和模型名：

```bash
OPENAI_API_KEY=your_provider_key
OPENAI_BASE_URL=https://your-provider.example.com/v1
OPENAI_MODEL=your-provider-model
OPENAI_SMALL_MODEL=your-provider-fast-model
```

如果服务商把 Responses、Models 等端点放在标准 `/v1` 下，配置到 `/v1` 即可；代码会按需请求 `/v1/responses`、`/v1/models` 等资源。

多模态模型可以单独配置：

```bash
OPENAI_MM_API_KEY=your_provider_key
OPENAI_MM_BASE_URL=https://your-provider.example.com/v1
OPENAI_MM_MODEL=your-vision-model
```

`CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX`、`CLAUDE_CODE_USE_FOUNDRY` 等变量来自上游 Claude Code 源码快照的历史路径，不是这个 OpenAI Responses 版本的推荐接入方式。

## 本地开发

构建主 CLI：

```bash
bun run build
```

监听构建：

```bash
bun run build:watch
```

运行构建后的 CLI：

```bash
bun run start
# 等价于
node dist/cli.mjs
```

查看帮助或版本：

```bash
node dist/cli.mjs --help
node dist/cli.mjs --version
```

## 编译与打包流程

### 1. 开发构建

```bash
bun run build
```

该命令执行 `scripts/build-bundle.ts`，使用 esbuild 将 `src/entrypoints/cli.tsx` 打包到：

```text
dist/cli.mjs
```

同时会生成 sourcemap 和 `dist/meta.json` bundle 元数据。

### 2. 生产构建

```bash
bun run build:prod
```

生产构建会开启压缩，输出仍在 `dist/`。

如果需要关闭 sourcemap：

```bash
bun scripts/build-bundle.ts --minify --no-sourcemap
```

### 3. 构建 Web 资源

```bash
bun run build:web
bun run build:web:prod
```

对应脚本为 `scripts/build-web.ts`，入口是：

```text
src/server/web/terminal.ts
```

输出到：

```text
src/server/web/public/
```

### 4. 构建 VS Code 插件

```bash
bun run build:vscode
```

打包 VS Code 插件：

```bash
bun run package:vscode
```

也可以进入插件目录单独开发：

```bash
cd vscode-extension
npm install
npm run compile
```

然后在 VS Code 中打开 `vscode-extension/`，按 `F5` 启动插件开发宿主。

### 5. 生成 npm 包

```bash
bun run build:prod
bun run build:npm
```

产物位于：

```text
dist/npm/
```

本地检查：

```bash
cd dist/npm
npm pack --dry-run
```

本地全局安装测试：

```bash
npm install -g .
helion-coder --version
helion-coder --help
```

### 6. 编译原生可执行文件

为当前平台编译：

```bash
bun build ./src/entrypoints/cli.tsx --compile --outfile=dist/helion-coder
```

跨平台示例：

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

如遇到 `src/` alias 解析问题，先构建 Node bundle，再编译 bundle：

```bash
bun run build:prod
bun build ./dist/cli.mjs --compile --outfile=dist/helion-coder
```

验证：

```bash
./dist/helion-coder --version
./dist/helion-coder --help
```

## 质量检查

```bash
# TypeScript 类型检查
bun run typecheck

# Biome 检查
bun run lint

# 自动修复 lint / format
bun run lint:fix
bun run format

# lint + typecheck
bun run check
```

## MCP Server

MCP Server 位于 `mcp-server/`，用于通过 MCP 客户端探索源码。

```bash
cd mcp-server
npm install
npm run build
```

STDIO 模式：

```bash
npm start
```

HTTP 模式：

```bash
npm run start:http
```

可用环境变量：

```bash
CLAUDE_CODE_SRC_ROOT=/absolute/path/to/src
PORT=3000
MCP_API_KEY=your-secret-token
```

## VS Code 插件配置

插件会自动检测以下 CLI 路径：

- `../dist/helion-coder`
- `../dist/cli.mjs`
- `PATH` 中的 `helion-coder`

也可以在 VS Code 设置中手动指定：

```json
{
  "helionCoder.executablePath": "/absolute/path/to/dist/helion-coder",
  "helionCoder.model": "gpt-5.4",
  "helionCoder.effort": "medium",
  "helionCoder.models": ["gpt-5.4", "gpt-5.4-mini", "your-custom-model"]
}
```

常用命令：

- `HelionCoder: 打开助手面板`
- `HelionCoder: 询问 HelionCoder`
- `HelionCoder: 解释选区`
- `HelionCoder: 选择模型`
- `HelionCoder: 配置 CLI 可执行文件`

## 常用命令速查

```bash
bun install              # 安装依赖
bun run build            # 构建 CLI
bun run build:prod       # 生产构建 CLI
bun run build:watch      # 监听构建 CLI
bun run start            # 运行 dist/cli.mjs
bun run build:web        # 构建 Web 资源
bun run build:vscode     # 编译 VS Code 插件
bun run package:vscode   # 打包 VS Code 插件
bun run build:npm        # 生成 npm 包
bun run check            # lint + typecheck
```

## 贡献说明

仓库中的 `src/` 主要是源码快照，通常不建议直接修改。更适合贡献的内容包括：

- 文档与架构说明
- MCP Server
- VS Code 插件
- 构建、打包和探索辅助脚本
- 代码分析和使用说明

详情见 `CONTRIBUTING.md`。
