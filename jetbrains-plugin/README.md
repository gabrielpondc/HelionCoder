# HelionCoder JetBrains 插件

这是从现有 `vscode-extension/` 迁移出来的 JetBrains IDE 插件骨架，功能模式与 VS Code 版一致：通过本地 `helion-coder` CLI 完成助手问答和代码上下文任务。

## 已实现

### 菜单动作

| 动作 | 说明 |
|---|---|
| `Tools > HelionCoder > 打开助手面板` | 展开右侧助手 Tool Window |
| `Tools > HelionCoder > 询问 HelionCoder` | 弹窗输入问题，直接发送给助手面板 |
| `Tools > HelionCoder > 解释选区` | 把当前编辑器选中文本作为上下文发送给助手，请求解释 |
| `Tools > HelionCoder > 补全当前位置` | 基于光标上下文请求代码续写，结果可直接插入编辑器 |
| `Tools > HelionCoder > 编译项目并询问 HelionCoder` | 先触发 Gradle 构建，再把编译结果（错误/警告）连同用户问题一起发送给助手 |
| `Tools > HelionCoder > 配置 CLI 可执行文件` | 弹窗设置 `helion-coder` 可执行文件路径，留空则自动检测 |

> `补全当前位置` 还注册了 **Editor 右键菜单** 入口（`EditorPopupMenu`），在编辑器中直接右键即可使用。

### 助手面板（Tool Window）

右侧 Tool Window 使用 **JCEF WebView** 渲染，前端沿用 VS Code 版 `assistant.js` / `assistant.css`，通过 `postMessage` 协议与 Java 后端双向通信。

#### 对话与输入

- **自由提问**：在输入框输入自然语言问题发送给助手
- **快捷命令**（`/` 前缀）：内置 fix、review、explain、tests、refactor、docs、complete 等快速指令
- **`@` 上下文引用**：`@file` 引用项目文件、`@selection` 引用当前选区、`@terminal` 打开终端并注入提示词、`@workspace` 引用文件夹
- **图片与文件附件**：通过附件面板或拖放添加图片（自动 base64 编码）和文件
- **提示词模板**（`?` 前缀）：快速插入预设提示词

#### 模型与推理配置

- **模型切换**：支持从内置常用模型、JetBrains 设置、环境变量、配置文件和 OpenAI 兼容 API 端点聚合模型列表，可在面板内实时切换
- **推理强度**（effort）：low / medium / high / max，影响 CLI 的 `--effort` 参数
- **思考模式**（thinking）：enabled / adaptive / disabled，控制是否展示深度思考过程
- **权限模式**：
  - `默认权限`：按 CLI 默认逐项询问
  - `自动审查`（acceptEdits）：自动接受文件编辑，操作完成后统一审查
  - `完全访问权限`（bypassPermissions）：跳过所有权限确认
  - `计划模式`（plan）：只分析和规划，不执行修改
- **计划模式开关**：快速切换 plan 权限模式

#### 对话管理

- **新建对话**：清空当前上下文，开启独立会话
- **历史对话**：会话内记录完整的用户/助手消息，支持查看列表和恢复任意历史对话
- **会话保持**：通过 `session_id` 在多次请求间维持 CLI 会话连续性

#### 流式响应与工具步骤

助手面板以流式方式接收 CLI 输出，实时展示：

- **文本流**（stdout chunk）：逐块显示助手回复
- **思考过程**（thinking）：可选展示模型的深度推理内容
- **工具步骤**（tool step）：展示 Read / Edit / Write / Search / Bash 等工具调用的文件路径、行范围和执行状态
- **Token 用量**：显示 input / output / cache / total tokens 和费用估算
- **权限请求**：当 CLI 需要执行敏感操作时弹出交互式确认，支持批准/拒绝
- **权限回复**：用户在面板内直接响应权限请求
- **后续引导**（side question）：在任务运行期间发送追加指令，实时引导助手方向
- **停止控制**：随时取消正在运行的请求

#### 变更审查

当助手修改了工作区文件后，自动进行变更审查：

- **Diff 预览**：调用 JetBrains 原生 Diff Viewer 展示修改前后的对比
- **按文件查看**：可逐文件打开变更详情
- **接受变更**：确认保留助手所做的修改
- **拒绝变更**：一键恢复到修改前的状态（支持新建文件的删除和修改文件的回滚）

#### 设置与维护

