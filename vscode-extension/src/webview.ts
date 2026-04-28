import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  HelionCli,
  type PermissionResponseInput,
  type RunPromptController,
  type ToolStepEvent,
  type TokenUsage,
  getWorkspaceCwd,
} from './cli';
import {
  buildCompactedContextPrompt,
  buildContextPrompt,
  getEditorSnapshot,
} from './editorContext';
import { ModelResolver } from './modelResolver';

type WebviewMessage =
  | { type: 'ready' }
  | {
      type: 'ask';
      prompt: string;
      mode?: string;
      displayPrompt?: string;
      editPrompt?: string;
      attachments?: AttachmentDisplay[];
    }
  | {
      type: 'sideQuestion';
      question: string;
      displayPrompt?: string;
    }
  | {
      type: 'permissionResponse';
      requestId: string;
      response: PermissionResponseInput;
    }
  | { type: 'quickAction'; action: string }
  | { type: 'insertText'; text: string }
  | { type: 'pickMention'; mention: 'file' | 'workspace' | 'selection' | 'terminal' }
  | { type: 'attachFile' }
  | { type: 'attachDroppedUris'; uris: string[] }
  | { type: 'selectPermission'; mode: PermissionMode }
  | { type: 'selectThinking'; mode: ThinkingMode }
  | { type: 'toggleIncludeContext'; value: boolean }
  | { type: 'togglePlanMode'; value: boolean }
  | { type: 'showPlugins' }
  | { type: 'showHistory' }
  | { type: 'acceptChanges'; reviewId: string }
  | { type: 'rejectChanges'; reviewId: string }
  | { type: 'openChanges'; reviewId: string }
  | { type: 'openChange'; reviewId: string; index: number }
  | { type: 'openStepFile'; path: string; line?: number }
  | { type: 'openRecentHistory'; id: string }
  | { type: 'newConversation' }
  | { type: 'stop' }
  | { type: 'selectModel'; model: string }
  | { type: 'selectEffort'; effort: string }
  | { type: 'refreshModels' }
  | { type: 'configureApi' }
  | { type: 'configureExecutable' }
  | { type: 'showOutput' };

type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan';
type ThinkingMode = '' | 'enabled' | 'adaptive' | 'disabled';

interface ReviewChange {
  filePath: string;
  relativePath: string;
  kind: ReviewChangeKind;
  before: string | undefined;
  after: string;
}

type ReviewChangeKind = 'created' | 'modified' | 'deleted';

interface ReviewSession {
  id: string;
  changes: ReviewChange[];
}

interface AttachmentDisplay {
  kind: 'file' | 'image' | 'workspace';
  label: string;
  src?: string;
  path?: string;
  token?: string;
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: number;
}

