import * as vscode from 'vscode';
import { HelionCli, getWorkspaceCwd } from './cli';
import { buildContextPrompt, getEditorSnapshot } from './editorContext';
import { ModelResolver } from './modelResolver';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'ask'; prompt: string; mode?: string }
  | { type: 'quickAction'; action: string }
  | { type: 'insertText'; text: string }
  | { type: 'stop' }
  | { type: 'selectModel'; model: string }
  | { type: 'selectEffort'; effort: string }
  | { type: 'refreshModels' }
  | { type: 'configureExecutable' }
  | { type: 'showOutput' };

export class HelionAssistantViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'helionCoder.assistantView';

  private view?: vscode.WebviewView;
  private runCts?: vscode.CancellationTokenSource;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cli: HelionCli,
    private readonly output: vscode.OutputChannel,
    private readonly modelResolver: ModelResolver,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      message => void this.handleMessage(message as WebviewMessage),
      undefined,
      this.context.subscriptions,
    );
  }

  reveal(): void {
    void vscode.commands.executeCommand(`${HelionAssistantViewProvider.viewType}.focus`);
  }

  post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  refresh(): void {
    void this.refreshContext();
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.refreshContext();
        return;
      case 'ask':
        await this.runAssistantPrompt(message.prompt, message.mode ?? 'ask');
        return;
      case 'quickAction':
        await this.runQuickAction(message.action);
        return;
      case 'insertText':
        await this.insertText(message.text);
        return;
      case 'stop':
        this.runCts?.cancel();
        return;
      case 'selectModel':
        await this.modelResolver.setSelectedModel(
          message.model === 'default' ? undefined : message.model,
        );
        await this.refreshContext(true);
        return;
      case 'selectEffort':
        await vscode.workspace
          .getConfiguration('helionCoder')
          .update(
            'effort',
            message.effort === 'auto' ? '' : message.effort,
            vscode.ConfigurationTarget.Global,
          );
        await this.refreshContext();
        return;
      case 'refreshModels':
        await this.refreshContext(true);
        return;
      case 'configureExecutable':
        await vscode.commands.executeCommand('helionCoder.configureExecutable');
        return;
      case 'showOutput':
        this.output.show();
        return;
    }
  }

  private async runQuickAction(action: string): Promise<void> {
    const snapshot = getEditorSnapshot(8000, 3500);
    const selected = snapshot?.selection?.trim();
    const prompts: Record<string, string> = {
      explain: selected
        ? '解释选中的代码，重点说明意图、副作用和风险。'
        : '解释光标附近的当前文件，重点说明意图、副作用和风险。',
      fix: selected
        ? '查找选中代码中的问题，并提出最小修复补丁。'
        : '查找光标附近可能存在的问题，并提出最小修复补丁。',
      tests: selected
        ? '为选中代码编写聚焦测试，并说明文件名和测试用例。'
        : '为光标附近的当前代码编写聚焦测试，并说明文件名和测试用例。',
      complete:
        '建议光标位置下一步应写的代码。先返回可插入内容，再给出简短说明。',
    };

    await this.runAssistantPrompt(prompts[action] ?? action, action);
  }

  private async runAssistantPrompt(prompt: string, mode: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    this.runCts?.cancel();
    this.runCts = new vscode.CancellationTokenSource();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const finalPrompt = buildContextPrompt(trimmed, mode);

    this.post({
      type: 'run-start',
      requestId,
      mode,
      prompt: trimmed,
    });

    try {
      const result = await this.cli.runPrompt(finalPrompt, {
        cwd: getWorkspaceCwd(),
        timeoutMs: 0,
        cancellation: this.runCts.token,
        onStdout: chunk =>
          this.post({
            type: 'run-chunk',
            requestId,
            stream: 'stdout',
            chunk,
          }),
        onStderr: chunk =>
          this.post({
            type: 'run-chunk',
            requestId,
            stream: 'stderr',
            chunk,
          }),
      });

      this.post({
        type: 'run-done',
        requestId,
        text: result.stdout.trim(),
      });
    } catch (error) {
      this.post({
        type: 'run-error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.runCts?.dispose();
      this.runCts = undefined;
      await this.refreshContext();
    }
  }

  private async refreshContext(refreshApi = false): Promise<void> {
    const snapshot = getEditorSnapshot(1600, 400);
    const resolved = await this.cli.resolve().catch(error => ({
      label: error instanceof Error ? error.message : '未解析',
    }));
    const models = await this.modelResolver.listModels({ refreshApi });
    const selectedModel = this.modelResolver.getSelectedModel() ?? 'default';
    const effort =
      vscode.workspace.getConfiguration('helionCoder').get<string>('effort', '').trim() ||
      'auto';

    this.post({
      type: 'context',
      file: snapshot?.relativePath ?? '没有活动编辑器',
      language: snapshot?.languageId ?? '-',
      selectedChars: snapshot?.selection.length ?? 0,
      cli: resolved.label,
      model: selectedModel,
      effort,
      models,
    });
  }

  private async insertText(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || text.length === 0) {
      return;
    }

    await editor.edit(edit => {
      edit.insert(editor.selection.active, text);
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.css'),
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'helion-logo.svg'),
    );
    const wordmarkUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'helion-logo-wordmark.png'),
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>HelionCoder</title>
</head>
<body>
  <main class="shell">
    <header class="tabbar" aria-label="助手标签页">
      <button type="button" class="tab">聊天</button>
      <button type="button" class="tab">GEMINI CODE ASSIST</button>
      <button type="button" class="tab">CODEX</button>
      <button type="button" class="tab active">HELION</button>
    </header>

    <section class="workspace-head">
      <div class="brand-lockup">
        <div class="mark" aria-hidden="true">
          <img class="mark-img" src="${logoUri}" alt="">
        </div>
        <div>
          <p class="eyebrow">HELIONCODER</p>
          <h1>代码协作面板</h1>
        </div>
      </div>
      <button class="icon-button" id="showOutput" title="显示输出">⌁</button>
    </section>

    <section class="task-panel" aria-label="Helion 任务">
      <button type="button" class="task-card" data-action="fix">
        <span class="task-dot"></span>
        <span>修复当前选区的问题</span>
      </button>
      <button type="button" class="task-card" data-action="explain">
        <span class="task-dot"></span>
        <span>解释当前文件或选区</span>
      </button>
      <button type="button" class="task-card" data-action="tests">
        <span class="task-dot"></span>
        <span>为这段代码生成测试</span>
      </button>
      <button type="button" class="task-card" data-action="complete">
        <span class="task-dot"></span>
        <span>补全光标位置的代码</span>
      </button>
    </section>

    <section class="timeline" id="timeline" aria-live="polite">
      <article class="empty-state">
        <img class="empty-logo" src="${wordmarkUri}" alt="Helion">
        <h2>开始一个 Helion 任务</h2>
        <p>选择上方任务或直接输入需求。HelionCoder 会带上当前 IDE 上下文、模型和推理强度设置运行。</p>
      </article>
    </section>

    <form class="composer" id="composer">
      <textarea id="prompt" rows="3" placeholder="询问 HelionCoder，或让它修改、解释、测试当前代码..."></textarea>
      <div class="composer-actions">
        <button type="button" class="ghost" id="stop">停止</button>
        <button type="submit" class="send">发送</button>
      </div>
    </form>

    <footer class="control-strip" aria-label="助手控制">
      <label class="control-pill model-pill" for="modelSelect">
        <span>模型</span>
        <select id="modelSelect" aria-label="HelionCoder 模型">
          <option value="default">CLI 默认</option>
        </select>
      </label>
      <label class="control-pill effort-pill" for="effortSelect">
        <span>强度</span>
        <select id="effortSelect" aria-label="HelionCoder 推理强度">
          <option value="auto">自动</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
          <option value="max">最大</option>
        </select>
      </label>
      <div class="context-pill" title="IDE 上下文">
        <strong>IDE 上下文</strong>
        <span id="contextFile">没有活动编辑器</span>
        <small><span id="contextLanguage">-</span> · <span id="contextSelection">0 字符</span></small>
      </div>
      <div class="cli-pill" title="CLI">
        <strong id="cliLabel">正在解析…</strong>
      </div>
      <button type="button" class="tool-button" id="refreshModels">刷新</button>
      <button type="button" class="tool-button" id="configure">配置</button>
    </footer>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
