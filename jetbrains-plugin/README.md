# HelionCoder JetBrains 插件

这是从现有 `vscode-extension/` 迁移出来的 JetBrains IDE 插件骨架，功能模式与 VS Code 版一致：通过本地 `helion-coder` CLI 完成助手问答和代码上下文任务。

## 已实现

- `Tools | HelionCoder | 打开助手面板`
- `Tools | HelionCoder | 询问 HelionCoder`
- `Tools | HelionCoder | 解释选区`
- `Tools | HelionCoder | 编译项目并询问 HelionCoder`
- `Tools | HelionCoder | 配置 CLI 可执行文件`
- 右侧 Tool Window 聊天面板，使用 JCEF WebView，方便继续对齐 VS Code 版对话框样式和交互
- 自动检测项目 `dist/helion-coder`、`dist/cli.mjs`、插件目录 `bin/helion-coder` / `bin/cli.mjs`，或 PATH 中的 `helion-coder`
- 基础设置页：`Settings | Tools | HelionCoder`

## 开发

```bash
cd jetbrains-plugin
./gradlew runIde
```

当前仓库没有 Gradle Wrapper。如果本机已有 Gradle，也可以先运行：

```bash
cd jetbrains-plugin
gradle wrapper --gradle-version 8.14.3
./gradlew runIde
```

打包：

```bash
./gradlew buildPlugin
```

产物会生成在 `build/distributions/`。

## 说明

这个目录不是 VS Code 插件的一键转换，而是 JetBrains 平台的原生实现。后续可以继续补齐：

- 行内补全 Provider
- 模型选择器
- 完整复用 `vscode-extension/media/assistant.css`、`assistant.js` 的菜单、附件、历史、权限和流式输出交互
- 与 JetBrains PSI / VFS / Diff Viewer 更深的集成