export class HelionAssistantViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'helionCoder.assistantView';

  private view?: vscode.WebviewView;
  private runCts?: vscode.CancellationTokenSource;
  private activeRunController?: RunPromptController;
  private currentSessionId?: string;
  private conversation: HistoryMessage[] = [];
  private readonly recentHistoryEntries = new Map<string, HistoryEntry>();
  private readonly reviewSessions = new Map<string, ReviewSession>();
  private readonly reviewDocuments = new Map<string, string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cli: HelionCli,
    private readonly output: vscode.OutputChannel,
    private readonly modelResolver: ModelResolver,
  ) {
    this.conversation = this.loadConversation();
    this.currentSessionId = this.context.workspaceState.get<string>(this.sessionStorageKey());
    this.context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('helion-review', {
        provideTextDocumentContent: uri => this.reviewDocuments.get(uri.toString()) ?? '',
      }),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.file(os.homedir()),
        ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? []),
      ],
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
        this.restoreConversationInView();
        return;
      case 'ask':
        await this.runAssistantPrompt(
          message.prompt,
          message.mode ?? 'ask',
          message.displayPrompt,
          message.attachments,
          message.editPrompt,
        );
        return;
      case 'sideQuestion':
        this.runSideQuestion(message.question, message.displayPrompt);
        return;
      case 'permissionResponse':
        this.respondToPermission(message.requestId, message.response);
        return;
      case 'quickAction':
        await this.runQuickAction(message.action);
        return;
      case 'insertText':
        await this.insertText(message.text);
        return;
      case 'pickMention':
        await this.pickMention(message.mention);
        return;
      case 'attachFile':
        await this.attachFile();
        return;
      case 'attachDroppedUris':
        await this.attachDroppedUris(message.uris);
        return;
      case 'selectPermission':
        await this.setPermissionMode(message.mode);
        return;
      case 'selectThinking':
        await this.setThinkingMode(message.mode);
        return;
      case 'toggleIncludeContext':
        await this.setIncludeContext(message.value);
        return;
      case 'togglePlanMode':
        await this.setPlanMode(message.value);
        return;
      case 'showPlugins':
        await this.showPlugins();
        return;
      case 'showHistory':
        await this.showHistory();
        return;
      case 'acceptChanges':
        this.acceptChanges(message.reviewId);
        return;
      case 'rejectChanges':
        await this.rejectChanges(message.reviewId);
        return;
      case 'openChanges':
        await this.openChanges(message.reviewId);
        return;
      case 'openChange':
        await this.openChange(message.reviewId, message.index);
        return;
      case 'openStepFile':
        await this.openStepFile(message.path, message.line);
        return;
      case 'openRecentHistory':
        await this.openRecentHistory(message.id);
        return;
      case 'newConversation':
        this.newConversation();
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
      case 'configureApi':
        await this.configureApi();
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
    if (action === 'complete') {
      await this.triggerInlineCompletion();
      return;
    }

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
      review: selected
        ? '以代码审查方式检查选中代码。优先列出 bug、回归风险、安全风险和缺失测试。'
        : '以代码审查方式检查当前文件附近代码。优先列出 bug、回归风险、安全风险和缺失测试。',
      refactor: selected
        ? '重构选中代码，目标是降低复杂度并保持行为不变。给出最小补丁方案。'
        : '建议当前文件附近代码的最小重构，目标是降低复杂度并保持行为不变。',
      docs: selected
        ? '为选中代码补充必要文档或注释，只保留能降低理解成本的内容。'
        : '为当前文件附近代码补充必要文档或注释，只保留能降低理解成本的内容。',
      optimize: selected
        ? '分析选中代码的性能和资源使用问题，给出可验证的优化建议。'
        : '分析当前文件附近代码的性能和资源使用问题，给出可验证的优化建议。',
    };

    await this.runAssistantPrompt(prompts[action] ?? action, action);
  }

  private async triggerInlineCompletion(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage('请先打开一个文件，再运行 /complete。');
      return;
    }

    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      selection: editor.selection,
      preserveFocus: false,
    });
    await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
  }

  private async runAssistantPrompt(
    prompt: string,
    mode: string,
    displayPrompt?: string,
    attachments: AttachmentDisplay[] = [],
    editPrompt?: string,
  ): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    this.runCts?.cancel();
    this.runCts = new vscode.CancellationTokenSource();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const config = vscode.workspace.getConfiguration('helionCoder');
    const permissionMode = config.get<PermissionMode>('permissionMode', 'default');
    const thinkingMode = config.get<ThinkingMode>('thinking', '');
    const planMode =
      config.get<boolean>('webview.planMode', false) || permissionMode === 'plan';
    const imageContext = await this.materializeImageAttachmentRefs(attachments);
    const promptWithAttachments = [imageContext.prompt, trimmed].filter(Boolean).join('\n\n');
    const promptWithConversation = this.buildConversationPrompt(promptWithAttachments);
    const effectiveMode = planMode ? 'plan' : mode;
    const promptForMode = planMode
      ? [
          'Plan mode is enabled. Do not modify files or run write operations.',
          'Return a concrete numbered implementation plan and list files you would inspect or change.',
          promptWithConversation,
        ].join('\n\n')
      : promptWithConversation;
    const finalPrompt = buildContextPrompt(promptForMode, effectiveMode);
    const beforeSnapshot = await snapshotWorkspaceFiles();

    this.post({
      type: 'run-start',
      requestId,
      mode: effectiveMode,
      prompt: displayPrompt?.trim() || trimmed,
      editPrompt: editPrompt?.trim() ?? displayPrompt?.trim() ?? trimmed,
      attachments,
    });

    try {
      let result = await this.runCliPrompt(finalPrompt, requestId, {
        permissionMode,
        thinkingMode,
        planMode,
        addDirs: imageContext.addDirs,
      });

      if (shouldCompactBeforeRetry(result.stderr || result.stdout || finalPrompt)) {
        this.post({
          type: 'run-compact',
          requestId,
        });
        const compactedPrompt = buildCompactedContextPrompt(promptForMode, effectiveMode);
        result = await this.runCliPrompt(compactedPrompt, requestId, {
          permissionMode,
          thinkingMode,
          planMode,
          addDirs: imageContext.addDirs,
        });
      }

      const review = planMode
        ? undefined
        : await this.createReviewSession(beforeSnapshot);
      this.currentSessionId = result.sessionId ?? this.currentSessionId;
      await this.persistSessionId();
      await this.recordConversationTurn(promptWithAttachments, result.stdout.trim());

      this.post({
        type: 'run-done',
        requestId,
        text: result.stdout.trim(),
        usage: result.usage,
        plan: planMode ? parsePlan(result.stdout) : undefined,
        review: review
          ? {
              id: review.id,
              files: review.changes.map(change => ({
                path: change.relativePath,
                kind: change.kind,
                kindLabel: reviewChangeKindLabel(change.kind),
                ...reviewChangeSummary(change),
              })),
              fileCount: review.changes.length,
            }
          : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        shouldCompactBeforeRetry(message) &&
        !this.runCts?.token.isCancellationRequested
      ) {
        try {
          this.post({
            type: 'run-compact',
            requestId,
          });
          const compactedPrompt = buildCompactedContextPrompt(promptForMode, effectiveMode);
          const result = await this.runCliPrompt(compactedPrompt, requestId, {
            permissionMode,
            thinkingMode,
            planMode,
            addDirs: imageContext.addDirs,
          });
          const review = planMode
            ? undefined
            : await this.createReviewSession(beforeSnapshot);
          this.currentSessionId = result.sessionId ?? this.currentSessionId;
          await this.persistSessionId();
          await this.recordConversationTurn(promptWithAttachments, result.stdout.trim());
          this.post({
            type: 'run-done',
            requestId,
            text: result.stdout.trim(),
            usage: result.usage,
            plan: planMode ? parsePlan(result.stdout) : undefined,
            review: review
              ? {
                  id: review.id,
                  files: review.changes.map(change => ({
                    path: change.relativePath,
                    kind: change.kind,
                    kindLabel: reviewChangeKindLabel(change.kind),
                    ...reviewChangeSummary(change),
                  })),
                  fileCount: review.changes.length,
                }
              : undefined,
          });
          return;
        } catch (retryError) {
          this.post({
            type: 'run-error',
            requestId,
            message: retryError instanceof Error ? retryError.message : String(retryError),
          });
          return;
        }
      }
      this.post({
        type: 'run-error',
        requestId,
        message,
      });
    } finally {
      this.activeRunController = undefined;
      this.runCts?.dispose();
      this.runCts = undefined;
      await this.refreshContext();
    }
  }

  private buildConversationPrompt(userPrompt: string): string {
    const context = formatConversationContext(this.conversation, {
      maxMessages: 18,
      maxChars: 32_000,
    });
    if (!context) {
      return userPrompt;
    }

    return [
      context,
      'Current user request:',
      userPrompt,
    ].join('\n\n');
  }

  private async recordConversationTurn(userText: string, assistantText: string): Promise<void> {
    const now = Date.now();
    this.conversation.push({
      role: 'user',
      text: trimConversationText(userText, 24_000),
      timestamp: now,
    });
    this.conversation.push({
      role: 'assistant',
      text: trimConversationText(assistantText, 32_000),
      timestamp: Date.now(),
    });
    this.conversation = trimConversationMessages(this.conversation, 120, 220_000);
    await this.persistConversation();
    await this.persistNativeHistoryTurn(userText, assistantText, now);
  }

  private restoreConversationInView(): void {
    if (this.conversation.length === 0) {
      return;
    }
    this.post({
      type: 'conversation-restored',
      title: '当前对话',
      messages: this.conversation,
    });
  }

  private loadConversation(): HistoryMessage[] {
    const stored = this.context.workspaceState.get<HistoryMessage[]>(
      this.conversationStorageKey(),
      [],
    );
    return trimConversationMessages(sanitizeConversationMessages(stored), 120, 220_000);
  }

  private async persistConversation(): Promise<void> {
    await this.context.workspaceState.update(
      this.conversationStorageKey(),
      trimConversationMessages(this.conversation, 120, 220_000),
    );
  }

  private async persistNativeHistoryTurn(
    userText: string,
    assistantText: string,
    timestamp: number,
  ): Promise<void> {
    const sessionId = this.currentSessionId ?? crypto.randomUUID();
    this.currentSessionId = sessionId;
    await this.persistSessionId();
    appendNativeHistoryTurn({
      cwd: getWorkspaceCwd(),
      sessionId,
      userText,
      assistantText,
      timestamp,
    });
  }

  private async persistSessionId(): Promise<void> {
    await this.context.workspaceState.update(this.sessionStorageKey(), this.currentSessionId);
  }

  private conversationStorageKey(): string {
    return `helionCoder.currentConversation:${getWorkspaceCwd()}`;
  }

  private sessionStorageKey(): string {
    return `helionCoder.currentSessionId:${getWorkspaceCwd()}`;
  }

  private async pickMention(
    mention: 'file' | 'workspace' | 'selection' | 'terminal',
  ): Promise<void> {
    if (mention === 'selection') {
      const snapshot = getEditorSnapshot(1600, 400);
      if (!snapshot?.selection.trim()) {
        void vscode.window.showWarningMessage('当前编辑器没有选区。');
        this.post({ type: 'mention-cancelled' });
        return;
      }
      this.post({ type: 'mention-picked', text: '@selection' });
      return;
    }

    if (mention === 'terminal') {
      this.post({
        type: 'mention-picked',
        text: '请分析下面的 @terminal 输出，并给出根因和修复步骤：\n',
      });
      return;
    }

    if (mention === 'workspace') {
      const folder = await this.pickWorkspaceFolder();
      if (!folder) {
        this.post({ type: 'mention-cancelled' });
        return;
      }
      this.post({
        type: 'mention-picked',
        text: `@workspace("${escapeMentionPath(this.workspaceTokenPath(folder.uri.fsPath))}")`,
        label: folder.name,
        kind: 'workspace',
      });
      return;
    }

    const file = await this.pickWorkspaceFile();
    if (!file) {
      this.post({ type: 'mention-cancelled' });
      return;
    }
    this.post({
      type: 'mention-picked',
      text: looksBinary(file.fsPath) ? '' : `@file("${escapeMentionPath(this.fileTokenPath(file.fsPath))}")`,
      label: path.basename(file.fsPath),
      kind: isImageFile(file.fsPath) ? 'image' : 'file',
      src: isImageFile(file.fsPath) ? this.view?.webview.asWebviewUri(file).toString() : undefined,
      path: file.fsPath,
    });
  }

  private postFileAttachment(file: vscode.Uri): void {
    const binary = looksBinary(file.fsPath);
    const image = isImageFile(file.fsPath);
    this.post({
      type: 'mention-picked',
      text: binary ? '' : `@file("${escapeMentionPath(this.fileTokenPath(file.fsPath))}")`,
      label: path.basename(file.fsPath),
      kind: image ? 'image' : 'file',
      src: image ? this.view?.webview.asWebviewUri(file).toString() : undefined,
      path: file.fsPath,
    });
  }

  private async pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage('当前 VS Code 窗口没有打开工作区。');
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(
      folders.map(folder => ({
        label: folder.name,
        description: folder.uri.fsPath,
        folder,
      })),
      {
        title: '选择 HelionCoder 工作区上下文',
        placeHolder: '选择要附带项目结构的工作区',
      },
    );

    return picked?.folder;
  }

  private async pickWorkspaceFile(): Promise<vscode.Uri | undefined> {
    const active = vscode.window.activeTextEditor?.document.uri;
    const files = await vscode.workspace.findFiles(
      '**/*',
      '**/{.git,node_modules,dist,out,build,.next,coverage,vendor}/**',
      500,
    );
    const sorted = files
      .filter(uri => uri.scheme === 'file')
      .filter(uri => !looksBinary(uri.fsPath))
      .sort((left, right) => this.fileTokenPath(left.fsPath).localeCompare(this.fileTokenPath(right.fsPath)));

    const picks = sorted.map(uri => {
      const relative = this.fileTokenPath(uri.fsPath);
      return {
        label: relative,
        description: uri.fsPath === active?.fsPath ? '当前文件' : undefined,
        uri,
      };
    });

    const picked = await vscode.window.showQuickPick(picks, {
      title: '选择 HelionCoder 文件上下文',
      placeHolder: '选择要附带内容的文件',
      matchOnDescription: true,
    });

    return picked?.uri;
  }

  private async attachFile(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      title: '添加文件到 HelionCoder 上下文',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    if (!files || files.length === 0) {
      this.post({ type: 'mention-cancelled' });
      return;
    }

    for (const file of files) {
      this.postFileAttachment(file);
    }
  }

  private async attachDroppedUris(uris: string[]): Promise<void> {
    let attached = 0;
    for (const value of uris) {
      const uri = parseDroppedFileUri(value);
      if (!uri) {
        continue;
      }

      try {
        const stat = fs.statSync(uri.fsPath);
        if (stat.isDirectory()) {
          this.post({
            type: 'mention-picked',
            text: `@workspace("${escapeMentionPath(this.workspaceTokenPath(uri.fsPath))}")`,
            label: path.basename(uri.fsPath),
            kind: 'workspace',
            path: uri.fsPath,
          });
          attached += 1;
        } else if (stat.isFile()) {
          this.postFileAttachment(uri);
          attached += 1;
        }
      } catch {
        // Ignore stale or inaccessible dragged URIs.
      }
    }

    if (attached === 0) {
      this.post({ type: 'mention-cancelled' });
    }
  }

  private async materializeImageAttachmentRefs(
    attachments: AttachmentDisplay[],
  ): Promise<{ prompt: string; addDirs: string[] }> {
    const refs: string[] = [];
    const addDirs = new Set<string>();
    for (const attachment of attachments) {
      if (attachment.kind !== 'image') {
        continue;
      }

      const imagePath = await this.resolveImageAttachmentPath(attachment);
      if (imagePath) {
        refs.push(`@"${escapeAtMentionPath(imagePath)}"`);
        addDirs.add(path.dirname(imagePath));
      }
    }

    if (refs.length === 0) {
      return { prompt: '', addDirs: [] };
    }

    return {
      prompt: [
        '图片上下文：',
        refs.join(' '),
        '这些图片目录已通过 --add-dir 授权读取。请读取这些图片后再回答用户问题。',
      ].join('\n'),
      addDirs: [...addDirs],
    };
  }

  private async resolveImageAttachmentPath(
    attachment: AttachmentDisplay,
  ): Promise<string | undefined> {
    if (attachment.path && isReadableFilePath(attachment.path)) {
      return attachment.path;
    }

    const parsed = parseImageDataUrl(attachment.src ?? '');
    if (!parsed) {
      return undefined;
    }

    const dir = path.join(this.context.globalStorageUri.fsPath, 'image-attachments');
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(
      dir,
      `${Date.now()}-${Math.random().toString(16).slice(2)}-${sanitizeAttachmentName(
        attachment.label || 'image',
      )}.${parsed.extension}`,
    );
    await fs.promises.writeFile(filePath, parsed.data);
    return filePath;
  }

  private async setPermissionMode(mode: PermissionMode): Promise<void> {
    await vscode.workspace
      .getConfiguration('helionCoder')
      .update('permissionMode', mode, vscode.ConfigurationTarget.Global);
    await this.refreshContext();
  }

  private async setThinkingMode(mode: ThinkingMode): Promise<void> {
    await vscode.workspace
      .getConfiguration('helionCoder')
      .update('thinking', mode, vscode.ConfigurationTarget.Global);
    await this.refreshContext();
  }

  private async setIncludeContext(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('helionCoder')
      .update('webview.includeEditorContext', value, vscode.ConfigurationTarget.Global);
    await this.refreshContext();
  }

  private async setPlanMode(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('helionCoder')
      .update('webview.planMode', value, vscode.ConfigurationTarget.Global);
    await this.refreshContext();
  }

  private async showPlugins(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: 'Build Web Apps',
          description: '已启用',
          detail: '前端应用、UI、React、shadcn、Stripe、Supabase 等能力。',
        },
        {
          label: '更多插件',
          description: '打开输出',
          detail: '当前 VS Code 插件先展示可用入口；真正的 CLI 插件管理可继续接入 /plugins。',
        },
      ],
      { title: 'HelionCoder 插件' },
    );
    if (picked?.label === '更多插件') {
      this.output.show();
    }
  }

  private async showHistory(): Promise<void> {
    const entries = readHistoryEntries(getWorkspaceCwd());
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('还没有 HelionCoder 历史对话。');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      entries.map(entry => ({
        label: entry.display,
        description: [
          entry.timestamp ? new Date(entry.timestamp).toLocaleString() : undefined,
          entry.project && path.basename(entry.project),
        ].filter(Boolean).join(' · '),
        detail: entry.sessionId ? `会话：${entry.sessionId}` : entry.project,
        entry,
      })),
      {
        title: 'HelionCoder 历史对话',
        placeHolder: '选择一段历史会话打开',
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );

    if (picked?.entry) {
      await this.loadHistoryEntry(picked.entry);
    }
  }

  private async openRecentHistory(id: string): Promise<void> {
    const entry = this.recentHistoryEntries.get(id);
    if (!entry) {
      void vscode.window.showInformationMessage('这段历史会话已经不可用，请打开历史列表重新选择。');
      return;
    }
    await this.loadHistoryEntry(entry);
  }

  private async loadHistoryEntry(entry: HistoryEntry): Promise<void> {
    const messages = readHistoryConversation(entry);
    if (messages.length === 0) {
      void vscode.window.showInformationMessage('这段历史会话没有可展示的消息。');
      return;
    }
    this.currentSessionId = entry.sessionId;
    this.conversation = trimConversationMessages(messages, 120, 220_000);
    await this.persistSessionId();
    await this.persistConversation();
    this.post({
      type: 'history-loaded',
      title: entry.display,
      sessionId: entry.sessionId,
      messages,
    });
  }

  private async configureApi(): Promise<void> {
    const resolved = await this.cli.resolve();
    const terminal = vscode.window.createTerminal({
      name: 'HelionCoder API 配置',
      cwd: getWorkspaceCwd(),
    });
    terminal.show();
    terminal.sendText(
      [...resolved.argsPrefix, 'api-config']
        .reduce((parts, arg) => [...parts, shellQuote(arg)], [shellQuote(resolved.command)])
        .join(' '),
    );
  }

  private newConversation(): void {
    this.runCts?.cancel();
    this.activeRunController = undefined;
    this.currentSessionId = undefined;
    this.conversation = [];
    void this.persistSessionId();
    void this.persistConversation();
    this.reviewSessions.clear();
    this.reviewDocuments.clear();
    this.post({ type: 'conversation-new' });
  }

  private runSideQuestion(question: string, displayPrompt?: string): void {
    const trimmed = question.trim();
    if (!trimmed) {
      return;
    }

    const requestId = this.activeRunController?.sendSideQuestion(trimmed);
    if (!requestId) {
      this.post({
        type: 'side-question-error',
        requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        question: displayPrompt?.trim() || trimmed,
        message: '当前没有可接收引导的运行中任务。',
      });
      return;
    }

    this.post({
      type: 'side-question-start',
      requestId,
      question: displayPrompt?.trim() || trimmed,
    });
  }

  private respondToPermission(
    requestId: string,
    response: PermissionResponseInput,
  ): void {
    const accepted = this.activeRunController?.sendPermissionResponse(requestId, response);
    if (!accepted) {
      this.post({
        type: 'permission-cancelled',
        requestId,
        message: '这个权限请求已经失效。',
      });
    }
  }

  private async createReviewSession(
    beforeSnapshot: Map<string, string>,
  ): Promise<ReviewSession | undefined> {
    const afterSnapshot = await snapshotWorkspaceFiles();
    const changes: ReviewChange[] = [];

    for (const [filePath, after] of afterSnapshot) {
      const before = beforeSnapshot.get(filePath);
      if (before !== after) {
        changes.push({
          filePath,
          relativePath: this.fileTokenPath(filePath),
          kind: before === undefined ? 'created' : 'modified',
          before,
          after,
        });
      }
    }

    for (const [filePath, before] of beforeSnapshot) {
      if (!afterSnapshot.has(filePath)) {
        changes.push({
          filePath,
          relativePath: this.fileTokenPath(filePath),
          kind: 'deleted',
          before,
          after: '',
        });
      }
    }

    if (changes.length === 0) {
      return undefined;
    }

    const session = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      changes,
    };
    this.reviewSessions.set(session.id, session);
    return session;
  }

  private acceptChanges(reviewId: string): void {
    const review = this.reviewSessions.get(reviewId);
    this.reviewSessions.delete(reviewId);
    this.clearReviewDocuments(reviewId);
    if (review) {
      void vscode.window.showInformationMessage(`已接受 ${review.changes.length} 个文件的本轮修改。`);
    }
    this.post({ type: 'review-cleared', reviewId });
  }

  private async rejectChanges(reviewId: string): Promise<void> {
    const review = this.reviewSessions.get(reviewId);
    if (!review) {
      return;
    }

    for (const change of review.changes) {
      if (change.kind === 'created') {
        if (fs.existsSync(change.filePath)) {
          fs.rmSync(change.filePath, { force: true });
        }
        continue;
      }
      if (change.before === undefined) {
        continue;
      }
      fs.mkdirSync(path.dirname(change.filePath), { recursive: true });
      fs.writeFileSync(change.filePath, change.before, 'utf8');
    }

    this.reviewSessions.delete(reviewId);
    this.clearReviewDocuments(reviewId);
    await vscode.window.showInformationMessage(`已拒绝 ${review.changes.length} 个文件的本轮修改。`);
    this.post({ type: 'review-cleared', reviewId });
  }

  private async openChanges(reviewId: string): Promise<void> {
    const review = this.reviewSessions.get(reviewId);
    if (!review) {
      return;
    }

    for (const [index] of review.changes.slice(0, 6).entries()) {
      await this.openReviewChange(review, index);
    }

    if (review.changes.length > 6) {
      void vscode.window.showInformationMessage(
        `已打开前 6 个文件的修改预览，剩余 ${review.changes.length - 6} 个文件可在变更列表中查看路径。`,
      );
    }
  }

  private async openChange(reviewId: string, index: number): Promise<void> {
    const review = this.reviewSessions.get(reviewId);
    if (!review || !Number.isInteger(index) || index < 0 || index >= review.changes.length) {
      return;
    }
    await this.openReviewChange(review, index);
  }

  private async openReviewChange(review: ReviewSession, index: number): Promise<void> {
    const change = review.changes[index];
    const beforeUri = this.reviewDocumentUri(review.id, index, 'before', change.relativePath);
    const afterUri = this.reviewDocumentUri(review.id, index, 'after', change.relativePath);
    this.reviewDocuments.set(beforeUri.toString(), change.before ?? '');
    this.reviewDocuments.set(afterUri.toString(), change.after);
    await vscode.commands.executeCommand(
      'vscode.diff',
      beforeUri,
      afterUri,
      `HelionCoder: ${reviewChangeKindLabel(change.kind)} ${change.relativePath}`,
      {
        preview: false,
        selection: new vscode.Range(reviewChangeStartLine(change), 0, reviewChangeStartLine(change), 0),
      },
    );
  }

  private reviewDocumentUri(
    reviewId: string,
    index: number,
    side: 'before' | 'after',
    relativePath: string,
  ): vscode.Uri {
    const basename = path.basename(relativePath) || `change-${index}.txt`;
    return vscode.Uri.from({
      scheme: 'helion-review',
      authority: reviewId,
      path: `/${side}/${index}/${basename}`,
    });
  }

  private clearReviewDocuments(reviewId: string): void {
    for (const key of Array.from(this.reviewDocuments.keys())) {
      try {
        if (vscode.Uri.parse(key).authority === reviewId) {
          this.reviewDocuments.delete(key);
        }
      } catch {
        // Ignore malformed keys from older sessions.
      }
    }
  }

  private fileTokenPath(filePath: string): string {
    const cwd = getWorkspaceCwd();
    const relative = path.relative(cwd, filePath);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? normalizeTokenPath(relative)
      : normalizeTokenPath(filePath);
  }

  private workspaceTokenPath(folderPath: string): string {
    const cwd = getWorkspaceCwd();
    const relative = path.relative(cwd, folderPath);
    if (!relative) {
      return '.';
    }
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return normalizeTokenPath(relative);
    }
    return normalizeTokenPath(path.basename(folderPath));
  }

  private async runCliPrompt(
    prompt: string,
    requestId: string,
    options: {
      permissionMode?: string;
      thinkingMode?: string;
      planMode?: boolean;
      addDirs?: string[];
    } = {},
  ) {
    return await this.cli.runPrompt(prompt, {
      cwd: getWorkspaceCwd(),
      timeoutMs: 0,
      cancellation: this.runCts?.token,
      sessionId: this.currentSessionId,
      permissionMode: options.permissionMode,
      thinkingMode: options.thinkingMode,
      planMode: options.planMode,
      addDirs: options.addDirs,
      streamJson: true,
      onController: controller => {
        this.activeRunController = controller;
      },
      onSideQuestion: response => {
        this.post({
          type: response.error ? 'side-question-error' : 'side-question-done',
          requestId: response.requestId,
          text: response.response,
          message: response.error,
        });
      },
      onPermissionRequest: request => {
        this.post({
          type: 'permission-request',
          request,
        });
      },
      onPermissionCancel: requestId => {
        this.post({
          type: 'permission-cancelled',
          requestId,
          message: '这个权限请求已经由其他决策处理。',
        });
      },
      onUsage: usage =>
        this.post({
          type: 'token-usage',
          requestId,
          usage,
        }),
      onToolStep: step =>
        this.post({
          type: 'run-step',
          requestId,
          step: this.serializeToolStep(step),
        }),
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
  }

  private serializeToolStep(step: ToolStepEvent): ToolStepEvent & { fileLabel?: string } {
    return {
      ...step,
      fileLabel: step.filePath ? path.basename(step.filePath) : undefined,
    };
  }

  private async openStepFile(filePath: string, line?: number): Promise<void> {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(getWorkspaceCwd(), filePath);

    try {
      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile()) {
        void vscode.window.showWarningMessage(`无法打开：${path.basename(resolved)} 不是文件。`);
        return;
      }
    } catch {
      void vscode.window.showWarningMessage(`找不到文件：${path.basename(resolved)}`);
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
    const zeroBasedLine = Math.max(0, Math.min(document.lineCount - 1, Math.round((line ?? 1) - 1)));
    const range = new vscode.Range(zeroBasedLine, 0, zeroBasedLine, 0);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      selection: range,
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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
    const config = vscode.workspace.getConfiguration('helionCoder');
    const permissionMode = config.get<PermissionMode>('permissionMode', 'default');
    const thinkingMode = config.get<ThinkingMode>('thinking', '');
    const includeContext = config.get<boolean>('webview.includeEditorContext', true);
    const planMode = config.get<boolean>('webview.planMode', false);
    const contextEstimate = estimateContextWindow(snapshot);
    const historyEntries = readHistoryEntries(getWorkspaceCwd());
    const recentHistory = this.getRecentHistorySummaries();

    this.post({
      type: 'context',
      file: snapshot?.relativePath ?? '没有活动编辑器',
      language: snapshot?.languageId ?? '-',
      selectedChars: snapshot?.selection.length ?? 0,
      cli: resolved.label,
      model: selectedModel,
      effort,
      permissionMode,
      thinkingMode,
      includeContext,
      planMode,
      contextWindow: contextEstimate,
      models,
      recentHistory,
      recentHistoryTotal: historyEntries.length,
    });
  }

  private getRecentHistorySummaries(): Array<{
    id: string;
    title: string;
    timestamp?: number;
    project?: string;
  }> {
    this.recentHistoryEntries.clear();
    return readHistoryEntries(getWorkspaceCwd()).slice(0, 3).map((entry, index) => {
      const id = `${entry.sessionId ?? entry.filePath ?? 'history'}:${index}`;
      this.recentHistoryEntries.set(id, entry);
      return {
        id,
        title: entry.display,
        timestamp: entry.timestamp,
        project: entry.project ? path.basename(entry.project) : undefined,
      };
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
    const markdownUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'markdown-it.min.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'assistant.css'),
    );
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>HelionCoder</title>
</head>
	<body>
	  <main class="shell">
	    <header class="topbar">
	      <div class="header-title">
	        <button type="button" class="header-back" id="backToTasks" title="返回任务">${iconSvg('arrowLeft')}</button>
	        <strong id="headerTitle">任务</strong>
	      </div>
	      <span id="cliLabel" class="sr-only">本地 CLI</span>
	      <div class="top-actions">
	        <button class="icon-button" id="history" title="历史对话">${iconSvg('history')}</button>
	        <button class="icon-button" id="settingsMenu" title="设置">${iconSvg('settings')}</button>
	        <button class="icon-button" id="newConversation" title="新建对话">${iconSvg('edit')}</button>
	      </div>
	    </header>

	    <section class="timeline" id="timeline" aria-live="polite">
	      <article class="empty-state">
	        <div class="welcome">
	          <span>HelionCoder</span>
	            <strong>让 Helion 理解、修改、审查或规划你的工作区。</strong>
	        </div>
	        <div class="release-card">
	          <span>${iconSvg('circleInfo')}</span>
	          <div>
	            <strong>工作区助手</strong>
	            <p>输入 / 选择功能，输入 @ 添加上下文，输入 ? 使用提示模板。</p>
	          </div>
	        </div>
	      </article>
	    </section>

		    <form class="composer" id="composer">
		      <div class="prompt-suggestions" aria-label="可尝试的提示词">
		        <span>可以试试</span>
		        <button type="button" data-prompt="这个仓库是做什么的？帮我理解整体架构。">这个仓库是做什么的？帮我理解整体架构。</button>
		        <button type="button" data-prompt="帮我实现一个用于 [目标] 的应用，界面需要支持用户完成 [任务]。">帮我实现一个用于 [目标] 的应用，界面需要支持用户完成 [任务]...</button>
		      </div>
		      <div class="attachment-tray" id="attachmentTray" hidden></div>
		      <div class="prompt-context-row">
		        <button type="button" class="context-item" title="当前上下文">
		          <span id="contextFile">没有活动编辑器</span>
		          <small id="contextLanguage">-</small>
		          <small id="contextSelection">0 字符</small>
		        </button>
		      </div>
		      <textarea id="prompt" rows="2" placeholder="询问 Helion，或输入 @ 添加上下文"></textarea>
		      <div class="suggest" id="suggest" hidden></div>
		      <div class="composer-actions">
		        <div class="composer-row primary-row">
		          <div class="model-effort-group" title="模型和推理强度">
		            <button type="button" class="model-effort-button" id="modelEffortMenu" title="模型和推理强度">
		              <span id="modelDisplay">默认</span>
		              <span id="effortDisplay">中</span>
		              <span>${iconSvg('chevron')}</span>
		            </button>
		            <label class="inline-select model-select native-model-select" title="模型" hidden>
		              <select id="modelSelect" aria-label="HelionCoder 模型">
		                <option value="default">默认</option>
		              </select>
		            </label>
		            <label class="inline-select compact effort-select native-effort-select" title="推理强度" hidden>
		              <select id="effortSelect" aria-label="HelionCoder 推理强度">
		                <option value="auto">智能</option>
		                <option value="low">低</option>
		                <option value="medium">中</option>
		                <option value="high">高</option>
		                <option value="max">超高</option>
		              </select>
		            </label>
		          </div>
		          <button type="submit" class="send" title="发送">${iconSvg('send')}</button>
		        </div>
		        <div class="composer-row settings-row">
		          <button type="button" class="round-tool" id="addMenu" title="添加上下文">${iconSvg('plus')}</button>
		          <button type="button" class="context-ring" id="contextWindow" title="上下文窗口">
		            <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-bg" cx="12" cy="12" r="8"></circle><circle class="ring-fg" id="contextRing" cx="12" cy="12" r="8"></circle></svg>
		            <span class="sr-only" id="contextWindowPercent">0% used</span>
		            <span class="sr-only" id="contextWindowTokens">0 / 0 tokens used</span>
		          </button>
		          <button type="button" class="mode-chip" id="permissionMenu" title="权限模式">
		            <span id="permissionIcon">${iconSvg('shield')}</span>
		            <span id="permissionLabel">默认</span>
		            <span>${iconSvg('chevron')}</span>
		          </button>
		          <button type="button" class="ghost steer-action" id="guide" title="作为后续引导发送" hidden>${iconSvg('cornerDownRight')} 引导</button>
		          <button type="button" class="ghost run-action" id="stop" hidden>停止</button>
		        </div>
	      </div>
	    </form>

	    <div class="menu-popover" id="addPopover" hidden>
	      <button type="button" data-menu-action="attach">${iconSvg('paperclip')} <span>添加图片和文件</span></button>
	      <button type="button" data-menu-action="toggle-context">${iconSvg('spark')} <span>包含编辑器上下文</span><i id="includeContextSwitch"></i></button>
	      <button type="button" data-menu-action="toggle-plan" id="planToggle">${iconSvg('list')} <span>计划模式</span><i id="planSwitch"></i></button>
	      <button type="button" data-menu-action="plugins">${iconSvg('grid')} <span>插件</span><strong>${iconSvg('chevronRight')}</strong></button>
	    </div>

	    <div class="menu-popover compact-menu" id="permissionPopover" hidden>
	      <button type="button" data-permission-mode="default">${iconSvg('hand')} <span>默认权限</span><strong>${iconSvg('check')}</strong></button>
	      <button type="button" data-permission-mode="acceptEdits">${iconSvg('review')} <span>自动审查</span><strong>${iconSvg('check')}</strong></button>
	      <button type="button" data-permission-mode="bypassPermissions">${iconSvg('alert')} <span>完全访问权限</span><strong>${iconSvg('check')}</strong></button>
	      <button type="button" data-permission-mode="plan">${iconSvg('list')} <span>计划模式</span><strong>${iconSvg('check')}</strong></button>
	    </div>

	    <div class="menu-popover model-effort-popover" id="modelEffortPopover" hidden>
	      <div class="menu-title">智能</div>
	      <button type="button" data-effort-option="low"><span></span><span>低</span><strong>${iconSvg('check')}</strong></button>
	      <button type="button" data-effort-option="medium"><span></span><span>中</span><strong>${iconSvg('check')}</strong></button>
	      <button type="button" data-effort-option="high"><span></span><span>高</span><strong>${iconSvg('check')}</strong></button>
	      <button type="button" data-effort-option="max"><span></span><span>超高</span><strong>${iconSvg('check')}</strong></button>
	      <button type="button" class="has-submenu model-switch-row" id="openModelSubmenu"><span></span><span id="modelMenuLabel">默认</span><strong>${iconSvg('chevronRight')}</strong></button>
	    </div>

	    <div class="menu-popover model-sub-popover" id="modelSubPopover" hidden>
	      <div class="menu-title">切换模型</div>
	      <div class="model-options" id="modelOptions"></div>
	    </div>

	    <div class="menu-popover settings-popover" id="settingsPopover" hidden>
	      <button type="button" data-settings-action="configure-api">${iconSvg('user')} <span>API 设置</span></button>
	      <button type="button" data-settings-action="configure-cli">${iconSvg('settings')} <span>CLI 路径</span></button>
	      <button type="button" data-settings-action="refresh-models">${iconSvg('refresh')} <span>刷新模型</span></button>
	      <button type="button" data-settings-action="output">${iconSvg('terminal')} <span>打开输出</span></button>
	      <button type="button" data-settings-action="plugins">${iconSvg('grid')} <span>插件</span></button>
	    </div>
	  </main>
  <script nonce="${nonce}" src="${markdownUri}"></script>
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

function formatConversationContext(
  messages: HistoryMessage[],
  options: { maxMessages: number; maxChars: number },
): string {
  const selected: string[] = [];
  let remaining = options.maxChars;

  for (const message of messages.slice(-options.maxMessages).reverse()) {
    const role = message.role === 'user' ? 'User' : 'Assistant';
    const text = sanitizeConversationContextText(message.text);
    if (!text) {
      continue;
    }
    const clipped = trimConversationText(text, Math.min(remaining, 8_000));
    const block = `${role}:\n${clipped}`;
    selected.unshift(block);
    remaining -= block.length;
    if (remaining <= 600) {
      break;
    }
  }

  if (selected.length === 0) {
    return '';
  }

  return [
    'Previous conversation context from this VS Code assistant panel.',
    'Use it to resolve follow-up references, but the current user request below has priority.',
    selected.join('\n\n'),
  ].join('\n');
}

function sanitizeConversationMessages(value: unknown): HistoryMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): HistoryMessage | undefined => {
      if (!item || typeof item !== 'object') {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const role: HistoryMessage['role'] | undefined =
        record.role === 'user' || record.role === 'assistant' ? record.role : undefined;
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      if (!role || !text) {
        return undefined;
      }
      return {
        role,
        text,
        ...(typeof record.timestamp === 'number' ? { timestamp: record.timestamp } : {}),
      };
    })
    .filter((item): item is HistoryMessage => item !== undefined);
}

function trimConversationMessages(
  messages: HistoryMessage[],
  maxMessages: number,
  maxChars: number,
): HistoryMessage[] {
  const selected: HistoryMessage[] = [];
  let remaining = maxChars;
  for (const message of messages.slice(-maxMessages).reverse()) {
    const text = trimConversationText(message.text, Math.min(remaining, 40_000));
    if (!text) {
      continue;
    }
    selected.unshift({
      ...message,
      text,
    });
    remaining -= text.length;
    if (remaining <= 0) {
      break;
    }
  }
  return selected;
}

function trimConversationText(value: string, maxChars: number): string {
  const text = value.trim();
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= 80) {
    return text.slice(0, Math.max(0, maxChars)).trim();
  }
  const head = Math.max(0, Math.floor(maxChars * 0.58));
  const tail = Math.max(0, maxChars - head - 28);
  return `${text.slice(0, head)}\n\n...中间内容已省略...\n\n${text.slice(-tail)}`.trim();
}

function shellQuote(value: string): string {
  if (/^[\w./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sanitizeConversationContextText(value: string): string {
  return value
    .replace(/@(?=(file|workspace|selection|terminal)\b)/g, '＠')
    .trim();
}

function normalizeTokenPath(value: string): string {
  return value.split(path.sep).join('/');
}

function escapeMentionPath(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeAtMentionPath(value: string): string {
  return value.replace(/"/g, '\\"');
}

function isReadableFilePath(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseImageDataUrl(value: string): { data: Buffer; extension: string } | undefined {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is);
  if (!match) {
    return undefined;
  }

  return {
    data: Buffer.from(match[2], 'base64'),
    extension: imageExtensionFromMediaType(match[1].toLowerCase()),
  };
}

function imageExtensionFromMediaType(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return 'png';
  }
}

function sanitizeAttachmentName(value: string): string {
  const parsed = path.parse(value);
  const name = (parsed.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  return name || 'image';
}

function parseDroppedFileUri(value: string): vscode.Uri | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const uri = vscode.Uri.parse(trimmed);
    if (uri.scheme === 'file') {
      return uri;
    }
  } catch {
    // Fall through to plain path handling.
  }

  if (path.isAbsolute(trimmed)) {
    return vscode.Uri.file(trimmed);
  }

  return undefined;
}

function shouldCompactBeforeRetry(text: string): boolean {
  if (text.length > 48_000) {
    return true;
  }

  return /context[_ -]?length|maximum context|max context|context window|too many tokens|token limit|exceeds? .*tokens?|prompt .*too long|request too large|input length|上下文|token.*超|长度.*超/i.test(
    text,
  );
}

async function snapshotWorkspaceFiles(): Promise<Map<string, string>> {
  const files = await vscode.workspace.findFiles(
    '**/*',
    '**/{.git,node_modules,dist,out,build,.next,coverage,vendor}/**',
    1000,
  );
  const snapshot = new Map<string, string>();
  for (const uri of files) {
    if (uri.scheme !== 'file' || looksBinary(uri.fsPath)) {
      continue;
    }
    try {
      const stat = fs.statSync(uri.fsPath);
      if (!stat.isFile() || stat.size > 1_000_000) {
        continue;
      }
      snapshot.set(uri.fsPath, fs.readFileSync(uri.fsPath, 'utf8'));
    } catch {
      // Ignore files that disappear while the agent is running.
    }
  }
  return snapshot;
}

function parsePlan(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const numbered = lines
    .filter(line => /^(\d+[.)]|[-*]\s|\[[ x-]\])\s*/i.test(line))
    .map(line => line.replace(/^(\d+[.)]|[-*]\s|\[[ x-]\])\s*/i, '').trim())
    .filter(Boolean);
  return numbered.slice(0, 8);
}

function estimateContextWindow(snapshot: ReturnType<typeof getEditorSnapshot>): {
  used: number;
  total: number;
  percent: number;
} {
  const textLength =
    (snapshot?.selection.length ?? 0) +
    (snapshot?.prefix.length ?? 0) +
    (snapshot?.suffix.length ?? 0);
  const used = Math.max(0, Math.ceil(textLength / 4));
  const total = 258_000;
  return {
    used,
    total,
    percent: Math.min(99, Math.round((used / total) * 100)),
  };
}

function looksBinary(fsPath: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|mp4|mov|woff2?|ttf|eot)$/i.test(fsPath);
}

function isImageFile(fsPath: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(fsPath);
}

interface HistoryEntry {
  display: string;
  timestamp?: number;
  project?: string;
  sessionId?: string;
  filePath?: string;
}

interface NativeHistoryTurn {
  cwd: string;
  sessionId: string;
  userText: string;
  assistantText: string;
  timestamp: number;
}

function appendNativeHistoryTurn(turn: NativeHistoryTurn): void {
  const display = formatNativeHistoryDisplay(turn.userText);
  if (!display || isMetaHistoryText(display)) {
    return;
  }

  const helionHome = getHelionConfigHomeDir();
  appendNativePromptHistory(helionHome, turn, display);
  appendNativeTranscript(helionHome, turn);
}

function appendNativePromptHistory(
  helionHome: string,
  turn: NativeHistoryTurn,
  display: string,
): void {
  try {
    fs.mkdirSync(helionHome, { recursive: true, mode: 0o700 });
    const historyPath = path.join(helionHome, 'history.jsonl');
    if (recentHistoryAlreadyHasEntry(historyPath, turn, display)) {
      return;
    }
    const entry = {
      display,
      pastedContents: {},
      timestamp: turn.timestamp,
      project: turn.cwd,
      sessionId: turn.sessionId,
    };
    fs.appendFileSync(historyPath, `${JSON.stringify(entry)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // History should never break the chat flow.
  }
}

function appendNativeTranscript(helionHome: string, turn: NativeHistoryTurn): void {
  try {
    const projectDir = path.join(helionHome, 'projects', sanitizeNativeProjectPath(turn.cwd));
    fs.mkdirSync(projectDir, { recursive: true, mode: 0o700 });
    const transcriptPath = path.join(projectDir, `${turn.sessionId}.jsonl`);
    if (transcriptTailAlreadyHasTurn(transcriptPath, turn)) {
      return;
    }

    const userUuid = crypto.randomUUID();
    const assistantUuid = crypto.randomUUID();
    const parentUuid = findLastTranscriptUuid(transcriptPath);
    const common = {
      isSidechain: false,
      userType: 'external',
      entrypoint: 'claude-vscode',
      cwd: turn.cwd,
      sessionId: turn.sessionId,
      version: 'vscode-extension',
    };
    const lines = [
      {
        parentUuid,
        promptId: crypto.randomUUID(),
        type: 'user',
        message: {
          role: 'user',
          content: turn.userText,
        },
        uuid: userUuid,
        timestamp: new Date(turn.timestamp).toISOString(),
        permissionMode: 'default',
        ...common,
      },
      {
        parentUuid: userUuid,
        type: 'assistant',
        message: {
          id: `vscode_${assistantUuid}`,
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: turn.assistantText,
            },
          ],
          stop_reason: 'end_turn',
        },
        uuid: assistantUuid,
        timestamp: new Date().toISOString(),
        ...common,
      },
      {
        type: 'last-prompt',
        lastPrompt: turn.userText,
        sessionId: turn.sessionId,
      },
    ];
    fs.appendFileSync(
      transcriptPath,
      lines.map(line => JSON.stringify(line)).join('\n') + '\n',
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
  } catch {
    // The transcript is best-effort because the CLI itself remains the source of truth when it records successfully.
  }
}

function getHelionConfigHomeDir(): string {
  return (
    process.env.HELIONCODER_CONFIG_DIR ||
    process.env.KTCODER_CONFIG_DIR ||
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(os.homedir(), '.helioncoder')
  );
}

function formatNativeHistoryDisplay(userText: string): string {
  return trimConversationText(userText, 4_000);
}

function recentHistoryAlreadyHasEntry(
  historyPath: string,
  turn: NativeHistoryTurn,
  display: string,
): boolean {
  const recentText = readRecentFileText(historyPath, 256_000);
  if (!recentText) {
    return false;
  }

  const lines = recentText.split(/\r?\n/).filter(Boolean).slice(-80);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (
        entry.display === display &&
        entry.sessionId === turn.sessionId &&
        entry.project === turn.cwd
      ) {
        return true;
      }
    } catch {
      // Ignore partial tail lines and malformed history entries.
    }
  }
  return false;
}

function transcriptTailAlreadyHasTurn(transcriptPath: string, turn: NativeHistoryTurn): boolean {
  const recentText = readRecentFileText(transcriptPath, 512_000);
  if (!recentText) {
    return false;
  }

  let lastUser = '';
  let lastAssistant = '';
  for (const line of recentText.split(/\r?\n/).filter(Boolean).slice(-120)) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (!entry.message || typeof entry.message !== 'object') {
        continue;
      }
      const message = entry.message as Record<string, unknown>;
      const role = firstHistoryText(message.role, entry.type);
      const text = extractHistoryContent(message.content);
      if (role === 'user' && text) {
        lastUser = text;
      } else if (role === 'assistant' && text) {
        lastAssistant = text;
      }
    } catch {
      // Ignore partial tail lines and malformed transcript entries.
    }
  }

  return (
    lastUser.trim() === turn.userText.trim() &&
    lastAssistant.trim() === turn.assistantText.trim()
  );
}

function findLastTranscriptUuid(transcriptPath: string): string | null {
  const recentText = readRecentFileText(transcriptPath, 512_000);
  if (!recentText) {
    return null;
  }

  const lines = recentText.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]!) as Record<string, unknown>;
      if (
        typeof entry.uuid === 'string' &&
        (entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system')
      ) {
        return entry.uuid;
      }
    } catch {
      // Ignore partial tail lines and malformed transcript entries.
    }
  }
  return null;
}

function readRecentFileText(filePath: string, maxBytes: number): string {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    if (length <= 0) {
      return '';
    }
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function sanitizeNativeProjectPath(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9]/g, '-');
  if (sanitized.length <= 200) {
    return sanitized;
  }
  return `${sanitized.slice(0, 200)}-${simpleNativeHash(value)}`;
}

function simpleNativeHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return Math.abs(hash).toString(36);
}

function readHistoryEntries(cwd: string): HistoryEntry[] {
  const helionHome = getHelionConfigHomeDir();
  const entries: HistoryEntry[] = [];

  collectHistoryJsonl(path.join(helionHome, 'history.jsonl'), cwd, entries);

  const projectsDir = path.join(helionHome, 'projects');
  if (fs.existsSync(projectsDir)) {
    for (const projectDir of fs.readdirSync(projectsDir)) {
      const fullDir = path.join(projectsDir, projectDir);
      if (!safeIsDirectory(fullDir)) {
        continue;
      }
      for (const fileName of fs.readdirSync(fullDir)) {
        if (fileName.endsWith('.jsonl')) {
          collectHistoryJsonl(path.join(fullDir, fileName), cwd, entries);
        }
      }
    }
  }

  const seen = new Set<string>();
  return entries
    .filter(entry => {
      const key = `${entry.sessionId ?? ''}:${entry.display}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0))
    .slice(0, 120);
}

function collectHistoryJsonl(filePath: string, cwd: string, entries: HistoryEntry[]): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const entry = parseHistoryLine(line);
    if (!entry || !isRelatedProject(entry.project, cwd)) {
      continue;
    }
    entry.filePath ??= filePath;
    entries.push(entry);
  }
}