- **API 设置**：打开终端执行 `api-config` 命令配置 API 密钥
- **CLI 路径**：快速配置 `helion-coder` 可执行文件路径
- **刷新模型**：强制从所有来源重新获取可用模型列表
- **检查更新**：从 GitHub Releases 获取最新 CLI 版本，提示更新或安装
- **查看输出**：展示插件内部运行日志
- **插件管理**：打开终端执行 `plugins` 命令

### CLI 集成（HelionCli）

- 以 `stream-json` 双向模式运行 `helion-coder` CLI，通过 stdin/stdout JSON 流进行实时通信
- 支持 `stream_event`、`streamlined_text`、`assistant`、`user`、`tool_progress`、`result`、`control_request`、`control_response`、`control_cancel_request` 等事件类型
- 自动处理 ANSI 转义序列清理
- 进程超时保护（30 分钟）和安全取消
- 通过 `CLAUDE_CODE_ENTRYPOINT=claude-jetbrains` 环境变量标识来源

### CLI 自动检测

按以下优先级定位 `helion-coder` 可执行文件：

1. 用户手动配置的路径
2. 项目目录 `dist/helion-coder` 或 `dist/cli.mjs`
3. 插件安装目录 `bin/helion-coder` 或 `bin/cli.mjs`
4. 系统 PATH
5. 常见安装路径（`/opt/homebrew/bin`、`/usr/local/bin` 等）
6. 登录 shell PATH
7. 回退到 `shell -lic exec helion-coder`

### 模型解析（HelionModelResolver）

聚合以下来源的模型列表，自动去重：

| 来源 | 说明 |
|---|---|
| 内置常用模型 | GPT-5.x、Claude 系列等预定义模型 |
| JetBrains 设置 | `Settings > Tools > HelionCoder` 中配置的模型 |
| 环境变量 | `OPENAI_MODEL`、`ANTHROPIC_MODEL` 等 |
| 配置文件 | `~/.helioncoder/settings.json`、项目 `.helioncoder/` 等 |
| OpenAI 兼容 API | 通过 `/v1/models` 端点自动发现可用模型 |

### 编辑器上下文（EditorContext）

每次提问时自动收集并注入以下上下文到 prompt：

- 活动文件路径和语言
- 光标行号和当前行内容
- 光标前后的代码片段（前 6000 字符 + 后 2500 字符）
- 选中文本（如果有）
- 编译上下文（编译并提问时）

### 编译上下文（CompilerContext）

「编译项目并询问」动作执行后，自动格式化构建结果，包括：

- 编译中止状态、错误数、警告数
- 最多 50 条错误消息和 20 条警告消息（含文件路径）

### 行内补全（Inline Completion）

基于 Kotlin 实现的 JetBrains Inline Completion Provider：

- `HelionInlineCompletionProvider`：注册为平台 `inline.completion.provider` 扩展点
- `HelionInlineCompletionInvoker`：触发行内补全请求的入口

### 设置页

`Settings > Tools > HelionCoder` 提供以下配置项：

| 配置项 | 说明 | 默认值 |
|---|---|---|
| CLI 可执行文件 | `helion-coder` 路径，留空自动检测 | 空（自动） |
| 默认参数 | 传给 CLI 的额外参数 | `--bare` |
| 模型 | 覆盖 CLI 默认模型 | 空（CLI 默认） |
| 推理强度 | low / medium / high / max | 空（CLI 默认） |
| 权限模式 | default / acceptEdits / bypassPermissions / plan | default |
| 思考模式 | enabled / adaptive / disabled | 空（CLI 默认） |
| 包含编辑器上下文 | 助手面板提问时是否附加编辑器上下文 | 开启 |

## 项目结构

