import * as vscode from 'vscode';
import { HelionCli, getWorkspaceCwd } from './cli';
import { HelionInlineCompletionProvider } from './completion';
import { buildContextPrompt, getEditorSnapshot } from './editorContext';
import { ModelResolver } from './modelResolver';
import { HelionAssistantViewProvider } from './webview';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('HelionCoder');
  const cli = new HelionCli(context, output);
  const modelResolver = new ModelResolver(output);
  const assistantView = new HelionAssistantViewProvider(
    context,
    cli,
    output,
    modelResolver,
  );
  const inlineCompletionProvider = new HelionInlineCompletionProvider(cli);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 91);
  status.name = 'HelionCoder';
  status.text = '$(sparkle) Helion';
  status.tooltip = '打开 HelionCoder 面板';
  status.command = 'helionCoder.openPanel';
  status.show();

  context.subscriptions.push(
    output,
    status,
    vscode.window.registerWebviewViewProvider(
      HelionAssistantViewProvider.viewType,
      assistantView,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      inlineCompletionProvider,
    ),
    inlineCompletionProvider,
    vscode.commands.registerCommand('helionCoder.openPanel', () => {
      assistantView.reveal();
    }),
    vscode.commands.registerCommand('helionCoder.ask', async () => {
      const prompt = await vscode.window.showInputBox({
        title: '询问 HelionCoder',
        prompt: '向本地 HelionCoder CLI 发送提示词。',
      });
      if (!prompt) {
        return;
      }

      await runCommandPrompt(cli, output, prompt, '命令面板提问');
    }),
    vscode.commands.registerCommand('helionCoder.explainSelection', async () => {
      const snapshot = getEditorSnapshot(8000, 2500);
      if (!snapshot?.selection.trim()) {
        void vscode.window.showWarningMessage('请先选择代码，再运行“解释选区”。');
        return;
      }

      await runCommandPrompt(
        cli,
        output,
        '解释选中的代码。请包含行为、重要依赖和潜在风险。',
        '解释选区',
      );
    }),
    vscode.commands.registerCommand('helionCoder.completeNow', async () => {
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }),
    vscode.commands.registerCommand('helionCoder.selectModel', async () => {
      const model = await modelResolver.pickModel();
      assistantView.refresh();
      if (model === undefined) {
        void vscode.window.showInformationMessage('HelionCoder 模型已重置为命令行默认值。');
      } else {
        void vscode.window.showInformationMessage(`HelionCoder 模型已设置为 ${model}。`);
      }
    }),
    vscode.commands.registerCommand('helionCoder.refreshModels', async () => {
      const models = await modelResolver.listModels({ refreshApi: true });
      assistantView.refresh();
      void vscode.window.showInformationMessage(
        `已检测到 ${models.length} 个 HelionCoder 模型选项。`,
      );
    }),
    vscode.commands.registerCommand('helionCoder.configureExecutable', async () => {
      const current = vscode.workspace
        .getConfiguration('helionCoder')
        .get<string>('executablePath', '');
      const value = await vscode.window.showInputBox({
        title: 'HelionCoder CLI 可执行文件',
        prompt: 'dist/helion-coder 或 dist/cli.mjs 的绝对路径。留空自动检测。',
        value: current,
      });
      if (value === undefined) {
        return;
      }

      await vscode.workspace
        .getConfiguration('helionCoder')
        .update('executablePath', value.trim(), vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage('HelionCoder 可执行文件设置已更新。');
    }),
    vscode.commands.registerCommand('helionCoder.showOutput', () => {
      output.show();
    }),
  );
}

export function deactivate(): void {}

async function runCommandPrompt(
  cli: HelionCli,
  output: vscode.OutputChannel,
  prompt: string,
  purpose: string,
): Promise<void> {
  output.show(true);
  const cts = new vscode.CancellationTokenSource();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'HelionCoder 正在运行',
      cancellable: true,
    },
    async (_progress, token) => {
      token.onCancellationRequested(() => cts.cancel());
      try {
        const finalPrompt = buildContextPrompt(prompt, purpose);
        const result = await cli.runPrompt(finalPrompt, {
          cwd: getWorkspaceCwd(),
          timeoutMs: 0,
          cancellation: cts.token,
        });
        output.appendLine('');
        output.appendLine('--- HelionCoder 回复 ---');
        output.appendLine(result.stdout.trim());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(message);
        void vscode.window.showErrorMessage(message);
      } finally {
        cts.dispose();
      }
    },
  );
}