function parseHistoryLine(line: string): HistoryEntry | undefined {
  try {
    const data = JSON.parse(line) as Record<string, unknown>;
    const display = firstHistoryText(
      data.display,
      data.lastPrompt,
      typeof data.message === 'object' && data.message
        ? (data.message as Record<string, unknown>).content
        : undefined,
    );
    if (!display || isMetaHistoryText(display)) {
      return undefined;
    }
    return {
      display: display.length > 220 ? `${display.slice(0, 220)}...` : display,
      timestamp: parseHistoryTimestamp(data.timestamp),
      project: firstHistoryText(data.project, data.cwd),
      sessionId: firstHistoryText(data.sessionId),
    };
  } catch {
    return undefined;
  }
}

function readHistoryConversation(entry: HistoryEntry): HistoryMessage[] {
  const sessionPath =
    findSessionFile(entry.sessionId) ??
    (entry.filePath && path.basename(entry.filePath) !== 'history.jsonl'
      ? entry.filePath
      : undefined);
  if (!sessionPath || !fs.existsSync(sessionPath)) {
    return [
      {
        role: 'user',
        text: entry.display,
        timestamp: entry.timestamp,
      },
    ];
  }

  const messages: HistoryMessage[] = [];
  for (const line of fs.readFileSync(sessionPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const message = parseConversationLine(line);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

function parseConversationLine(line: string): HistoryMessage | undefined {
  try {
    const data = JSON.parse(line) as Record<string, unknown>;
    const role = firstHistoryText(
      typeof data.message === 'object' && data.message
        ? (data.message as Record<string, unknown>).role
        : undefined,
      data.type,
    );
    if (role !== 'user' && role !== 'assistant') {
      return undefined;
    }

    if (data.isMeta === true || data.isSidechain === true) {
      return undefined;
    }

    const content =
      typeof data.message === 'object' && data.message
        ? (data.message as Record<string, unknown>).content
        : undefined;
    const text = extractHistoryContent(content);
    if (!text || isMetaHistoryText(text)) {
      return undefined;
    }

    return {
      role,
      text,
      timestamp: parseHistoryTimestamp(data.timestamp),
    };
  } catch {
    return undefined;
  }
}

function extractHistoryContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text);
    } else if (record.type === 'tool_use' && typeof record.name === 'string') {
      parts.push(`使用工具：${record.name}`);
    } else if (record.type === 'tool_result') {
      const result = extractHistoryContent(record.content);
      if (result) {
        parts.push(result);
      }
    }
  }
  return parts.join('\n\n').trim() || undefined;
}