```text
jetbrains-plugin/
├── README.md                         # 插件说明、开发和编译文档
├── build.gradle.kts                  # Gradle 构建脚本，配置 IntelliJ Platform、Java 工具链和 Kotlin 桥接编译
├── settings.gradle.kts               # Gradle 项目名称和插件仓库配置
├── gradle.properties                 # Gradle/IntelliJ Platform 构建属性
├── gradlew / gradlew.bat             # Gradle Wrapper 启动脚本
├── gradle/                           # Gradle Wrapper 文件
├── src/main/java/com/helioncoder/jetbrains/
│   ├── CompilerContext.java          # 收集项目编译/构建上下文
│   ├── EditorContext.java            # 收集当前编辑器、选区和文件上下文
│   ├── HelionCli.java                # 定位并调用 helion-coder CLI，处理 stream-json 事件流
│   ├── HelionModelResolver.java      # 汇总内置、配置、环境变量、文件和 API 模型列表
│   ├── HelionSettings.java           # 插件持久化设置
│   ├── HelionSettingsConfigurable.java # Settings | Tools | HelionCoder 设置页
│   ├── HelionToolWindowFactory.java  # 右侧助手 Tool Window、JCEF WebView 和前后端消息桥
│   └── actions/                      # Tools 菜单动作：打开面板、提问、解释选区、编译并提问、配置 CLI、补全
├── src/main/kotlin/com/helioncoder/jetbrains/completion/
│   ├── HelionInlineCompletionInvoker.kt  # 触发 JetBrains Inline Completion
│   └── HelionInlineCompletionProvider.kt # 行内补全 Provider
└── src/main/resources/
    ├── META-INF/plugin.xml           # 插件声明：actions、toolWindow、settings、服务和扩展点
    ├── META-INF/pluginIcon.svg       # 浅色主题插件图标
    ├── META-INF/pluginIcon_dark.svg  # 深色主题插件图标
    ├── icons/                        # 动作/工具窗口图标资源
    └── webview/
        ├── assistant.css             # 助手面板样式
        └── assistant.js              # 助手面板前端逻辑与 postMessage 协议
```

`build/` 是 Gradle 编译输出目录，包含 class、jar、zip、报告和临时文件，通常不需要提交。

## 编译方法

### 环境要求

- JDK 21：`build.gradle.kts` 使用 Java toolchain 21，并把 Java 编译目标设置为 21。
- 可访问 Maven Central、Gradle Plugin Portal 和 JetBrains IntelliJ Platform 仓库，用于下载 Gradle 插件、IDE SDK 和依赖。
- 首次构建需要下载 IntelliJ IDEA 2025.3.3 SDK（`ideaPlatformVersion = "2025.3.3"`），耗时会比较久。

### 本地运行调试 IDE

```bash
cd jetbrains-plugin
./gradlew runIde
```

该命令会启动一个用于调试插件的 JetBrains IDE 实例。

### 编译并打包插件

```bash
cd jetbrains-plugin
./gradlew buildPlugin
```

打包产物会生成在：

```text
build/distributions/
```

例如：`build/distributions/helion-coder-jetbrains-<version>.zip`。可以在 JetBrains IDE 中通过 `Settings | Plugins | Install Plugin from Disk...` 安装这个 zip。

### 常用构建命令

```bash
# 只编译 Java/Kotlin class
./gradlew classes

# 完整构建和检查
./gradlew build

# 生成/刷新 Gradle Wrapper（通常不需要重复执行）
gradle wrapper --gradle-version 8.14.3
```

### Kotlin 行内补全桥接说明

项目没有使用 Kotlin Gradle 插件，而是在 `build.gradle.kts` 中注册了 `compileHelionKotlin` 任务：

1. 先执行 `compileJava`。
2. 从 Gradle 缓存里的 IntelliJ IDEA SDK 查找 Kotlin 编译器：`plugins/Kotlin/kotlinc/lib`。
3. 编译 `src/main/kotlin/**/*.kt` 到 `build/classes/kotlin/main`。
4. `classes` 任务依赖 `compileHelionKotlin`，所以执行 `./gradlew classes`、`./gradlew build` 或 `./gradlew buildPlugin` 都会自动编译 Kotlin 桥接代码。

如果首次运行时提示找不到 `IDEA 2025.3.3 SDK`，先执行一次：

```bash
./gradlew buildPlugin
```

让 IntelliJ Platform Gradle 插件下载 IDE SDK 后再重试。

## 说明

这个目录不是 VS Code 插件的一键转换，而是 JetBrains 平台的原生实现。前端复用 VS Code 版的 `assistant.js` / `assistant.css`，后端通过 JCEF bridge + `postMessage` 协议对接 IntelliJ Platform API。后续可以继续增强：

- 基于 JetBrains PSI 的更精确的代码分析和上下文提取
- 变更审查的 Git 分支 / Staging 集成
- 与 JetBrains VFS 和 FileEditor 更深的集成（多标签 Diff、Inlay Hints 等）
- 历史对话的持久化存储（当前仅在内存中保留会话期间的记录）
