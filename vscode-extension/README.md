# HelionCoder VS Code 插件

这个插件会从 VS Code 调用本地 `helion-coder` CLI。

## 功能

- 活动栏助手面板，支持聊天式代码任务。
- 命令面板可直接询问 HelionCoder、解释当前选区。
- 行内补全会把当前文档上下文发送给本地 CLI。
- 自动检测 `../dist/helion-coder`、`../dist/cli.mjs` 或 `PATH` 中的 `helion-coder`。
- 模型选择器会从 VS Code 设置、环境变量、HelionCoder 配置文件和 OpenAI 兼容 `/models` 读取模型。

## 开发

```bash
cd vscode-extension
npm install
npm run compile
```

然后在 VS Code 中打开此目录，按 `F5` 启动插件开发宿主。

如果没有自动检测到 CLI，可手动设置：

```json
{
  "helionCoder.executablePath": "/absolute/path/to/dist/helion-coder"
}
```

## 模型选择

使用 `HelionCoder: 选择模型`，或在 HelionCoder 侧边栏下方的模型下拉框选择。

选中的模型会这样传给 CLI：

```bash
helion-coder --model <model> -p "..."
```

留空或选择 `CLI 默认` 时，由 CLI 使用自己的默认模型解析。

可在设置中添加额外模型：

```json
{
  "helionCoder.models": ["gpt-5.4", "gpt-5.4-mini", "your-custom-model"]
}
```