function findSessionFile(sessionId: string | undefined): string | undefined {
  if (!sessionId) {
    return undefined;
  }
  const projectsDir = path.join(os.homedir(), '.helioncoder', 'projects');
  if (!fs.existsSync(projectsDir)) {
    return undefined;
  }
  for (const projectDir of fs.readdirSync(projectsDir)) {
    const fullDir = path.join(projectsDir, projectDir);
    if (!safeIsDirectory(fullDir)) {
      continue;
    }
    const candidate = path.join(fullDir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function firstHistoryText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function parseHistoryTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function isMetaHistoryText(value: string): boolean {
  const text = value.trim();
  return (
    /<\/?(local-command|command-name|command-message|command-args|file-history-snapshot)/i.test(
      text,
    ) ||
    /^\/(?:api-config|clear|compact|config|cost|doctor|help|init|login|logout|model|permissions?|plugins?|release-notes|resume|statusline|theme)(?:\s|$)/i.test(
      text,
    )
  );
}

function isRelatedProject(project: string | undefined, cwd: string): boolean {
  if (!project) {
    return true;
  }
  const normalizedProject = path.resolve(project);
  const normalizedCwd = path.resolve(cwd);
  const projectToCwd = path.relative(normalizedProject, normalizedCwd);
  const cwdToProject = path.relative(normalizedCwd, normalizedProject);
  return (
    normalizedProject === normalizedCwd ||
    (!!projectToCwd && !projectToCwd.startsWith('..') && !path.isAbsolute(projectToCwd)) ||
    (!!cwdToProject && !cwdToProject.startsWith('..') && !path.isAbsolute(cwdToProject))
  );
}

function safeIsDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function lineDelta(before: string, after: string): { added: number; removed: number } {
  const beforeLines = before ? before.split(/\r?\n/) : [];
  const afterLines = after ? after.split(/\r?\n/) : [];
  let commonPrefix = 0;
  while (
    commonPrefix < beforeLines.length &&
    commonPrefix < afterLines.length &&
    beforeLines[commonPrefix] === afterLines[commonPrefix]
  ) {
    commonPrefix += 1;
  }
  let commonSuffix = 0;
  while (
    commonSuffix + commonPrefix < beforeLines.length &&
    commonSuffix + commonPrefix < afterLines.length &&
    beforeLines[beforeLines.length - 1 - commonSuffix] === afterLines[afterLines.length - 1 - commonSuffix]
  ) {
    commonSuffix += 1;
  }
  return {
    added: Math.max(0, afterLines.length - commonPrefix - commonSuffix),
    removed: Math.max(0, beforeLines.length - commonPrefix - commonSuffix),
  };
}

function reviewChangeSummary(change: ReviewChange): {
  added: number;
  removed: number;
  summary: string;
  location: string;
} {
  const delta = lineDelta(change.before ?? '', change.after);
  const location = reviewChangeLocation(change);
  return {
    ...delta,
    location,
    summary: reviewChangeLineSummary(change.kind, delta, location),
  };
}

function reviewChangeKindLabel(kind: ReviewChangeKind): string {
  switch (kind) {
    case 'created':
      return '新增';
    case 'deleted':
      return '删除';
    case 'modified':
    default:
      return '修改';
  }
}

function reviewChangeLocation(change: ReviewChange): string {
  if (change.kind === 'created') {
    return '新文件';
  }
  if (change.kind === 'deleted') {
    return '整文件';
  }

  return `第 ${reviewChangeStartLine(change) + 1} 行附近`;
}

function reviewChangeStartLine(change: ReviewChange): number {
  const beforeLines = change.before ? change.before.split(/\r?\n/) : [];
  const afterLines = change.after ? change.after.split(/\r?\n/) : [];
  let commonPrefix = 0;
  while (
    commonPrefix < beforeLines.length &&
    commonPrefix < afterLines.length &&
    beforeLines[commonPrefix] === afterLines[commonPrefix]
  ) {
    commonPrefix += 1;
  }

  return commonPrefix;
}

function reviewChangeLineSummary(
  kind: ReviewChangeKind,
  delta: { added: number; removed: number },
  location: string,
): string {
  if (kind === 'created') {
    return `新增文件，写入 ${delta.added} 行`;
  }
  if (kind === 'deleted') {
    return `删除文件，移除 ${delta.removed} 行`;
  }
  if (delta.added === 0 && delta.removed === 0) {
    return `${location} 内容有变更`;
  }
  return `${location}，新增 ${delta.added} 行，删除 ${delta.removed} 行`;
}

function iconSvg(name: string): string {
  const icons: Record<string, string> = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
    arrowLeft: '<path d="m15 18-6-6 6-6"/><path d="M21 12H9"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a6 6 0 0 0-10-3L4 9"/><path d="M6 15a6 6 0 0 0 10 3l4-3"/>',
    terminal: '<path d="m4 7 5 5-5 5"/><path d="M11 17h9"/>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3-.2-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-5v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.2.1-2-3 .1-.1A1.7 1.7 0 0 0 5 15a1.7 1.7 0 0 0-1.5-1H3v-4h.5A1.7 1.7 0 0 0 5 9a1.7 1.7 0 0 0-.3-1.9L4.6 7l2-3 .2.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3h5v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.2-.1 2 3-.1.1A1.7 1.7 0 0 0 19 9a1.7 1.7 0 0 0 1.5 1h.5v4h-.5A1.7 1.7 0 0 0 19.4 15Z"/>',
    shield: '<path d="M12 3 5 6v5c0 4 3 7 7 10 4-3 7-6 7-10V6l-7-3Z"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    circle: '<circle cx="12" cy="12" r="4"/>',
    paperclip: '<path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.3 3.3 0 0 1 4.7 4.7L10 18.3a1.7 1.7 0 0 1-2.3-2.3L16 7.7"/>',
    spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    hand: '<path d="M7 11V6a2 2 0 0 1 4 0v4"/><path d="M11 10V5a2 2 0 0 1 4 0v6"/><path d="M15 11V7a2 2 0 0 1 4 0v6c0 5-3 8-7 8h-1a7 7 0 0 1-6-4l-2-5a2 2 0 0 1 4-1l1 2"/>',
    review: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="m15 17 2 2 4-5"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    cornerDownRight: '<path d="M15 10l5 5-5 5"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
    circleInfo: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.circle}</svg>`;
}
